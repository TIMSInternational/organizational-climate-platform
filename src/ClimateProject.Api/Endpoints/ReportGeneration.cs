using System.Text.Json;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The one place a report's <c>report_output</c> document is computed.
///
/// <para>Extracted from <see cref="ReportEndpoints"/>.<c>CreateAsync</c> so that scheduled
/// generation (#91, <see cref="Scheduling.DeliveringScheduledReportRunner"/>) runs the SAME
/// code as <c>POST /admin/reports</c> -- the same queries, the same shared aggregation, the
/// same projection, and therefore the same suppression decisions. A second generator here
/// would be the drift #88 and #320 exist to prevent, with the scheduled copy of the drift
/// arriving by email where nobody can diff it against the results screen.</para>
/// </summary>
internal static class ReportGeneration
{
    /// <summary>
    /// Computes <paramref name="report"/>'s output document and marks it completed.
    ///
    /// <para>Mutates the tracked entity only -- <c>Status</c>, <c>GenerationCompletedAt</c>,
    /// <c>ReportOutput</c>, <c>UpdatedAt</c> -- and deliberately never calls
    /// <c>SaveChangesAsync</c>: the endpoint saves as its own step, and the scheduled runner
    /// must leave persistence to the sweep's transaction so the document, the delivery
    /// notification and the schedule advance commit or roll back together.</para>
    /// </summary>
    /// <param name="now">The instant insights are read "as of" -- the caller's one clock.</param>
    public static async Task GenerateAsync(
        ClimateProjectDbContext db,
        Report report,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(report);

        // The AI insights section is read through ReportAIInsights, the one path (#152)
        // so that a report never silently omits insights by reading the wrong entity.
        // The filter is read from the ROW, not passed in, so the scheduled runner regenerates
        // a recurring report against its own filter without the sweep knowing filters exist.
        //
        // A filter that cannot be parsed falls back to "everything", and that is the safe
        // direction here -- unlike the comparison's public ruling, where failing open would
        // publish. A filter only ever NARROWS a document every floor already governs, so the
        // fallback is precisely the behaviour every report had before filters existed.
        var filters = ParseFilters(report.Filters);

        var insights = filters.IncludeAiInsights
            ? await ReportAIInsights
                .ForCompany(db.AIInsights.AsNoTracking(), report.CompanyId, now)
                .ToListAsync(cancellationToken)
            : [];

        // The survey sections (#88): one per non-draft survey, each the SAME aggregation
        // the results screens serve, loaded through the shared SurveyAggregateLoader and
        // projected by ReportSurveySections -- so the report and /surveys/{id}/results
        // cannot disagree about the same survey, and every suppression decision
        // (SurveyResultsPrivacy's floors) is the aggregation's own, carried verbatim.
        // Drafts are excluded because content is only editable while no responses exist:
        // a draft has nothing to aggregate, only noise rows of zeros.
        //
        // Generation stays synchronous. It streams every answer of every completed
        // response per survey, which is a page-load-sized cost per survey; a company
        // with enough surveys and responses for that to hurt is the trigger for making
        // generation a background job (the status column already models "generating"),
        // not for a cheaper aggregation.
        // The company clause stays first and is never relaxed by a filter: a named survey is
        // intersected with this company's own, so an id from another tenant selects nothing
        // rather than reaching across.
        var surveyQuery = db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == report.CompanyId && s.Status != SurveyStatuses.Draft);

        if (filters.SurveyIds is { Count: > 0 } chosen)
        {
            surveyQuery = surveyQuery.Where(s => chosen.Contains(s.Id));
        }

        var surveys = await surveyQuery
            .OrderByDescending(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);

        var sections = new List<ReportSurveySection>(surveys.Count);

        // Collected in the same pass, from the SAME aggregate each section is built from, so
        // the comparison cannot disagree with the sections above it and costs no extra query.
        // Closed and archived only, which is the window `GET /surveys/climate-trends` itself
        // reads: an open survey's reading is not final, and a movement measured against a wave
        // still collecting answers would change between two generations of one report.
        var trendInputs = new List<SurveyClimateTrends.Input>();

        foreach (var survey in surveys)
        {
            // A report is a company document, not a browser request: content resolves
            // for the survey's own language, with no ?lang to honour. The resolved locale
            // IS printed, on the section, because the section prints authored text --
            // question text, option labels and scale anchors -- and a reader of the stored
            // document would otherwise have no way to know which language it is in. The
            // fallback list stays per-survey plumbing: it names the individual fields that
            // fell back, which is an authoring diagnostic, not report content.
            var locale = SurveyContent.ResolveRequestLocale(null, survey.Language);
            var fallbackFields = new List<string>();
            var aggregate = await SurveyAggregateLoader.ComputeAsync(db, survey, locale, fallbackFields, cancellationToken);
            var surveyTitle = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);
            sections.Add(ReportSurveySections.ToSection(survey.Id, surveyTitle, survey.Status, locale, aggregate));

