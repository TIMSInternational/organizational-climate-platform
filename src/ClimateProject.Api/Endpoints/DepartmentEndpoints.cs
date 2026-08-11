using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class DepartmentEndpoints
{
    public static void MapDepartmentEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/departments").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId)
            .OrderBy(d => d.Name)
            .Select(d => new DepartmentListItem(d.Id, d.CompanyId, d.Name, d.Description, d.ParentDepartmentId, d.IsActive, d.EmployeeCount))
            .ToListAsync(cancellationToken);

        return Results.Ok(new DepartmentListResponse(departments));
    }

    private static async Task<IResult> CreateAsync(
        CreateDepartmentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 100)
        {
            return Results.Json(new { message = "Name is required and must be at most 100 characters" }, statusCode: 400);
        }

        if (request.Description is { Length: > 500 })
        {
            return Results.Json(new { message = "Description must be at most 500 characters" }, statusCode: 400);
        }

        if (request.ParentDepartmentId.HasValue)
        {
            var parent = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.ParentDepartmentId.Value, cancellationToken);
            if (parent is null || parent.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Parent department must exist in the same company" }, statusCode: 400);
            }
        }

        var duplicate = await db.Departments.FirstOrDefaultAsync(
            d => d.CompanyId == request.CompanyId
                 && d.Name == name
                 && d.ParentDepartmentId == request.ParentDepartmentId,
            cancellationToken);
        if (duplicate is not null)
        {
            return Results.Json(new { message = "Department with this name already exists at this level" }, statusCode: 400);
        }

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            Name = name,
            Description = request.Description?.Trim(),
            ParentDepartmentId = request.ParentDepartmentId,
            IsActive = request.IsActive,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        db.Departments.Add(department);
        await db.SaveChangesAsync(cancellationToken);

        // The audit row for this request is written either way (#143); this is the id it would
        // otherwise have no way to know. A create has nothing in its route to name the row it
        // made, and no endpoint in this application returns a Location header for the writer to
        // read one out of -- so a create records its subject only if the handler says what it
        // was. See AuditEntry, and docs/decisions/audit-logging.md for the endpoints still to
        // be given this line.
        audit.SetResourceId(department.Id);

        return Results.Json(
            new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount),
            statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        if (department is null)
        {
            return Results.Json(new { message = "Department not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, department.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateDepartmentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        if (department is null)
        {
            return Results.Json(new { message = "Department not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, department.CompanyId))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        if (!string.IsNullOrWhiteSpace(name) && name != department.Name)
        {
            if (name.Length > 100)
            {
                return Results.Json(new { message = "Name must be at most 100 characters" }, statusCode: 400);
            }

            var duplicate = await db.Departments.FirstOrDefaultAsync(
                d => d.CompanyId == department.CompanyId
                     && d.Name == name
                     && d.ParentDepartmentId == department.ParentDepartmentId
                     && d.Id != id,
                cancellationToken);
            if (duplicate is not null)
            {
                return Results.Json(new { message = "Department with this name already exists at this level" }, statusCode: 400);
            }

            department.Name = name;
        }

        if (request.Description is not null)
        {
            if (request.Description.Length > 500)
            {
                return Results.Json(new { message = "Description must be at most 500 characters" }, statusCode: 400);
            }

            department.Description = request.Description.Trim();
        }

        if (request.IsActive.HasValue)
        {
            department.IsActive = request.IsActive.Value;
        }

        department.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount));
    }
}
