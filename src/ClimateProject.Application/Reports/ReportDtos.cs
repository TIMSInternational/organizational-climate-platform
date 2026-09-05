using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

/// <summary>
/// A row of <c>GET /admin/reports</c>.
///
/// <para>The three schedule columns are on the LIST and not only on the detail on purpose. A
/// recurring report is invisible from its own row otherwise, and "which of these forty reports
/// mails itself every month" is the question an administrator opens this screen to answer.
/// Making them fetch each report to find out would also be forty requests to render one
/// table.</para>
/// </summary>
public sealed record ReportListItem(
    Guid Id,
    string Title,
    string Type,
    Guid CompanyId,
    string Status,
    string Format,
    DateTimeOffset CreatedAt,
    bool IsRecurring,
    string? RecurrencePattern,
    DateTimeOffset? NextGeneration);

/// <summary>
/// One department's participation as a report prints it.
///
/// A projection of <see cref="SurveySegmentResult"/> that only ever DROPS fields --
/// never recomputes one. In particular <see cref="IsSuppressed"/> is the aggregation's
/// own suppression decision carried verbatim: when it is true the aggregation has
/// already zeroed <see cref="RespondentCount"/>, so a suppressed department's headcount
/// does not exist anywhere in the report document for a renderer to leak.
/// </summary>
public sealed record ReportDepartmentParticipation(
    string DepartmentId,
    string? Name,
    int RespondentCount,
    double? ParticipationRate,
    bool IsSuppressed);

/// <summary>
/// One dimension's score inside ONE segment -- a department's or a demographic group's
/// reading on one question category.
/// </summary>
/// <remarks>
/// A row shape rather than a <c>Dictionary&lt;string, double?&gt;</c> on purpose. The key
/// is a question <c>Category</c> written by a survey author, and dictionary keys do not go
/// through <c>JsonSerializerOptions.Web</c>'s property naming policy while property names
/// do -- so a document carrying both would camel-case one half of itself and not the
/// other, and a category named "Work Life Balance" would arrive as a JSON key with a space
/// in it. Rows also carry a deterministic order; an object's keys do not.
/// </remarks>
/// <param name="AverageScore">
/// The pooled mean <see cref="SurveyAggregation.SegmentDimensionScores"/> computes, which
/// is the same arithmetic the whole-survey rollup and the climate-over-time matrix use.
/// Null when the segment answered nothing scoreable in this dimension -- "no score" and
/// "zero" are different claims.
/// </param>
public sealed record ReportSegmentDimensionScore(string Dimension, double? AverageScore);

/// <summary>
/// One demographic group as a report prints it -- the same projection rule as
/// <see cref="ReportDepartmentParticipation"/>, applied to a group that has no headcount
/// and therefore no participation rate for one to be computed against.
/// </summary>
/// <param name="Key">
/// The stable, locale-independent demographic value the aggregation grouped on. Never a
/// label resolved for a reader's language: two readings of the same survey must name the
/// same group the same way.
/// </param>
/// <param name="RespondentCount">
/// Already ZERO when <paramref name="IsSuppressed"/> is true. The aggregation zeroes a
/// sub-floor group before this projection ever sees it, so a withheld group's size does
/// not exist in the document for a renderer to leak; the withheld total survives once, on
/// <see cref="ReportDemographicBreakdown.SuppressedRespondentCount"/>.
/// </param>
/// <param name="Dimensions">Empty for a suppressed group, for the same reason and by the same mechanism.</param>
public sealed record ReportSegmentParticipation(
    string Key,
    string? Label,
    int RespondentCount,
    bool IsSuppressed,
    IReadOnlyList<ReportSegmentDimensionScore> Dimensions);

/// <summary>
/// One demographic dimension of a survey -- tenure, role, location, whatever
/// <c>response_demographics</c> carried -- broken into its groups.
/// </summary>
/// <remarks>
/// Department is deliberately NOT one of these: it has a denominator and therefore a
/// participation rate, and it is printed as <see cref="ReportSurveySection.Departments"/>.
/// Every other dimension the aggregation found is printed here, in the aggregation's own
/// order, with the aggregation's own suppression decisions.
/// </remarks>
/// <param name="UnsegmentedRespondentCount">Completed responses carrying no value for this field at all, so the groups reconcile against the participation counters rather than appearing to lose people.</param>
public sealed record ReportDemographicBreakdown(
    string Dimension,
    IReadOnlyList<ReportSegmentParticipation> Segments,
    int SuppressedSegmentCount,
    int SuppressedRespondentCount,
    int UnsegmentedRespondentCount);

