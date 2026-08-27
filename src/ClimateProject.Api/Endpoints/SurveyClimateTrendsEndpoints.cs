using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /surveys/climate-trends</c> -- the company's own dimension scores across its own
/// surveys, which is the one thing <c>/benchmarks/{id}/trends</c> is not.
///
/// **Not a benchmark chain.** The benchmark trends route walks
/// <c>Benchmark.PreviousBenchmarkId</c>, a hand-linked chain of external comparison rows a
/// company records against an industry figure. It never reads a response. This route reads
/// nothing but the company's own completed responses, through the same aggregation the
/// results screens use. The two answer different questions and neither substitutes for the
/// other; they were confused for each other once, which is why this paragraph is here.
///
/// **Cost, stated rather than assumed.** This is the most expensive read in the product,
/// because it is <c>/results</c> N times: each survey in the window streams every answer of
/// every completed response through <see cref="SurveyAggregateLoader"/>. That is deliberate
/// -- a second, cheaper projection is exactly the drift #88's boundary forbids, and the
/// number a trend screen prints must be the number the results screen prints. It is made
/// affordable by bounding N rather than by computing differently:
/// <list type="bullet">
/// <item><see cref="MaxSurveys"/> caps the window at 12 surveys, and
/// <see cref="DefaultSurveys"/> returns 6 when the caller does not ask. A caller asking for
/// more gets the cap, not an error -- silently returning fewer would be the "no silent
/// caps" failure, so the response's own <c>Surveys</c> list is the honest statement of what
/// was read.</item>
/// <item>Only <see cref="SurveyStatuses.Closed"/> and <see cref="SurveyStatuses.Archived"/>
/// surveys are read. An <c>active</c> survey's scores move under the reader between two
/// loads, and a trend whose newest column changes while nothing else does invites the
/// reader to interpret collection progress as a change in climate. Draft and scheduled
/// surveys have no responses at all.</item>
/// <item>The window is the MOST RECENT N by close date, then re-sorted oldest-first for
/// display. Taking the oldest N would freeze the screen on ancient history the first time a
/// company ran a thirteenth survey.</item>
/// </list>
///
/// **Audited as a sensitive read (#143)**, on the same rule as <c>/results</c>: this returns
/// dimension scores per department across several waves, which is content about confidential
/// employee opinion, not a participation counter. It is the widest such read in the product,
/// so "who read this" must have an answer.
/// </summary>
public static class SurveyClimateTrendsEndpoints
{
    /// <summary>Surveys returned when the caller does not ask for a window.</summary>
    public const int DefaultSurveys = 6;

    /// <summary>The ceiling on the window. See the cost note on the class.</summary>
    public const int MaxSurveys = 12;

    public static void MapSurveyClimateTrendsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/surveys").RequireAuthorization();

        group.MapGet("/climate-trends", GetClimateTrendsAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Read));
    }

    /// <param name="companyId">
    /// SuperAdmin only, and the route's one cross-tenant affordance. A CompanyAdmin passing
    /// another company's id is refused rather than silently rescoped to their own -- a
    /// caller who asked for company B and received company A's climate without being told
    /// would publish it as B's.
    /// </param>
    /// <param name="groupBy">
    /// <c>department</c>, a demographic field key, or absent for the whole company. An
    /// unknown key is not rejected: demographic fields are per-company configuration, so
    /// "no such field" and "a field nobody answered" are the same observation from here,
    /// and 400 on the second would make an empty screen look like a client bug.
    /// </param>
    private static async Task<IResult> GetClimateTrendsAsync(
        Guid? companyId,
        string? groupBy,
        int? limit,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // A SuperAdmin who named no company is a 400 and not a 403, and the distinction is
        // the whole point: they hold every permission this route could ask for, and
        // answering Forbid tells them the opposite. The same shape as the missing-parameter
        // 500 fixed earlier on this branch -- a status that hides the real problem sends the
        // reader to look in the wrong place, and here it would be an access review for a
        // request that just needed a query string.
        if (currentUser.Role == Roles.SuperAdmin && companyId is null)
        {
            return Results.Json(
                new { message = "companyId is required for a super admin: there is no all-companies climate, because dimensions are per-instrument." },
                statusCode: 400);
        }

        var scope = ResolveCompany(currentUser, companyId);
        if (scope is null)
        {
            return Results.Forbid();
        }

        var window = Math.Clamp(limit ?? DefaultSurveys, 1, MaxSurveys);

        // Most recent N by close date, then reversed for display. Ordered by EndDate then
        // Id so the tie-break matches SurveyClimateTrends.Build's and the same twelve rows
        // come back in the same order on every load.
        var surveys = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == scope.Value
                        && (s.Status == SurveyStatuses.Closed || s.Status == SurveyStatuses.Archived))
            .OrderByDescending(s => s.EndDate)
            .ThenByDescending(s => s.Id)
            .Take(window)
            .ToListAsync(cancellationToken);

        var inputs = new List<SurveyClimateTrends.Input>(surveys.Count);
        foreach (var survey in surveys)
        {
            // Sequential rather than concurrent: a DbContext is not thread-safe, and N is
            // capped at 12. Parallelism here would need N contexts and a connection each,
            // which trades a bounded page load for unbounded pool pressure.
            var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);

            // Discarded deliberately. The results routes report fallback fields so an author
            // can see which strings are missing a translation while editing ONE survey; a
            // twelve-survey union of those paths names no survey and helps nobody, and the
            // titles here are resolved through the same resolver that would report them.
            var fallbackFields = new List<string>();

            var aggregate = await SurveyAggregateLoader.ComputeAsync(
                db, survey, locale, fallbackFields, cancellationToken);

            inputs.Add(new SurveyClimateTrends.Input(
                survey.Id,
                SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields),
                survey.Status,
                survey.EndDate,
                aggregate));
        }

        return Results.Ok(SurveyClimateTrends.Build(
            scope.Value,
            string.IsNullOrWhiteSpace(groupBy) ? null : groupBy,
            inputs,
            DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// The company whose climate the caller may read, or null if none.
    ///
    /// Mirrors <c>SurveyEndpoints.CanAdminister</c> rather than inventing a rule: this is
    /// admin surface, so SuperAdmin reads any company and CompanyAdmin reads exactly their
    /// own. Deliberately NOT a bare CompanyId match -- an employee of the company must not
    /// read per-department climate scores for the whole organisation.
    /// </summary>
    private static Guid? ResolveCompany(CurrentUser currentUser, Guid? requested)
    {
        if (currentUser.Role == Roles.SuperAdmin)
        {
            // Null only when they named no company, which the caller has already answered
            // 400 for -- there is no "all companies" climate, because dimensions are
            // per-instrument and two tenants' "Liderazgo" are not the same column.
            return requested;
        }

        if (currentUser.Role != Roles.CompanyAdmin
            || !Guid.TryParse(currentUser.CompanyId, out var own))
        {
            return null;
        }

        return requested is null || requested == own ? own : null;
    }
}
