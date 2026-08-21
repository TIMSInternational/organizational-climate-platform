using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Microclimates;

public sealed record MicroclimateTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    bool IsSystemTemplate,
    int UsageCount,
    bool IsActive);

public sealed record MicroclimateTemplateListResponse(IReadOnlyList<MicroclimateTemplateDetail> Templates);

public sealed record CreateMicroclimateTemplateRequest(
    string Name,
    string Description,
    string Category,
    Guid? CompanyId);

/// <summary>
/// Body of <c>POST /microclimate-templates/{id}/use</c>. Every field is optional: the point
/// of instantiating a template is that it already knows the answers.
/// </summary>
/// <param name="CompanyId">
/// Required in practice for a SuperAdmin, who has no implicit tenant since #191. A
/// CompanyAdmin's own company is the only legal answer and may be omitted.
/// </param>
/// <param name="Title">
/// Defaults to the template's name, attributed by the ordinary bare-string rule. For a
/// template authored in 'both' that attribution is refused with a 400 asking for
/// <c>{ "en": ..., "es": ... }</c> -- filing one monolingual name into both columns is the
/// content-mangling #195 exists to stop.
/// </param>
/// <param name="EndTime">
/// Defaults to <paramref name="StartTime"/> plus the template's own
/// <c>Settings.DefaultDurationMinutes</c>, which is that field's entire purpose.
/// </param>
public sealed record UseMicroclimateTemplateRequest(
    Guid? CompanyId = null,
    LocalizedInput? Title = null,
    LocalizedInput? Description = null,
    DateTimeOffset? StartTime = null,
    DateTimeOffset? EndTime = null,
    int? TargetParticipantCount = null,
    string? Timezone = null,
    string? Language = null);
