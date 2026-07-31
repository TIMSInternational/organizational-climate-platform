namespace ClimateProject.Application.OrgStructure;

public sealed record DepartmentListItem(
    Guid Id,
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive,
    int EmployeeCount);

public sealed record DepartmentListResponse(IReadOnlyList<DepartmentListItem> Departments);

public sealed record DepartmentDetail(
    Guid Id,
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive,
    int EmployeeCount);

public sealed record CreateDepartmentRequest(
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive);

public sealed record UpdateDepartmentRequest(
    string? Name,
    string? Description,
    bool? IsActive);
