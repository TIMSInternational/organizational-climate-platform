using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The four legacy read surfaces -- <c>results</c>, <c>statistics</c>,
/// <c>real-time-stats</c> and <c>analytics</c> -- over exactly one aggregation.
///
/// **Where the numbers come from.** Every route here calls
/// <see cref="SurveyAggregation.Compute"/> and formats what comes back. Nothing in
/// this file computes a percentage, a mean or a suppression decision. That is the
/// boundary settled with #88 (report generation): aggregation is shared and lives in
/// <c>ClimateProject.Application</c>; results, statistics, analytics, real-time-stats
/// and report generation (<see cref="ReportEndpoints"/>, via the shared
/// <see cref="SurveyAggregateLoader"/>) are five presentations over it. It is
/// the only arrangement in which "results says 62% and the PDF says 58%" is
/// impossible rather than merely unlikely.
///
/// **Cost, stated rather than assumed.**
/// <list type="bullet">
/// <item><c>/results</c>, <c>/statistics</c> and <c>/analytics</c> stream every answer
/// of every completed response: O(completed responses x answered questions) rows, one
/// query, projected to four columns. For a 40-question survey with 500 respondents
/// that is 20k narrow rows -- fine for a page load, and these are page loads. They are
/// not poll endpoints, and nothing polls them.</item>
/// <item><c>/real-time-stats</c> is the poll endpoint and never touches
/// <c>question_responses</c> at all. Three aggregate queries over <c>responses</c>
/// filtered by the indexed <c>survey_id</c>, returning O(departments) rows. Its cost is
/// constant in the number of questions and options, and a poll is a count, not a scan
/// of the answer table. That distinction is the whole reason it is a separate route
/// rather than <c>/results</c> fetched repeatedly.</item>
/// <item>Nothing is cached or precomputed yet, deliberately: the issue says measure
/// first, and there is no production response volume to measure against. When it is
/// needed, the thing to cache is the <see cref="SurveyAggregate"/> -- which is already
/// suppressed by the time <see cref="SurveyAggregation.Compute"/> returns it, so a
/// cache can never hold an unsuppressed value.</item>
/// </list>
/// </summary>
public static class SurveyResultsEndpoints
{
    /// <summary>
    /// What the server wants a polling client's interval to be. 5s, matching the
    /// microclimates design decision ("polling, not WebSockets", 2026-07-31) and the
    /// 3-5s range <c>web/src/components/charts/usePolling.ts</c> enforces.
    /// </summary>
    public const int PollIntervalSeconds = 5;

    public static void MapSurveyResultsEndpoints(this WebApplication app)
    {
        // A second MapGroup over the same prefix rather than four more lines inside
        // SurveyEndpoints.MapSurveyEndpoints: the authoring surface and the results
        // surface are edited by different work and there is no behavioural difference
        // between one group and two. Same RequireAuthorization, same CanAdminister
        // guard, same 404-then-403 ordering as every other survey route.
        var group = app.MapGroup("/surveys").RequireAuthorization();

        // Audited as a sensitive read (#143). This route is the one that returns the
        // per-question answer breakdown for a survey of confidential employee opinion, so
        // "who read this" has an answer.
        group.MapGet("/{id:guid}/results", GetResultsAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Read));

