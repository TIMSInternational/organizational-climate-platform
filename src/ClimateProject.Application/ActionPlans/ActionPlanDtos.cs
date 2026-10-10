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
    DateTimeOffset CreatedAt,
    // Where the plan came from. Both were already stored and neither was ever returned:
    // `CreateActionPlanRequest` takes SourceSurveyId, the create path validates it against
    // the caller's company and writes it against a real foreign key, and the results screen
    // tags every plan it raises with `department:<id>` and `dimension:<key>`. With the list
    // carrying neither, the client could not know a plan's origin and the Planes de Accion
    // screen labelled its whole "hallazgo de origen" column sample-fed — over a column whose
    // data exists. Provenance that is written and never read is provenance nobody has.
    Guid? SourceSurveyId,
    string[] Tags,
    /// <summary>
    /// Who is answerable for the plan, and their name beside it.
    ///
    /// The name travels with the id because the alternative is worse: the list is the screen
    /// that prints a name per row, and resolving owners client-side means either one
    /// <c>GET /users/{id}</c> per plan or pulling the whole company's user list to find three
    /// of them. Neither is what the department name does -- that one is already on a list the
    /// page loads for its filter. <c>OwnerName</c> is null exactly when <c>OwnerId</c> is.
    /// </summary>
    Guid? OwnerId,
    string? OwnerName);

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
    /// <summary>The survey this plan was raised from, when it was raised from one.</summary>
    Guid? SourceSurveyId,
    /// <summary>Who is answerable for the plan; null until somebody is handed it.</summary>
    Guid? OwnerId,
    /// <inheritdoc cref="ActionPlanListItem.OwnerName"/>
    string? OwnerName,
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
    List<CreateObjectiveInput>? Objectives,
    /// <summary>
    /// Optional on create: a plan raised from a results cell has no owner yet, and saying so
    /// is honest. Validated the same way <see cref="SourceSurveyId"/> is -- the user must
    /// exist and must belong to the plan's company -- because an FK proves the row exists,
    /// never whose it is.
    ///
    /// <para>
    /// Last, and defaulted, deliberately: this is a positional record with call sites across
    /// the API, the seeds and 50-odd tests, and a parameter added anywhere but the end
    /// renames every argument after it silently. A default keeps every existing caller
    /// meaning what it meant.
    /// </para>
    /// </summary>
    Guid? OwnerId = null);

public sealed record UpdateActionPlanRequest(
    LocalizedInput? Title,
    LocalizedInput? Description,
    DateTimeOffset? DueDate,
    string? Status,
    string? Priority,
    string[]? Tags,
    /// <summary>
    /// Reassign the plan. <c>null</c> means "not in this request" and leaves the owner alone,
    /// which is how every other optional field on this record behaves; UNASSIGNING is
    /// therefore a separate flag rather than a null, because one value cannot mean both "do
    /// not touch" and "set to nothing" -- and silently clearing an owner on every update that
    /// omitted the field is the bug that shape produces.
    /// </summary>
    Guid? OwnerId = null,
    /// <summary>Clear the owner. Refused together with <see cref="OwnerId"/>.</summary>
    bool? ClearOwner = null);

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
