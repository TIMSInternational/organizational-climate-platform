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
