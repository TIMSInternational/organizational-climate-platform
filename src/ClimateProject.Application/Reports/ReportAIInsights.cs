using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Reports;

/// <summary>
/// One AI insight as it appears inside a generated report.
///
/// <para>
/// <see cref="ConfidenceScore"/> is an integer percentage 0-100, copied straight off
/// <see cref="AIInsight.ConfidenceScore"/>. This is the field the bug in #152 was about: the
/// legacy app registered two Mongoose models under the name <c>AIInsight</c> -- one in
/// <c>models/AIInsight.ts</c> with <c>confidenceScore</c> 0-100, one in <c>models/Analytics.ts</c>
/// with <c>confidence_score</c> 0-1 -- and <c>report-service.ts</c> imported the second. Whichever
/// registered first won at runtime, so the report's AI insights section could come back empty or
/// wrong with no error. Nothing in a report may read a fractional confidence: the only 0-1
/// confidence in this codebase is <see cref="MicroclimateAiInsight.Confidence"/>, which is a
/// different entity for a different surface.
/// </para>
/// </summary>
public sealed record ReportAIInsightItem(
    Guid Id,
    string Type,
    string Category,
    string Title,
    string Description,
    int ConfidenceScore,
    string Priority,
    IReadOnlyList<string> AffectedSegments,
    IReadOnlyList<string> RecommendedActions,
    bool IsAcknowledged);

/// <summary>
/// The document persisted to <c>reports.report_output</c>.
///
/// <para>
/// <see cref="Surveys"/> is real aggregation (#88): one <see cref="ReportSurveySection"/> per
/// non-draft survey of the company, each a projection of the same <c>SurveyAggregate</c> the
/// results screens serve -- participation, per-question distributions, open-text word
/// frequencies, per-dimension scores, departments and demographic breakdowns.
/// <see cref="Benchmarks"/> is the same arrangement for the benchmark surface: the readings
/// and year-over-year figures <c>GET /admin/benchmarks/{id}</c> serves, through that route's
/// own code rather than a second subtraction.
/// </para>
/// <para>
/// <see cref="GenerationNote"/> remains because the document is still not the whole report --
/// it names the sections that do not exist yet, and saying so in the document beats a
/// consumer inferring completeness from a section that happens to be present.
/// </para>
/// </summary>
public sealed record ReportOutputDocument(
    string GenerationNote,
    IReadOnlyList<ReportSurveySection> Surveys,
    IReadOnlyList<ReportAIInsightItem> AiInsights,
    IReadOnlyList<ReportBenchmarkComparison> Benchmarks);

/// <summary>
/// The single path by which a generated report reads AI insights.
///
/// <para>
/// Deliberately one place, and deliberately pure. #152's whole failure mode was a second,
/// plausible-looking source of "insights" being reached for by the report generator -- a wrong
/// shape that still compiled and still returned rows, so nothing failed and the section was just
/// quietly missing. This codebase has the same trap set for it: <see cref="AnalyticsInsight"/>
/// sits next to <see cref="AIInsight"/> in the same namespace and the same DbContext, and its
/// name reads like the thing you want. It is not. It carries aggregate metric rows
/// (<c>MetricType</c>, <c>TotalResponses</c>, <c>CalculationDate</c>) and no insight prose at
/// all, so a generator wired to it renders an AI insights section with nothing in it.
/// <see cref="AIInsight"/> is authoritative; report generation goes through here.
/// </para>
/// </summary>
public static class ReportAIInsights
{
    /// <summary>
    /// The insights belonging in a report for <paramref name="companyId"/> as of
    /// <paramref name="asOf"/>, newest first.
    ///
    /// <para>
    /// Expired insights are dropped -- <c>ExpiresAt</c> exists to say "this stopped being true",
    /// and a report that reprints it is worse than one that omits it. Acknowledged insights are
    /// kept and carry <see cref="ReportAIInsightItem.IsAcknowledged"/>, because acknowledgement
    /// records that a human saw it, not that it stopped being the case.
    /// </para>
    /// <para>
    /// The company filter compares <see cref="Guid"/> to <see cref="Guid"/>. Do not reintroduce
    /// a <c>ToString()</c> on either side: EF cannot translate it, and the tenant filter would
    /// then run client-side over every company's rows.
    /// </para>
    /// </summary>
    public static IQueryable<AIInsight> ForCompany(IQueryable<AIInsight> insights, Guid companyId, DateTimeOffset asOf)
        => insights
            .Where(i => i.CompanyId == companyId)
            .Where(i => i.ExpiresAt == null || i.ExpiresAt > asOf)
            .OrderByDescending(i => i.CreatedAt)
            .ThenBy(i => i.Id);

    /// <summary>Maps one entity to its report shape, carrying the prose rather than summarising it away.</summary>
    public static ReportAIInsightItem ToItem(AIInsight insight) => new(
        insight.Id,
        insight.Type,
        insight.Category,
        insight.Title,
        insight.Description,
        insight.ConfidenceScore,
        insight.Priority,
        insight.AffectedSegments.ToList(),
        insight.RecommendedActions.ToList(),
        insight.IsAcknowledged);

    /// <summary>The rendered AI insights section for a set of already-materialised insights.</summary>
    public static IReadOnlyList<ReportAIInsightItem> ToSection(IEnumerable<AIInsight> insights)
        => insights.Select(ToItem).ToList();
}
