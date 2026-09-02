using System.Security.Claims;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Computed analytics: an <see cref="AnalyticsInsight"/> header plus its categorical
/// breakdown (<see cref="AnalyticsMetricData"/>) and its trend (<see cref="AnalyticsTimeSeries"/>).
///
/// Distinct from <see cref="BenchmarkEndpoints"/> in one way that matters for tenancy:
/// <c>analytics_insights.company_id</c> is <c>Guid</c>, not <c>Guid?</c>, so there is no global
/// row here and therefore no read/write split -- the single <see cref="CanAccessCompany"/>
/// guard covers both, as in <see cref="DemographicSnapshotEndpoints"/>. The plan text for this
/// task carried over Benchmark's "rows with CompanyId == null are globally visible" rule; it
/// does not apply, because no such row can exist.
///
/// Also distinct from <c>AIInsight</c> (#86, still open), which is the LLM-authored narrative
/// insight surfaced at <c>/admin/ai-insights</c>. Same word, different table, different route.
/// </summary>
public static class AnalyticsInsightEndpoints
{
    public static void MapAnalyticsInsightEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/analytics-insights").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/metric-data", AddMetricDataAsync);
        group.MapPost("/{id:guid}/time-series", AddTimeSeriesPointAsync);
    }

    // SuperAdmin short-circuits first and its own companyId claim is never read -- a global
    // super_admin has none since #191. Every other role, including leader/supervisor/employee,
    // falls through to false: analytics aggregates are an admin surface.
    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListAsync(
        Guid companyId,
        bool? isCurrent,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var query = db.AnalyticsInsights.Where(i => i.CompanyId == companyId);
        if (isCurrent.HasValue)
        {
            // Matches IX_analytics_insights_company_id_is_current, which exists precisely
            // because "the current numbers for this company" is the dashboard's only query.
            query = query.Where(i => i.IsCurrent == isCurrent.Value);
        }

        var insights = await query
            .OrderByDescending(i => i.CalculationDate)
            // CalculationDate is stamped server-side, so a batch of insights written by one
            // recompute all share it to the tick. Without the id tiebreak the list order would
            // be whatever Postgres felt like, and a paging or diffing caller would see rows
            // shuffle between two identical requests.
            .ThenBy(i => i.Id)
            .Select(i => new AnalyticsInsightListItem(i.Id, i.CompanyId, i.MetricType, i.MetricName, i.IsCurrent, i.CalculationDate))
            .ToListAsync(cancellationToken);

        return Results.Ok(insights);
    }

    private static async Task<IResult> CreateAsync(
        CreateAnalyticsInsightRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var validation = AnalyticsInsightValidation.ValidateCreate(request);
        if (validation.Error is not null) return Results.Json(new { message = validation.Error }, statusCode: 400);
        var fields = validation.Fields!;

        // company_id has a real FK, so an unknown one would be a DbUpdateException -> 500.
        // Only a SuperAdmin can get here with a company that is not their own, but "I typed the
        // wrong guid" deserves a 400.
        var companyExists = await db.Companies.AnyAsync(c => c.Id == request.CompanyId, cancellationToken);
        if (!companyExists)
        {
            return Results.Json(new { message = "CompanyId does not reference an existing company" }, statusCode: 400);
        }

        if (request.SurveyId.HasValue)
        {
            // #168 gave survey_id an FK, which checks that the row exists -- not whose it is. The
            // tenancy half still has to be checked by hand. Checking only existence -- as the plan text does
            // -- would let a CompanyAdmin file their own company's aggregate against another
            // tenant's survey id, and then read that survey id back out of the detail payload.
            // Same hole #87 closed on demographic snapshots.
            var surveyCompanyId = await db.Surveys
                .Where(s => s.Id == request.SurveyId.Value)
                .Select(s => (Guid?)s.CompanyId)
                .FirstOrDefaultAsync(cancellationToken);

            if (surveyCompanyId is null)
            {
                return Results.Json(new { message = "SurveyId does not reference an existing survey" }, statusCode: 400);
            }

            if (surveyCompanyId.Value != request.CompanyId)
            {
                return Results.Json(new { message = "SurveyId belongs to a different company" }, statusCode: 400);
            }
        }

        if (request.DepartmentId.HasValue)
        {
            var deptExists = await db.Departments.AnyAsync(
                d => d.Id == request.DepartmentId.Value && d.CompanyId == request.CompanyId, cancellationToken);
            if (!deptExists)
            {
                return Results.Json(new { message = "DepartmentId does not reference an existing department in this company" }, statusCode: 400);
            }
        }

        var now = DateTimeOffset.UtcNow;
        var insight = new AnalyticsInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            AggregationType = fields.AggregationType,
            MetricType = fields.MetricType,
            MetricName = fields.MetricName,
            MetricDescription = fields.MetricDescription,
            TotalResponses = request.TotalResponses,
            CalculationDate = now,
            IsCurrent = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.AnalyticsInsights.Add(insight);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, insight.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddMetricDataAsync(
        Guid id,
        AddMetricDataRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        // 404 before the tenancy check would be a probe oracle, but the id is a v4 guid and the
        // order here matches every other endpoint in the repo: not-found first, then Forbid.
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        var label = AnalyticsInsightValidation.ValidateMetricData(request, out var error);
        if (error is not null) return Results.Json(new { message = error }, statusCode: 400);

        db.AnalyticsMetricData.Add(new AnalyticsMetricData
        {
            Id = Guid.NewGuid(),
            InsightId = id,
            Label = label!,
            Value = request.Value,
            Count = request.Count,
            Percentage = request.Percentage,
        });
        insight.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> AddTimeSeriesPointAsync(
        Guid id,
        AddTimeSeriesPointRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AnalyticsInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        var error = AnalyticsInsightValidation.ValidateTimeSeriesPoint(request);
        if (error is not null) return Results.Json(new { message = error }, statusCode: 400);

        db.AnalyticsTimeSeries.Add(new AnalyticsTimeSeries
        {
            Id = Guid.NewGuid(),
            InsightId = id,
            Date = request.Date,
            Value = request.Value,
            Count = request.Count,
        });
        insight.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<AnalyticsInsightDetail> LoadDetailAsync(
        ClimateProjectDbContext db,
        Guid id,
        CancellationToken cancellationToken)
    {
        var i = await db.AnalyticsInsights.FirstAsync(x => x.Id == id, cancellationToken);

        var metricData = await db.AnalyticsMetricData
            .Where(m => m.InsightId == id)
            // Insertion order is not an order Postgres promises, so an unsorted bar chart would
            // reshuffle its categories on refetch.
            .OrderBy(m => m.Label)
            .ThenBy(m => m.Id)
            .Select(m => new MetricDataPointDto(m.Id, m.Label, m.Value, m.Count, m.Percentage))
            .ToListAsync(cancellationToken);

        var timeSeries = await db.AnalyticsTimeSeries
            .Where(t => t.InsightId == id)
            .OrderBy(t => t.Date)
            // Date alone is not deterministic: two points recorded at the same instant (a
            // backfill, or two departments rolled up to one timestamp) would tie, and a line
            // chart that swaps two tied points between renders is exactly the "deterministic
            // order" this task's acceptance criteria rules out.
            .ThenBy(t => t.Id)
            .Select(t => new TimeSeriesPointDto(t.Id, t.Date, t.Value, t.Count))
            .ToListAsync(cancellationToken);

        return new AnalyticsInsightDetail(
            i.Id, i.SurveyId, i.CompanyId, i.DepartmentId, i.AggregationType, i.MetricType,
            i.MetricName, i.MetricDescription, i.TotalResponses, i.CalculationDate, i.IsCurrent,
            metricData, timeSeries);
    }
}
