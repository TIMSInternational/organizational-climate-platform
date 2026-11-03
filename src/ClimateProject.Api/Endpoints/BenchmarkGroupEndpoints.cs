using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Benchmarks;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>/admin/benchmark-groups</c> -- reference groups computed from the platform's own clients
/// (ruled 3 Nov 2026, <c>docs/decisions/benchmark-groups-are-computed.md</c>).
/// </summary>
/// <remarks>
/// <para>
/// **Super admin only, every route.** A group's median over three companies is one real
/// company's exact index, and the criteria ("Servicios públicos · Costa Rica") can be narrow
/// enough to say which. TIMS reads it to prepare a client's results; a client's own admin
/// does not, and keeps the hand-entered <c>/admin/benchmarks</c> page.
/// </para>
/// <para>
/// **Cost.** A reading streams the subject's survey and each member's latest qualifying
/// survey through <see cref="SurveyAggregateLoader"/>, the same loader results and trends
/// use, so the numbers cannot drift from theirs. It is bounded by <see cref="MaxMembers"/>;
/// a request is answered with the most recent members, never refused.
/// </para>
/// </remarks>
public static class BenchmarkGroupEndpoints
{
    /// <summary>The most member surveys one reading aggregates: the newest by close date.</summary>
    public const int MaxMembers = 40;

    private const string Resource = "benchmark_group";