        // KNOWN GAP, and NOT what the previous comment here claimed. It said these three
        // "are polled by dashboards and return counts, not content"; that is true only of
        // /real-time-stats. /statistics returns Aggregate.Breakdowns and /analytics returns
        // Aggregate.Questions AND Aggregate.Breakdowns -- between them the whole content of
        // the #122 CSV export, unaudited, one route over from a /results that is audited for
        // returning exactly that. So "who exported this data" can be answered while "who took
        // an untraced copy of the same data" cannot.
        //
        // Deliberately left as it is rather than fixed here: which read surfaces are audited
        // is #143's decision and it has to be made once, with the retention and volume
        // consequences in view, not appended by whichever slice noticed. #122 records the
        // limitation instead of narrowing it by half.
        group.MapGet("/{id:guid}/statistics", GetStatisticsAsync);
        group.MapGet("/{id:guid}/analytics", GetAnalyticsAsync);
        group.MapGet("/{id:guid}/real-time-stats", GetRealTimeStatsAsync);
    }

    // ------------------------------------------------------------------
    // Routes
    // ------------------------------------------------------------------

    private static async Task<IResult> GetResultsAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var loaded = await LoadAsync(id, lang, principal, db, cancellationToken);
        if (loaded.Failure is not null)
        {
            return loaded.Failure;
        }

        var context = loaded.Context!;
        return Results.Ok(new SurveyResultsResponse(
            context.Survey.Id,
            context.Title,
            context.Survey.Status,
            context.Survey.Language,
            context.ResolvedLocale,
            context.FallbackFields,
            context.Aggregate.Summary,
            context.Aggregate.Questions,
            context.Aggregate.IsSuppressed,
            context.Aggregate.SuppressionReason,
            context.Aggregate.MinimumGroupSize,
            DateTimeOffset.UtcNow));
    }

    private static async Task<IResult> GetStatisticsAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var loaded = await LoadAsync(id, lang, principal, db, cancellationToken);
        if (loaded.Failure is not null)
        {
            return loaded.Failure;
        }

        var context = loaded.Context!;
        return Results.Ok(new SurveyStatisticsResponse(
            context.Survey.Id,
            context.Title,
            context.Survey.Status,
            context.Survey.Language,
            context.ResolvedLocale,
            context.FallbackFields,
            context.Aggregate.Summary,
            context.Aggregate.Breakdowns,
            context.Aggregate.IsSuppressed,
            context.Aggregate.SuppressionReason,
            context.Aggregate.MinimumGroupSize,
            DateTimeOffset.UtcNow));
    }

    private static async Task<IResult> GetAnalyticsAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var loaded = await LoadAsync(id, lang, principal, db, cancellationToken);
        if (loaded.Failure is not null)
        {
            return loaded.Failure;
        }

        var context = loaded.Context!;
        return Results.Ok(new SurveyAnalyticsResponse(
            context.Survey.Id,
            context.Title,
            context.Survey.Status,
            context.Survey.Language,
            context.ResolvedLocale,
            context.FallbackFields,
            context.Aggregate.Summary,
            context.Aggregate.Questions,
            context.Aggregate.Breakdowns,
            context.Aggregate.IsSuppressed,
            context.Aggregate.SuppressionReason,
            context.Aggregate.MinimumGroupSize,
            DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// The poll endpoint. Counters only -- see the class remarks for what it costs and
    /// why it is not <c>/results</c> called repeatedly.
    /// </summary>
    private static async Task<IResult> GetRealTimeStatsAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return SurveyNotFound();
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        // Query 1: one row per completion state. Two rows, always.
        var byState = await db.Responses
            .AsNoTracking()
            .Where(r => r.SurveyId == id)
            .GroupBy(r => r.IsComplete)
            .Select(g => new
            {
                IsComplete = g.Key,
                Count = g.Count(),
                LastStart = g.Max(r => r.StartTime),
                LastCompletion = g.Max(r => r.CompletionTime),
            })
            .ToListAsync(cancellationToken);

        var completed = byState.Where(s => s.IsComplete).Sum(s => s.Count);
        var inProgress = byState.Where(s => !s.IsComplete).Sum(s => s.Count);
        var total = completed + inProgress;

        DateTimeOffset? lastResponseAt = null;
        foreach (var state in byState)
        {
            foreach (var candidate in new[] { state.LastCompletion, (DateTimeOffset?)state.LastStart })
            {
                if (candidate is not null && (lastResponseAt is null || candidate > lastResponseAt))
                {
                    lastResponseAt = candidate;
                }
            }
        }

        // Query 2: one row per department that has responded. Grouping on the nullable
        // column directly and filtering client-side -- EF cannot translate
        // Nullable<Guid>.Value inside a group key.
        var byDepartment = await db.Responses
            .AsNoTracking()
            .Where(r => r.SurveyId == id && r.IsComplete)
            .GroupBy(r => r.DepartmentId)
            .Select(g => new { DepartmentId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var departments = await SurveyAggregateLoader.LoadDepartmentsAsync(db, survey.CompanyId, cancellationToken);
        var departmentsById = departments.ToDictionary(d => d.DepartmentId);

        var participation = new List<SurveyDepartmentParticipation>();
        var suppressedDepartments = 0;
        var suppressedRespondents = 0;
        var unsegmented = 0;

        foreach (var row in byDepartment)
        {
            if (row.DepartmentId is null)
            {
                unsegmented += row.Count;
                continue;
            }

            // The same segment floor the full aggregation applies. A live dashboard is a
            // wider audience than a report, not a narrower one -- suppressing on
            // /statistics and not here would defeat both.
            if (!SurveyResultsPrivacy.MeetsSegmentFloor(row.Count))
            {
                suppressedDepartments++;
                suppressedRespondents += row.Count;
                continue;
            }

            departmentsById.TryGetValue(row.DepartmentId.Value, out var department);
            participation.Add(new SurveyDepartmentParticipation(
                row.DepartmentId.Value,
                department?.Name ?? string.Empty,
                row.Count,
                department is { Headcount: > 0 }
                    ? Math.Round(row.Count * 100d / department.Headcount, 2)
                    : null));
        }

        participation = [.. participation.OrderBy(p => p.Name, StringComparer.Ordinal)];

        return Results.Ok(new SurveyRealTimeStatsResponse(
            survey.Id,
            survey.Status,
            SurveyStatuses.AcceptsResponses(survey.Status),
            survey.TargetAudienceCount,
            total,
            completed,
            inProgress,
            survey.TargetAudienceCount is > 0
                ? Math.Round(completed * 100d / survey.TargetAudienceCount.Value, 2)
                : null,
            total == 0 ? 0d : Math.Round(completed * 100d / total, 2),
            lastResponseAt,
            participation,
            suppressedDepartments,
            suppressedRespondents,
            unsegmented,
            SurveyResultsPrivacy.MinimumSegmentRespondents,
            PollIntervalSeconds,
            DateTimeOffset.UtcNow));
    }

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    internal sealed record ResultsContext(
        Survey Survey,
        string? Title,
        string ResolvedLocale,
        IReadOnlyList<string> FallbackFields,
        SurveyAggregate Aggregate);

    internal sealed record LoadOutcome(IResult? Failure, ResultsContext? Context);

    /// <summary>
    /// Loads and aggregates once, for the three heavy routes -- and, since #122, for the two
    /// export routes as well. They differ only in which half of the
    /// <see cref="SurveyAggregate"/> they serialise.
    /// </summary>
    /// <remarks>
    /// <b>Internal rather than private, on purpose.</b> <see cref="SurveyExportEndpoints"/>
    /// has to resolve the survey, authorize the caller, resolve the locale and aggregate in
    /// exactly the way the results screen does, because an export that loaded the same survey
    /// even slightly differently is an export that can disagree with the screen it was taken
    /// from -- including about a suppression decision. Sharing the loader is the same boundary
    /// #88 drew when report generation started calling
    /// <see cref="SurveyAggregateLoader.ComputeAsync"/>: one loader, several presentations.
    /// </remarks>
    internal static async Task<LoadOutcome> LoadAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return new LoadOutcome(SurveyNotFound(), null);
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return new LoadOutcome(Results.Forbid(), null);
        }

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();

        // The row-loading and projection live in SurveyAggregateLoader, shared with
        // report generation (#88) -- same queries, same aggregation, so the results
        // screens and a report cannot disagree about the same survey.
        var aggregate = await SurveyAggregateLoader.ComputeAsync(db, survey, locale, fallbackFields, cancellationToken);

        // ResolvedLocale names the language the caller is actually READING, not the one
        // they asked for -- identical rule and identical reasoning to
        // SurveyEndpoints.ToDetailAsync. A Spanish-only survey's results fetched with
        // ?lang=en come back with Spanish question text and must say "es".
        var resolvedLocale = LocalizedContent
            .Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language)
            .ResolvedLocale ?? locale;

        var title = SurveyContent.Resolve(
            survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);

        return new LoadOutcome(null, new ResultsContext(survey, title, resolvedLocale, fallbackFields, aggregate));
    }

    internal static IResult SurveyNotFound()
        => Results.Json(new { message = "Survey not found" }, statusCode: 404);
}
