using System.Security.Claims;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Storage, listing and acknowledgement of <see cref="AIInsight"/> -- the LLM-authored narrative
/// findings surfaced at <c>/analytics/ai-insights</c> in the web app.
///
/// <para>
/// Not to be confused with <see cref="AnalyticsInsightEndpoints"/> (<c>/admin/analytics-insights</c>):
/// same word, different table, different route. That one is computed aggregates with metric data
/// and time series; this one is prose with a confidence score.
/// </para>
/// <para>
/// This does not <em>generate</em> anything -- #92 does, behind this same contract. The routes and
/// payload shapes here are fixed by <c>web/src/features/analytics/api/insights.ts</c>, which
/// shipped ahead of the backend, so <c>AIInsightsPage</c> starts working with no frontend change.
/// </para>
/// <para>
/// Tenancy follows <see cref="AnalyticsInsightEndpoints"/> rather than
/// <see cref="BenchmarkEndpoints"/>: <c>ai_insights.company_id</c> is <c>Guid</c>, not
/// <c>Guid?</c>, so there is no globally-visible row and therefore no read/write split -- one
/// <see cref="CanAccessCompany"/> guard covers both directions.
/// </para>
/// </summary>
public static class AIInsightEndpoints
{
    public static void MapAIInsightEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/ai-insights").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/acknowledge", AcknowledgeAsync);
    }

    // SuperAdmin short-circuits first and its own companyId claim is never read -- a global
    // super_admin has none since #191. Every other role, including leader/supervisor/employee,
    // falls through to false: AI insights name departments and segments, so they are an admin
    // surface, not something a supervisor reads about their own team.
    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListAsync(
        Guid companyId,
        bool? isAcknowledged,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var query = db.AIInsights.AsNoTracking().Where(i => i.CompanyId == companyId);
        if (isAcknowledged.HasValue)
        {
            // Matches IX_ai_insights_company_id_is_acknowledged, which exists because
            // "what is still outstanding for this company" is the console's only other query.
            query = query.Where(i => i.IsAcknowledged == isAcknowledged.Value);
        }

        // Expired insights are NOT filtered out here, unlike ReportAIInsights.ForCompany. A
        // generated report must not reprint a finding that has stopped being true; an admin
        // console is the record, and silently hiding a row that GET /{id} still returns would
        // make an insight unreachable from the only page that links to it.
        var insights = await query
            .OrderByDescending(i => i.CreatedAt)
            // CreatedAt is stamped server-side, so a batch written by one generation run shares
            // it to the tick. Without the id tiebreak the order is whatever Postgres felt like,
            // and the list would shuffle between two identical requests.
            .ThenBy(i => i.Id)
            .Select(i => new AIInsightListItem(i.Id, i.CompanyId, i.Type, i.Category, i.Title, i.Priority, i.IsAcknowledged))
            .ToListAsync(cancellationToken);

        return Results.Ok(insights);
    }

    private static async Task<IResult> CreateAsync(
        CreateAIInsightRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var validation = AIInsightValidation.ValidateCreate(request);
        if (validation.Error is not null) return Results.Json(new { message = validation.Error }, statusCode: 400);
        var fields = validation.Fields!;

        // company_id has a real FK, so an unknown one would be a DbUpdateException -> 500. Only a
        // SuperAdmin can get here with a company that is not their own, but "I typed the wrong
        // guid" deserves a 400.
        var companyExists = await db.Companies.AnyAsync(c => c.Id == request.CompanyId, cancellationToken);
        if (!companyExists)
        {
            return Results.Json(new { message = "CompanyId does not reference an existing company" }, statusCode: 400);
        }

        if (request.SurveyId.HasValue)
        {
            // #168 gave survey_id an FK, which checks that the row exists -- not whose it is. The
            // tenancy half still has to be checked by hand. Checking only existence -- as the plan text
            // does -- would let a CompanyAdmin file an insight against another tenant's survey id
            // and then read that id back out of the detail payload. Same hole #87 closed on
            // demographic snapshots and #207's follow-up closed on analytics insights.
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
            // department_id IS an EF FK, so a nonexistent one is a 500 rather than a leak -- but
            // an existing department belonging to another tenant would be accepted by the FK and
            // then echoed back, which is the same cross-tenant reference as the survey case.
            var deptExists = await db.Departments.AnyAsync(
                d => d.Id == request.DepartmentId.Value && d.CompanyId == request.CompanyId, cancellationToken);
            if (!deptExists)
            {
                return Results.Json(new { message = "DepartmentId does not reference an existing department in this company" }, statusCode: 400);
            }
        }

        var now = DateTimeOffset.UtcNow;
        var insight = new AIInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            Type = fields.Type,
            Category = fields.Category,
            Title = fields.Title,
            Description = fields.Description,
            ConfidenceScore = request.ConfidenceScore,
            Priority = fields.Priority,
            AffectedSegments = fields.AffectedSegments,
            RecommendedActions = fields.RecommendedActions,
            IsAcknowledged = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.AIInsights.Add(insight);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(insight), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AIInsights.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        return Results.Ok(ToDetail(insight));
    }

    private static async Task<IResult> AcknowledgeAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var insight = await db.AIInsights.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        // Not-found before the tenancy check matches every other endpoint in the repo; the id is
        // a v4 guid, so the probe oracle this trades away is not reachable by guessing.
        if (insight is null) return Results.Json(new { message = "Insight not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, insight.CompanyId)) return Results.Forbid();

        // Acknowledgement is a transition, not a stamp. A second POST -- a double click, a retry
        // after a dropped response, a different admin opening the same row -- must not rewrite
        // who acknowledged it or when: that record is the audit trail this endpoint exists to
        // keep, and overwriting it would attribute the sign-off to whoever clicked last. So the
        // repeat is a no-op returning the original, which also makes the verb idempotent for the
        // retry the web client does not currently guard against.
        if (!insight.IsAcknowledged)
        {
            var now = DateTimeOffset.UtcNow;
            insight.IsAcknowledged = true;
            insight.AcknowledgedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
            insight.AcknowledgedAt = now;
            insight.UpdatedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToDetail(insight));
    }

    /// <summary>
    /// The Users row behind the token, by id or by persona external id -- see
    /// <c>BenchmarkEndpoints.ResolveCurrentUserIdAsync</c>, which resolves the same two shapes.
    /// </summary>
    /// <remarks>
    /// Returns null rather than <c>Guid.Empty</c> when neither matches. <c>acknowledged_by</c> is
    /// a nullable FK to users, so writing the empty guid would be a foreign-key violation and a
    /// 500 on an otherwise valid acknowledgement. An unattributed acknowledgement is a worse
    /// record than an attributed one but a much better outcome than a failed one, and the web
    /// client already falls back to wording when this comes back null.
    /// </remarks>
    private static async Task<Guid?> ResolveCurrentUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }

        var byExternalId = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id;
    }

    private static AIInsightDetail ToDetail(AIInsight i) => new(
        i.Id, i.SurveyId, i.CompanyId, i.DepartmentId, i.Type, i.Category, i.Title, i.Description,
        i.ConfidenceScore, i.Priority, i.AffectedSegments, i.RecommendedActions,
        i.IsAcknowledged, i.AcknowledgedBy, i.AcknowledgedAt);
}
