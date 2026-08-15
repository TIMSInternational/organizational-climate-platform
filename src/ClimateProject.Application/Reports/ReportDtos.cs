using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

public sealed record ReportListItem(Guid Id, string Title, string Type, Guid CompanyId, string Status, string Format, DateTimeOffset CreatedAt);

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
/// One survey's section of a generated report: participation, per-dimension scores and
/// department participation. Everything here is the shared <see cref="SurveyAggregate"/>
/// re-shaped -- the same numbers, floors and suppression decisions the results screens
/// serve, which is what makes "the PDF and the results page disagree" impossible rather
/// than unlikely.
/// </summary>
/// <param name="Participation">Always populated, even below the disclosure floor -- a count identifies nobody.</param>
/// <param name="Dimensions">Empty when <paramref name="IsSuppressed"/> is true.</param>
/// <param name="SuppressedDepartmentCount">Withheld departments, reported as a count so totals still reconcile without naming the group sizes.</param>
public sealed record ReportSurveySection(
    Guid SurveyId,
    string? Title,
    string Status,
    SurveyResultsSummary Participation,
    IReadOnlyList<SurveyDimensionResult> Dimensions,
    IReadOnlyList<ReportDepartmentParticipation> Departments,
    int SuppressedDepartmentCount,
    int SuppressedRespondentCount,
    int UnsegmentedRespondentCount,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize);

public sealed record ReportDetail(
    Guid Id, string Title, string? Description, string Type, Guid CompanyId, Guid CreatedBy,
    string? TemplateId, string Status, string Format, string? ReportOutput, int DownloadCount,
    DateTimeOffset? GenerationStartedAt, DateTimeOffset? GenerationCompletedAt, DateTimeOffset CreatedAt);

public sealed record CreateReportRequest(string Title, string? Description, string Type, Guid CompanyId, string Format, string? TemplateId);
