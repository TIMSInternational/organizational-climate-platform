namespace ClimateProject.Application.OrgStructure;

public sealed record UserListItem(
    Guid Id,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt);

public sealed record UserListResponse(IReadOnlyList<UserListItem> Users);

public sealed record UserDetail(
    Guid Id,
    // Null for a user with no tenant -- a global super_admin (#191).
    Guid? CompanyId,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    IReadOnlyDictionary<string, string> Demographics);

public sealed record UpdateUserRequest(
    string? Name,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool? IsActive,
    // Null means "leave demographics alone"; a non-null map REPLACES the user's
    // full demographic set (an omitted or blank key clears that answer), which is
    // why required-field enforcement applies here and not at invitation time.
    Dictionary<string, string?>? Demographics = null);

public sealed record UpdateUserRoleRequest(string Role);
