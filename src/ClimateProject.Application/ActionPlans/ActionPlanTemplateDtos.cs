using ClimateProject.Application.Localization;

namespace ClimateProject.Application.ActionPlans;

/// <summary>
/// Read shape. <c>Name</c> and <c>Description</c> are #210 paired columns, already
/// resolved for the request's locale, with <c>FallbackFields</c> naming the ones that had
/// to reach for the other language. <c>Category</c> is a facet key, not content.
/// </summary>
public sealed record ActionPlanTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    string[] Tags,
    int UsageCount,
    bool IsActive,
    IReadOnlyList<string> FallbackFields);

public sealed record ActionPlanTemplateListResponse(IReadOnlyList<ActionPlanTemplateDetail> Templates);

public sealed record CreateActionPlanTemplateRequest(
    LocalizedInput? Name,
    LocalizedInput? Description,
    string Category,
    Guid? CompanyId,
    string[]? Tags);
