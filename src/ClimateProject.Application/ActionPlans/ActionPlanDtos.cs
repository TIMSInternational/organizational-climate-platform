using ClimateProject.Application.Localization;

namespace ClimateProject.Application.ActionPlans;

public sealed record KpiDto(Guid Id, string Name, decimal TargetValue, decimal CurrentValue, string Unit, string MeasurementFrequency);
public sealed record ObjectiveDto(Guid Id, string Description, string SuccessCriteria, string CurrentStatus, int CompletionPercentage);

public sealed record ActionPlanListItem(
    Guid Id,
    string Title,
    Guid CompanyId,
    Guid? DepartmentId,
    DateTimeOffset DueDate,
    string Status,
    string Priority,
    DateTimeOffset CreatedAt);

public sealed record ActionPlanListResponse(IReadOnlyList<ActionPlanListItem> ActionPlans);

public sealed record ActionPlanDetail(
    Guid Id,
    string Title,
    string Description,
    Guid CompanyId,
    Guid? DepartmentId,
    Guid CreatedBy,
    DateTimeOffset DueDate,
    string Status,
    string Priority,
    string[] Tags,
    Guid? TemplateId,
    List<KpiDto> Kpis,
    List<ObjectiveDto> Objectives,
    // #210: Title, Description and every KPI/objective text arrive resolved for the
    // request's locale; the paths below ("title", "kpis[0].unit", ...) name the ones that
    // had to reach for the other language.
    IReadOnlyList<string> FallbackFields);

public sealed record CreateKpiInput(LocalizedInput? Name, decimal TargetValue, LocalizedInput? Unit, string MeasurementFrequency);
public sealed record CreateObjectiveInput(LocalizedInput? Description, LocalizedInput? SuccessCriteria);

public sealed record CreateActionPlanRequest(
    LocalizedInput? Title,
    LocalizedInput? Description,
    Guid CompanyId,
    Guid? DepartmentId,
    DateTimeOffset DueDate,
    string Priority,
    string[]? Tags,
    Guid? TemplateId,
    Guid? SourceSurveyId,
    Guid? SourceInsightId,
    List<CreateKpiInput>? Kpis,
    List<CreateObjectiveInput>? Objectives);

public sealed record UpdateActionPlanRequest(
    LocalizedInput? Title,
    LocalizedInput? Description,
    DateTimeOffset? DueDate,
    string? Status,
    string? Priority,
    string[]? Tags);

public sealed record KpiUpdateInput(Guid KpiId, decimal NewValue, string? Notes);
public sealed record ObjectiveUpdateInput(Guid ObjectiveId, string StatusUpdate, int? CompletionPercentage, string? Notes);

public sealed record RecordProgressRequest(
    string OverallNotes,
    List<KpiUpdateInput>? KpiUpdates,
    List<ObjectiveUpdateInput>? ObjectiveUpdates);

public sealed record ProgressUpdateDetail(
    Guid Id,
    DateTimeOffset UpdateDate,
    string OverallNotes,
    Guid UpdatedBy);
