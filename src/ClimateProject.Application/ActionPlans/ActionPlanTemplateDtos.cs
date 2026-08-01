namespace ClimateProject.Application.ActionPlans;

public sealed record ActionPlanTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    string[] Tags,
    int UsageCount,
    bool IsActive);

public sealed record ActionPlanTemplateListResponse(IReadOnlyList<ActionPlanTemplateDetail> Templates);

public sealed record CreateActionPlanTemplateRequest(
    string Name,
    string Description,
    string Category,
    Guid? CompanyId,
    string[]? Tags);
