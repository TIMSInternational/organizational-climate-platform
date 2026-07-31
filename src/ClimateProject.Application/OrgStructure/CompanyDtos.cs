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
