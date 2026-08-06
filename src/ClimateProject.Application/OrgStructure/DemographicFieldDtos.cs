using ClimateProject.Application.Localization;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Same shape and same reasoning as a question option (#195): a stable
/// locale-independent <see cref="Value"/> -- which is what user_demographics stores
/// and what dashboard filters and exports group by -- beside a display label already
/// resolved for the request's locale. One rule for options, not two.
/// </summary>
public sealed record DemographicFieldOptionDto(int Order, string Value, string? Label);

public sealed record DemographicFieldDetail(
    Guid Id,
    Guid CompanyId,
    string Field,
    string? Label,
    string Type,
    List<DemographicFieldOptionDto>? Options,
    bool Required,
    int Order,
    bool IsActive,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

public sealed record DemographicFieldListResponse(IReadOnlyList<DemographicFieldDetail> Fields);

public sealed record DemographicFieldOptionInput(string? Value, LocalizedInput? Label);

public sealed record CreateDemographicFieldRequest(
    Guid CompanyId,
    string Field,
    LocalizedInput? Label,
    string Type,
    List<DemographicFieldOptionInput>? Options,
    bool Required,
    int Order);

public sealed record UpdateDemographicFieldRequest(
    LocalizedInput? Label,
    List<DemographicFieldOptionInput>? Options,
    bool? Required,
    int? Order,
    bool? IsActive);