    public static void MapBenchmarkGroupEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/benchmark-groups").RequireAuthorization();
        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/options", OptionsAsync);
        group.MapGet("/preview", PreviewAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);
        // A company's climate against other companies' climates: content about confidential
        // employee opinion, read across tenants. Marked like /surveys/climate-trends.
        group.MapGet("/{id:guid}/reading", ReadAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Read));
    }

    private sealed record CompanyCriteria(Guid Id, string Name, string? Industry, string? Size, string? Country);

    private sealed record QualifyingSurvey(Guid SurveyId, Guid CompanyId, string ServiceType, DateTimeOffset EndDate);

    private static bool IsSuperAdmin(ClaimsPrincipal principal) => principal.GetCurrentUser().Role == Roles.SuperAdmin;

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (!IsSuperAdmin(principal)) return Results.Forbid();

        var groups = await db.BenchmarkGroups.AsNoTracking().OrderBy(g => g.Name).ToListAsync(cancellationToken);
        var companies = await CompaniesAsync(db, cancellationToken);
        var qualifying = await QualifyingSurveysAsync(db, cancellationToken);
        return Results.Ok(groups.Select(g => ToDto(g, companies, qualifying)).ToList());
    }

    private static async Task<IResult> OptionsAsync(ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (!IsSuperAdmin(principal)) return Results.Forbid();

        var companies = await CompaniesAsync(db, cancellationToken);
        static List<string> Distinct(IEnumerable<string?> values) => values
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Results.Ok(new BenchmarkGroupOptions(
            Distinct(companies.Select(c => c.Industry)),
            Distinct(companies.Select(c => c.Size)),
            Distinct(companies.Select(c => c.Country)),
            ClimateServiceTypes.Metered));
    }

    private static async Task<IResult> PreviewAsync(
        string? industry,
        string? companySize,
        string? country,
        string? serviceType,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!IsSuperAdmin(principal)) return Results.Forbid();
        if (!IsServiceType(serviceType)) return UnknownServiceType();

        var probe = new BenchmarkGroup
        {
            Name = string.Empty,
            Industry = Clean(industry),
            CompanySize = Clean(companySize),
            Country = Clean(country),
            ServiceType = serviceType!,
        };
        var companies = await CompaniesAsync(db, cancellationToken);
        var qualifying = await QualifyingSurveysAsync(db, cancellationToken);
        return Results.Ok(new BenchmarkGroupPreview(
            MemberSurveys(probe, companies, qualifying).Count,
            BenchmarkGroupReading.MinimumCompanies));
    }

    private static async Task<IResult> CreateAsync(
        CreateBenchmarkGroupRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var actor = principal.GetCurrentUser();
        if (actor.Role != Roles.SuperAdmin) return Results.Forbid();

        var name = Clean(request.Name);
        if (name is null || name.Length > 200)
        {
            return Results.Json(new { message = "A group needs a name of at most 200 characters." }, statusCode: 400);
        }

        if (!IsServiceType(request.ServiceType)) return UnknownServiceType();

        var industry = Clean(request.Industry);
        var size = Clean(request.CompanySize);
        var country = Clean(request.Country);
        if (industry?.Length > 100 || size?.Length > 50 || country?.Length > 100)
        {
            return Results.Json(new { message = "A criterion is longer than the company field it is matched against." }, statusCode: 400);
        }

        var lowered = name.ToLowerInvariant();
        if (await db.BenchmarkGroups.AnyAsync(g => g.Name.ToLower() == lowered, cancellationToken))
        {
            return Results.Json(new { message = "A group with this name already exists." }, statusCode: 409);
        }

        if (await SurveyEndpoints.ResolveActingUserIdAsync(actor, db, cancellationToken) is not { } actorId)
        {
            return Results.Forbid();
        }

        var group = new BenchmarkGroup
        {
            Id = Guid.NewGuid(),
            Name = name,
            Industry = industry,
            CompanySize = size,
            Country = country,
            ServiceType = request.ServiceType!,
            CreatedBy = actorId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.BenchmarkGroups.Add(group);
        await db.SaveChangesAsync(cancellationToken);
        audit.Describe("admin.benchmark-groups.create", Resource, group.Id.ToString());

        var companies = await CompaniesAsync(db, cancellationToken);
        var qualifying = await QualifyingSurveysAsync(db, cancellationToken);
        return Results.Created($"/admin/benchmark-groups/{group.Id}", ToDto(group, companies, qualifying));
    }

    private static async Task<IResult> DeleteAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        if (!IsSuperAdmin(principal)) return Results.Forbid();

        // A group is criteria and nothing else: deleting one removes no reading, answer or
        // figure, because none is stored. It can be recreated identically at any time.
        var group = await db.BenchmarkGroups.FirstOrDefaultAsync(g => g.Id == id, cancellationToken);
        if (group is null) return Results.NotFound();
        db.BenchmarkGroups.Remove(group);
        await db.SaveChangesAsync(cancellationToken);
        audit.Describe("admin.benchmark-groups.delete", Resource, id.ToString());
        return Results.NoContent();
    }

    /// <param name="companyId">The company being read. Required: there is no all-companies reading.</param>
    /// <param name="surveyId">One of that company's closed surveys; absent = its latest of the group's instrument family.</param>
    private static async Task<IResult> ReadAsync(
        Guid id,
        Guid? companyId,
        Guid? surveyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var actor = principal.GetCurrentUser();
        if (actor.Role != Roles.SuperAdmin) return Results.Forbid();
        if (companyId is not { } subjectId)
        {
            return Results.Json(new { message = "companyId is required: a reading is one company against the group." }, statusCode: 400);
        }

        var group = await db.BenchmarkGroups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == id, cancellationToken);
        if (group is null) return Results.NotFound();
        var company = await db.Companies.AsNoTracking()
            .Where(c => c.Id == subjectId)
            .Select(c => new { c.Id, c.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null) return Results.NotFound();

        // Filed under the company that was read. A super admin has no company of their own,
        // and the middleware writes no row without one (the gap #648 closed for credentials).
        audit.Describe("admin.benchmark-groups.reading.read", Resource, group.Id.ToString());
        if (await SurveyEndpoints.ResolveActingUserIdAsync(actor, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, subjectId);
        }

        BenchmarkGroupReadingResponse Shape(string kind, BenchmarkReadingSurvey? survey, int count = 0)
            => new(kind, group.Id, company.Id, company.Name, survey, count, BenchmarkGroupReading.MinimumCompanies, null, null, []);

        var closed = db.Surveys.AsNoTracking()
            .Where(s => s.CompanyId == subjectId
                        && (s.Status == SurveyStatuses.Closed || s.Status == SurveyStatuses.Archived));
        Survey? survey = surveyId is { } requested
            ? await closed.FirstOrDefaultAsync(s => s.Id == requested, cancellationToken)
            : await closed
                .Where(s => s.ServiceType == group.ServiceType)
                .OrderByDescending(s => s.EndDate)
                .ThenByDescending(s => s.Id)
                .FirstOrDefaultAsync(cancellationToken);

        if (survey is null)
        {
            return surveyId is null
                ? Results.Ok(Shape(BenchmarkReadingKinds.NoSurvey, null))
                : Results.NotFound(new { message = "No closed survey of this company has that id." });
        }

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();
        var surveyDto = new BenchmarkReadingSurvey(
            survey.Id,
            SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields),
            survey.EndDate,
            survey.ServiceType);

        if (!string.Equals(survey.ServiceType, group.ServiceType, StringComparison.Ordinal))
        {
            return Results.Ok(Shape(BenchmarkReadingKinds.ServiceMismatch, surveyDto));
        }

        var subject = BenchmarkGroupReading.Indices(
            await SurveyAggregateLoader.ComputeAsync(db, survey, locale, fallbackFields, cancellationToken));
        if (subject is null)
        {
            return Results.Ok(Shape(BenchmarkReadingKinds.SurveySuppressed, surveyDto));
        }

        var companies = await CompaniesAsync(db, cancellationToken);
        var qualifying = await QualifyingSurveysAsync(db, cancellationToken);
        var memberIds = MemberSurveys(group, companies, qualifying)
            .Where(m => m.CompanyId != subjectId)
            .OrderByDescending(m => m.EndDate)
            .Take(MaxMembers)
            .Select(m => m.SurveyId)
            .ToList();
        var memberSurveys = await db.Surveys.AsNoTracking()
            .Where(s => memberIds.Contains(s.Id))
            .ToListAsync(cancellationToken);

        var members = new List<BenchmarkGroupReading.CompanyIndices>(memberSurveys.Count);
        foreach (var memberSurvey in memberSurveys)
        {
            // Sequential: a DbContext is not thread-safe (the reason the trends route gives).
            var aggregate = await SurveyAggregateLoader.ComputeAsync(
                db, memberSurvey, SurveyContent.ResolveRequestLocale(lang, memberSurvey.Language), [], cancellationToken);
            if (BenchmarkGroupReading.Indices(aggregate) is { } indices)
            {
                members.Add(indices);
            }
        }

        var reading = BenchmarkGroupReading.Read(subject, members);
        return Results.Ok(new BenchmarkGroupReadingResponse(
            reading.Sufficient ? BenchmarkReadingKinds.Ready : BenchmarkReadingKinds.Insufficient,
            group.Id,
            company.Id,
            company.Name,
            surveyDto,
            reading.CompanyCount,
            BenchmarkGroupReading.MinimumCompanies,
            reading.CompanyIndex,
            reading.GroupMedian,
            reading.Dimensions));
    }

    private static BenchmarkGroupDto ToDto(
        BenchmarkGroup group, IReadOnlyList<CompanyCriteria> companies, IReadOnlyList<QualifyingSurvey> qualifying)
    {
        var members = MemberSurveys(group, companies, qualifying);
        return new BenchmarkGroupDto(
            group.Id,
            group.Name,
            group.Industry,
            group.CompanySize,
            group.Country,
            group.ServiceType,
            members.Count,
            BenchmarkGroupReading.MinimumCompanies,
            members.Count == 0 ? null : members.Max(m => m.EndDate));
    }

    /// <summary>
    /// The latest qualifying survey of every company that meets the group's criteria: one per
    /// company, of the group's instrument family, closed, and over the respondent floor.
    /// </summary>
    private static List<QualifyingSurvey> MemberSurveys(
        BenchmarkGroup group, IReadOnlyList<CompanyCriteria> companies, IReadOnlyList<QualifyingSurvey> qualifying)
    {
        var matching = companies
            .Where(c => BenchmarkGroupReading.Matches(group.Industry, c.Industry)
                        && BenchmarkGroupReading.Matches(group.CompanySize, c.Size)
                        && BenchmarkGroupReading.Matches(group.Country, c.Country))
            .Select(c => c.Id)
            .ToHashSet();
        return qualifying
            .Where(s => matching.Contains(s.CompanyId) && string.Equals(s.ServiceType, group.ServiceType, StringComparison.Ordinal))
            .GroupBy(s => s.CompanyId)
            .Select(g => g.OrderByDescending(s => s.EndDate).ThenByDescending(s => s.SurveyId).First())
            .ToList();
    }

    private static Task<List<CompanyCriteria>> CompaniesAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
        => db.Companies.AsNoTracking()
            .Select(c => new CompanyCriteria(c.Id, c.Name, c.Industry, c.Size, c.Country))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Every closed or archived survey that names an instrument family and has at least
    /// <see cref="SurveyResultsPrivacy.MinimumRespondents"/> complete responses: the floor the
    /// aggregate itself applies to a whole survey, so a survey counted here is one the reading
    /// can use. (A reading still drops a member whose aggregate carries no scored dimension.)
    /// </summary>
    private static async Task<List<QualifyingSurvey>> QualifyingSurveysAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var surveys = await db.Surveys.AsNoTracking()
            .Where(s => (s.Status == SurveyStatuses.Closed || s.Status == SurveyStatuses.Archived) && s.ServiceType != null)
            .Select(s => new { s.Id, s.CompanyId, s.ServiceType, s.EndDate })
            .ToListAsync(cancellationToken);
        var ids = surveys.Select(s => s.Id).ToList();
        var completed = await db.Responses.AsNoTracking()
            .Where(r => r.IsComplete && ids.Contains(r.SurveyId))
            .GroupBy(r => r.SurveyId)
            .Select(g => new { SurveyId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SurveyId, x => x.Count, cancellationToken);
        return surveys
            .Where(s => completed.GetValueOrDefault(s.Id) >= SurveyResultsPrivacy.MinimumRespondents)
            .Select(s => new QualifyingSurvey(s.Id, s.CompanyId, s.ServiceType!, s.EndDate))
            .ToList();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool IsServiceType(string? value)
        => value is not null && ClimateServiceTypes.Metered.Contains(value, StringComparer.Ordinal);

    private static IResult UnknownServiceType() => Results.Json(
        new { message = $"serviceType must be one of: {string.Join(", ", ClimateServiceTypes.Metered)}." },
        statusCode: 400);
}
