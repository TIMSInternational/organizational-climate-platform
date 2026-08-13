using System.Security.Claims;
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
            // COUNTED, never read from `departments.employee_count`. That column is
            // denormalised and **nothing in this codebase has ever written to it** -- no
            // user create, invitation accept, bulk import, department move or deactivation
            // touches it -- so it is 0 for every department in every environment, and this
            // endpoint reported "0 employees" for a department with nine people in it.
            //
            // The predicate is `SurveyAggregation`'s headcount predicate exactly (active
            // users in the department). It has to be: that number is the DENOMINATOR of
            // per-department participation on the results screen, so a Departments page
            // counting one population while participation counts another would put two
            // different headcounts for the same team on two screens.
            .Select(d => new DepartmentListItem(
                d.Id,
                d.CompanyId,
                d.Name,
                d.Description,
                d.ParentDepartmentId,
                d.IsActive,
                db.Users.Count(u => u.DepartmentId == d.Id && u.IsActive)))
            .ToListAsync(cancellationToken);

        return Results.Ok(new DepartmentListResponse(departments));
    }

    private static async Task<IResult> CreateAsync(
        CreateDepartmentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
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

        return Results.Json(
            // A department created a line ago has no members, so this is 0 rather than a
            // query -- but it is 0 because it was COUNTED, not because the dead column is.
            new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, 0),
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

        var employeeCount = await CountEmployeesAsync(db, department.Id, cancellationToken);
        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, employeeCount));
    }

    /// <summary>
    /// A department's headcount, derived. See the note in <see cref="ListAsync"/> for why
    /// this is never <c>Department.EmployeeCount</c>.
    /// </summary>
    private static Task<int> CountEmployeesAsync(ClimateProjectDbContext db, Guid departmentId, CancellationToken cancellationToken)
        => db.Users.CountAsync(u => u.DepartmentId == departmentId && u.IsActive, cancellationToken);

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

        var employeeCount = await CountEmployeesAsync(db, department.Id, cancellationToken);
        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, employeeCount));
    }
}
