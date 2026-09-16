namespace ClimateProject.Application.OrgStructure;

public sealed record CompanyListItem(
    Guid Id,
    string Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier,
    DateTimeOffset CreatedAt);

public sealed record CompanyListResponse(IReadOnlyList<CompanyListItem> Companies);

public sealed record CompanyDetail(
    Guid Id,
    string Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier,
    DateTimeOffset CreatedAt,
    int UserCount);

public sealed record CreateCompanyRequest(
    string Name,
    string EmailDomain,
    string Industry,
    string Size,
    string Country,
    string? SubscriptionTier);

public sealed record UpdateCompanyRequest(
    string? Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier);

/// <summary>
/// One metered climate service's licence state for a company, for the super-admin surface.
/// <see cref="Licensed"/> is false when no licence row exists yet (the service is unmetered /
/// grandfathered); the seat counts are then zero and <see cref="Status"/> is the default.
/// </summary>
public sealed record CompanyServiceLicenseView(
    string ServiceType,
    int SeatsTotal,
    int SeatsUsed,
    string Status,
    bool Licensed,
    string? Notes,
    DateTimeOffset? UpdatedAt);

public sealed record CompanyLicensesResponse(IReadOnlyList<CompanyServiceLicenseView> Services);

/// <summary>Grant or adjust a service licence. <see cref="SeatsTotal"/> is the new seat total (≥ 0).</summary>
public sealed record GrantLicenseRequest(int SeatsTotal, string? Notes);
