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
        var insights = await ReportAIInsights
            .ForCompany(db.AIInsights.AsNoTracking(), report.CompanyId, now)
            .ToListAsync(cancellationToken);

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
        var surveys = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == report.CompanyId && s.Status != SurveyStatuses.Draft)
            .OrderByDescending(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);

        var sections = new List<ReportSurveySection>(surveys.Count);
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
        }

        // The benchmark section (#88): the company's own benchmarks plus the global rows
        // every tenant compares against, each with the year-over-year reading #89 computes.
        // Loaded through BenchmarkPriorPeriod -- the benchmarks route's own code -- so the
        // number a report prints is the number that route serves, byte for byte.
        var benchmarks = await ReportBenchmarks.LoadAsync(db, report.CompanyId, cancellationToken);

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
                // TODO(#88 follow-up): period-over-period comparative analysis -- the same
                //   survey, or the same dimension, across two windows. Every input exists
                //   (SurveyClimateTrends already computes the matrix); nothing projects it
                //   into this document yet, and the delta must come from there rather than
                //   from a subtraction written here.
                // TODO(#88 follow-up): report configuration, the filter model and report
                //   templates. `reports.template_id` is a free string today with no
                //   template table behind it, so a report cannot yet be told WHAT to
                //   include -- every document is the whole company.
                // TODO(#88 follow-up): `reports.format` is stored and not honoured. This
                //   document is JSON whatever a caller asked for; there is no PDF or
                //   spreadsheet renderer, and download hands back the same JSON.
                "Sections not yet generated: period-over-period comparative analysis, report configuration/filters, "
                + "report templates. The requested `format` is not rendered: this document is JSON whatever was asked for.",
                sections,
                ReportAIInsights.ToSection(insights),
                benchmarks),
            JsonSerializerOptions.Web);
        report.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
