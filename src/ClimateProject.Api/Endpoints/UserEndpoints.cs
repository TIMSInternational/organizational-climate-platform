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

    private static UserDetail ToDetail(User u, IReadOnlyDictionary<string, string> demographics)
        => new(u.Id, u.CompanyId, u.Email, u.Name, u.Role, u.DepartmentId, u.ManagerId, u.IsActive, u.LastLoginAt, u.CreatedAt, demographics);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? role,
        string? demographicField,
        string? demographicValue,
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

        // The reason #193 exists: with demographics living in a jsonb blob, "show me
        // everyone in this company whose <custom field> is <value>" -- required for
        // every dashboard filter and export in req.md 2.2 -- had no server-side
        // answer. Now it is a join over user_demographics, index-backed by
        // IX_user_demographics_demographic_field_id_value.
        if (!string.IsNullOrWhiteSpace(demographicValue) && string.IsNullOrWhiteSpace(demographicField))
        {
            return Results.Json(new { message = "demographicValue requires demographicField" }, statusCode: 400);
        }

        if (!string.IsNullOrWhiteSpace(demographicField))
        {
            var fieldKey = demographicField.Trim();
            var fieldIds = db.DemographicFields
                .Where(f => f.CompanyId == companyId && f.Field == fieldKey)
                .Select(f => f.Id);

            var matches = db.UserDemographics.Where(d => fieldIds.Contains(d.DemographicFieldId));
            if (!string.IsNullOrWhiteSpace(demographicValue))
            {
                var wanted = demographicValue.Trim();
                matches = matches.Where(d => d.Value == wanted);
            }

            query = query.Where(u => matches.Select(d => d.UserId).Contains(u.Id));
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

        var demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        return Results.Ok(ToDetail(user, demographics));
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

        var now = DateTimeOffset.UtcNow;
        IReadOnlyDictionary<string, string> demographics;

        if (request.Demographics is null)
        {
            // Omitted entirely: leave the existing answers untouched, just echo them.
            demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        }
        else
        {
            var definitions = await DemographicValueStore.LoadDefinitionsAsync(db, user.CompanyId, cancellationToken);
            var validation = DemographicValueValidation.Validate(request.Demographics, definitions, enforceRequired: true);
            if (!validation.IsValid)
            {
                return Results.Json(new { message = string.Join("; ", validation.Errors) }, statusCode: 400);
            }

            await DemographicValueStore.ReplaceForUserAsync(db, user.Id, validation.Values, now, cancellationToken);
            demographics = DemographicValueStore.ToMap(validation.Values);
        }

        user.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(user, demographics));
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

        var demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        return Results.Ok(ToDetail(user, demographics));
    }
}