            if (survey.Status == SurveyStatuses.Closed || survey.Status == SurveyStatuses.Archived)
            {
                trendInputs.Add(new SurveyClimateTrends.Input(
                    survey.Id, surveyTitle, survey.Status, survey.EndDate, aggregate));
            }
        }

        // The period-over-period section (#88 follow-up): the two most recent closed waves,
        // and only those. `SurveyClimateTrends.Build` sorts oldest-first and aligns every row
        // positionally, so handing it exactly the pair keeps the dimension union to the
        // dimensions the comparison is about -- and keeps a twelve-survey time series off a
        // document `ReportShareEndpoints` serves to anonymous readers. Every floor is the
        // matrix's own; `ReportComparison` can only narrow what it publishes, never widen it.
        var comparison = !filters.IncludeComparison ? null : ReportComparison.Build(SurveyClimateTrends.Build(
            report.CompanyId,
            groupBy: null,
            trendInputs
                .OrderByDescending(i => i.EndDate)
                .ThenByDescending(i => i.SurveyId)
                .Take(ReportComparison.RequiredSurveys),
            now));

        // The benchmark section (#88): the company's own benchmarks plus the global rows
        // every tenant compares against, each with the year-over-year reading #89 computes.
        // Loaded through BenchmarkPriorPeriod -- the benchmarks route's own code -- so the
        // number a report prints is the number that route serves, byte for byte.
        var benchmarks = filters.IncludeBenchmarks
            ? await ReportBenchmarks.LoadAsync(db, report.CompanyId, cancellationToken)
            : [];

        // Recorded in the document because an absent section and an excluded one are different
        // statements, and a section that is simply missing makes neither. Same rule the
        // anonymity floor forces everywhere else here.
        var scope = new ReportScope(
            AllSurveys: filters.SurveyIds is null,
            SurveyCount: sections.Count,
            AiInsightsIncluded: filters.IncludeAiInsights,
            BenchmarksIncluded: filters.IncludeBenchmarks,
            ComparisonIncluded: filters.IncludeComparison);

        report.Status = "completed";
        report.GenerationCompletedAt = DateTimeOffset.UtcNow;
        // ReportOutput is mapped as jsonb (ReportConfiguration.cs) -- Npgsql requires the
        // stored text to already be valid JSON, so the document must be serialized (same
        // pattern as MicroclimateEndpoints.cs's WordCloudData), not assigned raw.
        // JsonSerializerOptions.Web so the stored document is camelCase like every other
        // payload this API hands a browser -- reportOutput is delivered verbatim to the web app.
        report.ReportOutput = JsonSerializer.Serialize(
            new ReportOutputDocument(
                // Honest scope (#88): what the document still does not carry, and nothing
                // more. The three follow-ups this note used to name -- per-question
                // distributions and word clouds, demographic breakdowns beyond department,
                // benchmark comparisons -- are above; the note shrank when they landed,
                // because a note that keeps claiming a gap it no longer has teaches a
                // consumer to stop reading it. Each remaining item is issue-sized on its
                // own; none may be faked in the meantime.
                // Period-over-period comparative analysis USED to be the first item here.
                // It is now built, by `ReportComparison` off `SurveyClimateTrends`' matrix --
                // the delta comes from there, as this note required, so no floor the matrix
                // applies can be bypassed by a subtraction written in the report layer.
                // The filter model and report configuration USED to be the second item here.
                // A report can now be told what to include -- `ReportFilters`, stored in the
                // `filters` jsonb column and read back above. Report TEMPLATES are deliberately
                // not built: see docs/decisions/report-templates.md for what would trigger it.
                //
                // `reports.format` USED to be the third item here and is no longer:
                // ReportEndpoints.CreateAsync validates it against ReportFormats and
                // DownloadAsync renders it through ReportRenderer, so this document is now the
                // source a real pdf or csv is produced from. The note below says only what is
                // still true -- a note that keeps claiming a gap it no longer has teaches a
                // consumer to stop reading it, which is the whole reason it shrinks rather than
                // accumulating.
                "Sections not yet generated: report configuration/filters, report templates. "
                + "The stored `format` IS rendered on download: pdf and csv are produced from this document. "
                + "Period-over-period comparison IS generated, across the two most recent closed surveys.",
                sections,
                ReportAIInsights.ToSection(insights),
                benchmarks,
                comparison,
                scope),
            JsonSerializerOptions.Web);
        report.UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// The stored filter, or an all-inclusive one when the column is empty or unreadable.
    /// </summary>
    private static ReportFilters ParseFilters(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored))
        {
            return new ReportFilters();
        }

        try
        {
            return JsonSerializer.Deserialize<ReportFilters>(stored, JsonSerializerOptions.Web)
                   ?? new ReportFilters();
        }
        catch (JsonException)
        {
            // Every report written before filters existed has a null column, and a row holding
            // something else is a data defect rather than a request. Neither may stop an
            // administrator getting their report, and neither can widen one: see the note at
            // the call site.
            return new ReportFilters();
        }
    }
}
