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
    Guid CompanyId,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt);

public sealed record UpdateUserRequest(
    string? Name,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool? IsActive);

public sealed record UpdateUserRoleRequest(string Role);
