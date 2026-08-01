using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/users").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPut("/{id:guid}/role", UpdateRoleAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static UserListItem ToListItem(User u)
        => new(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt);

    private static UserDetail ToDetail(User u)
        => new(u.Id, u.CompanyId, u.Email, u.Name, u.Role, u.DepartmentId, u.ManagerId, u.IsActive, u.LastLoginAt, u.CreatedAt);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? role,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var query = db.Users.Where(u => u.CompanyId == companyId);
        if (departmentId.HasValue)
        {
            query = query.Where(u => u.DepartmentId == departmentId.Value);
        }

        if (!string.IsNullOrWhiteSpace(role))
        {
            query = query.Where(u => u.Role == role);
        }

        var users = await query
            .OrderBy(u => u.Name)
            .Select(u => new UserListItem(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new UserListResponse(users));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(ToDetail(user));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateUserRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        // Deactivating an admin-role account (company_admin or super_admin) is a
        // privilege-escalation-adjacent surface: a CompanyAdmin's CompanyId can match a
        // super_admin's (signup assigns CompanyId from email domain), which would let a
        // lower-privileged CompanyAdmin lock out a super_admin -- or another company_admin,
        // including themselves. Only a SuperAdmin may flip IsActive for an admin-role
        // target; general field edits for admin-role users still go through untouched.
        if (request.IsActive.HasValue && currentUser.Role != Roles.SuperAdmin && Roles.Admin.Contains(user.Role))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            user.Name = request.Name.Trim();
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }

            user.DepartmentId = request.DepartmentId.Value;
        }

        if (request.ManagerId.HasValue)
        {
            var manager = await db.Users.FirstOrDefaultAsync(m => m.Id == request.ManagerId.Value, cancellationToken);
            if (manager is null || manager.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Manager must exist in the same company" }, statusCode: 400);
            }

            user.ManagerId = request.ManagerId.Value;
        }

        if (request.IsActive.HasValue)
        {
            user.IsActive = request.IsActive.Value;
        }

        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(user));
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid id,
        UpdateUserRoleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!Roles.All.Contains(request.Role))
        {
            return Results.Json(new { message = "Invalid role" }, statusCode: 400);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        user.Role = request.Role;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(user));
    }
}