/// <summary>
/// One survey's section of a generated report: participation, per-question distributions
/// and word clouds, per-dimension scores, department participation and demographic
/// breakdowns. Everything here is the shared <see cref="SurveyAggregate"/> re-shaped --
/// the same numbers, floors and suppression decisions the results screens serve, which is
/// what makes "the PDF and the results page disagree" impossible rather than unlikely.
/// </summary>
/// <param name="ResolvedLocale">
/// The locale the printed question text and option labels are in. A report is a company
/// document with no <c>?lang</c> to honour, so this is resolved from the survey's own
/// language -- but a reader of the stored document has no other way to know which language
/// they are looking at, and the section only started printing authored text with #88's
/// follow-up.
/// </param>
/// <param name="Participation">Always populated, even below the disclosure floor -- a count identifies nobody.</param>
/// <param name="Questions">
/// The per-question results VERBATIM -- <see cref="SurveyQuestionResult"/> itself, not a
/// re-shape of it: distributions keyed by the stable option value, and for open-ended
/// questions <see cref="SurveyQuestionResult.Words"/>, which is a frequency map floored at
/// <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/> and is the ONLY open-text
/// surface this platform has. Verbatim response text is never carried by that type, so it
/// cannot be carried by this one. Empty when <paramref name="IsSuppressed"/> is true.
/// </param>
/// <param name="Dimensions">Empty when <paramref name="IsSuppressed"/> is true.</param>
/// <param name="SuppressedDepartmentCount">Withheld departments, reported as a count so totals still reconcile without naming the group sizes.</param>
/// <param name="Demographics">Every non-department breakdown the aggregation produced. Empty when <paramref name="IsSuppressed"/> is true.</param>
public sealed record ReportSurveySection(
    Guid SurveyId,
    string? Title,
    string Status,
    string ResolvedLocale,
    SurveyResultsSummary Participation,
    IReadOnlyList<SurveyQuestionResult> Questions,
    IReadOnlyList<SurveyDimensionResult> Dimensions,
    IReadOnlyList<ReportDepartmentParticipation> Departments,
    int SuppressedDepartmentCount,
    int SuppressedRespondentCount,
    int UnsegmentedRespondentCount,
    IReadOnlyList<ReportDemographicBreakdown> Demographics,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize);

/// <summary>
/// One benchmark of the report's company, read against its own prior period.
/// </summary>
/// <remarks>
/// <para>
/// Every number here comes from <c>BenchmarkPriorPeriod</c> -- the same
/// <c>LoadMetricsAsync</c> ordering and the same <c>BuildChanges</c> subtraction that
/// <c>GET /admin/benchmarks/{id}</c> serves -- so the report cannot print a year-over-year
/// figure the benchmark page disagrees with. #61's boundary, one surface down: a report is
/// a presentation, never a second derivation.
/// </para>
/// <para>
/// Scope is the tenant rule itself, not a copy of it: <c>BenchmarkEndpoints.ReadableBy</c>
/// decides which benchmarks a company may read (its own, plus the global rows every tenant
/// compares against), so a report generated for a company carries exactly what a
/// CompanyAdmin of that company can read. <paramref name="PriorPeriod"/> is null when the
/// link points at a row outside that scope, on the same terms the detail route withholds
/// it on.
/// </para>
/// </remarks>
/// <param name="CompanyId">Null for a global benchmark -- the ones every tenant reads and only a SuperAdmin writes.</param>
/// <param name="PriorPeriodStatus">
/// One of <c>PriorPeriodStatuses</c>. Reported because a null <paramref name="PriorPeriod"/>
/// cannot tell "this benchmark has no prior period" from "nobody has linked one yet" from
/// "the link points somewhere this company may not read".
/// </param>
public sealed record ReportBenchmarkComparison(
    Guid BenchmarkId,
    string Name,
    string Category,
    string Type,
    Guid? CompanyId,
    string PriorPeriodStatus,
    IReadOnlyList<BenchmarkMetricDto> Metrics,
    BenchmarkPriorPeriodDto? PriorPeriod);

