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
    List<ObjectiveDto> Objectives);

public sealed record CreateKpiInput(string Name, decimal TargetValue, string Unit, string MeasurementFrequency);
public sealed record CreateObjectiveInput(string Description, string SuccessCriteria);

public sealed record CreateActionPlanRequest(
    string Title,
    string Description,
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
    string? Title,
    string? Description,
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
