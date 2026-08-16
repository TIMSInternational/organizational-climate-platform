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
            // for the survey's own language, with no ?lang to honour. The fallback list
            // is per-survey plumbing the report does not print -- question text never
            // reaches the document, only category names and department names do.
            var locale = SurveyContent.ResolveRequestLocale(null, survey.Language);
            var fallbackFields = new List<string>();
            var aggregate = await SurveyAggregateLoader.ComputeAsync(db, survey, locale, fallbackFields, cancellationToken);
            var surveyTitle = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);
            sections.Add(ReportSurveySections.ToSection(survey.Id, surveyTitle, survey.Status, aggregate));
        }

        report.Status = "completed";
        report.GenerationCompletedAt = DateTimeOffset.UtcNow;
        // ReportOutput is mapped as jsonb (ReportConfiguration.cs) -- Npgsql requires the
        // stored text to already be valid JSON, so the document must be serialized (same
        // pattern as MicroclimateEndpoints.cs's WordCloudData), not assigned raw.
        // JsonSerializerOptions.Web so the stored document is camelCase like every other
        // payload this API hands a browser -- reportOutput is delivered verbatim to the web app.
        report.ReportOutput = JsonSerializer.Serialize(
            new ReportOutputDocument(
                // Honest scope (#88): what the document still does not carry. Each item
                // is issue-sized on its own; none may be faked in the meantime.
                // TODO(#88 follow-up): per-question distributions and open-text word
                //   clouds per survey (SurveyAggregate.Questions, projected like
                //   ReportSurveySections does departments).
                // TODO(#88 follow-up): demographic breakdowns beyond department
                //   (SurveyAggregate.Breakdowns already computes and suppresses them;
                //   the projection just does not print them yet).
                // TODO(#88 follow-up): benchmark comparisons (#61's boundary applies:
                //   reuse BenchmarkEndpoints' source, do not re-derive).
                "Sections not yet generated: per-question distributions, word clouds, demographic breakdowns, benchmark comparisons.",
                sections,
                ReportAIInsights.ToSection(insights)),
            JsonSerializerOptions.Web);
        report.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
