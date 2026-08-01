namespace ClimateProject.Application.OrgStructure;

public sealed record DemographicFieldDetail(
    Guid Id,
    Guid CompanyId,
    string Field,
    string Label,
    string Type,
    List<string>? Options,
    bool Required,
    int Order,
    bool IsActive);

public sealed record DemographicFieldListResponse(IReadOnlyList<DemographicFieldDetail> Fields);

public sealed record CreateDemographicFieldRequest(
    Guid CompanyId,
    string Field,
    string Label,
    string Type,
    List<string>? Options,
    bool Required,
    int Order);

public sealed record UpdateDemographicFieldRequest(
    string? Label,
    List<string>? Options,
    bool? Required,
    int? Order,
    bool? IsActive);