public sealed record ReportDetail(
    Guid Id, string Title, string? Description, string Type, Guid CompanyId, Guid CreatedBy,
    string? TemplateId, string Status, string Format, string? ReportOutput, int DownloadCount,
    DateTimeOffset? GenerationStartedAt, DateTimeOffset? GenerationCompletedAt, DateTimeOffset CreatedAt,
    bool IsRecurring, string? RecurrencePattern, DateTimeOffset? NextGeneration);

/// <summary>
/// What a report is told to include (#88's "report configuration and filter model").
///
/// <para><b>Every field narrows and none widens.</b> A filter chooses among the sections the
/// generator would have produced anyway; it cannot lower an anonymity floor, add a breakdown,
/// or reach a survey outside the report's own company. That is a property of the shape, not a
/// promise in a comment: the only survey field is a list of ids that is intersected with the
/// company's own surveys, and the rest are booleans that can turn a section off.</para>
///
/// <para><b>Why one model rather than the legacy two.</b> The surface being replaced had both
/// <c>reports/filters</c> and <c>reports/configuration</c>, and the schema still carries a
/// <c>config</c> jsonb column beside <c>filters</c>. Two records describing one question are
/// two places to disagree, and a reader would have to know which one won. This is stored whole
/// in <c>filters</c>; <c>config</c> stays unused, and dropping it is a migration nobody needs
/// today.</para>
/// </summary>
/// <param name="SurveyIds">
/// The surveys to cover, or <see langword="null"/> for all of them -- which is what every
/// report written before this existed carries, so an absent filter must keep generating exactly
/// what it generated yesterday. An <b>empty list</b> is refused rather than read as "none":
/// a document with no survey sections is far more likely to be a caller mistake than a request,
/// and "omit the field" already says "all" unambiguously.
/// </param>
public sealed record ReportFilters(
    IReadOnlyList<Guid>? SurveyIds = null,
    bool IncludeAiInsights = true,
    bool IncludeBenchmarks = true,
    bool IncludeComparison = true);

/// <summary>
/// What the generator actually included, recorded in the document itself.
///
/// <para><b>This exists so a reader can tell an empty section from an excluded one.</b> It is
/// the same distinction the anonymity floor forces everywhere else in this document: absent and
/// withheld are different statements, and a section that is simply missing says neither. A PDF
/// with no benchmarks should not leave an auditor deciding whether the company has none or
/// whether somebody filtered them out.</para>
/// </summary>
/// <param name="AllSurveys">True when no survey filter was applied.</param>
/// <param name="SurveyCount">How many survey sections the document carries.</param>
public sealed record ReportScope(
    bool AllSurveys,
    int SurveyCount,
    bool AiInsightsIncluded,
    bool BenchmarksIncluded,
    bool ComparisonIncluded);

public sealed record CreateReportRequest(
    string Title,
    string? Description,
    string Type,
    Guid CompanyId,
    string Format,
    string? TemplateId,
    /// <summary>Optional. Absent means the whole company, which is the pre-existing behaviour.</summary>
    ReportFilters? Filters = null);

/// <summary>
/// Body of <c>PUT /admin/reports/{id}/schedule</c> -- the writer for the three columns
/// <c>ScheduledReportJob</c> has always read and nothing has ever set.
/// </summary>
/// <param name="Pattern">
/// One of <see cref="RecurrenceSchedule.All"/>. Nullable so that a body omitting it, or
/// sending <c>null</c>, is refused by the endpoint's own validation with a message naming the
/// six accepted values -- rather than by the serializer, which would answer a bare 400 the
/// caller cannot act on.
/// </param>
/// <param name="StartAt">
/// When the FIRST occurrence should fire, UTC. Optional: omitted means one period from now,
/// computed in the company's timezone. A value in the past is refused rather than advanced --
/// see the endpoint for why that differs from the job's catch-up rule.
/// </param>
public sealed record SetReportScheduleRequest(string? Pattern, DateTimeOffset? StartAt);
