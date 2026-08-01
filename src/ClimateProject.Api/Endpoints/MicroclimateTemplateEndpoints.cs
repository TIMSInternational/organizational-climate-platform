using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class MicroclimateTemplateEndpoints
{
    public static void MapMicroclimateTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimate-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
    }

    private static MicroclimateTemplateDetail ToDetail(MicroclimateTemplate t)
        => new(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.IsSystemTemplate, t.UsageCount, t.IsActive);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        // Matches MicroclimateEndpoints.CanAccessCompany and this file's own CreateAsync:
        // SuperAdmin (any company) or CompanyAdmin (own company only). Without the
        // Roles.Admin.Contains check, any employee/supervisor/leader in the company could
        // list its templates plus every system template, while being 403'd from listing
        // microclimates -- an inconsistent authorization model between the two endpoint
        // files added in this branch.
        if (!Roles.Admin.Contains(currentUser.Role)
            || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString()))
        {
            return Results.Forbid();
        }

        var templates = await db.MicroclimateTemplates
            .Where(t => (t.CompanyId == companyId || t.CompanyId == null) && t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new MicroclimateTemplateDetail(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.IsSystemTemplate, t.UsageCount, t.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new MicroclimateTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateMicroclimateTemplateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        if (currentUser.Role != Roles.SuperAdmin
            && (!request.CompanyId.HasValue || currentUser.CompanyId != request.CompanyId.Value.ToString()))
        {
            // Non-SuperAdmins must supply their own CompanyId; a null CompanyId would create
            // an IsSystemTemplate=true template visible to every company (see ListAsync's
            // `t.CompanyId == companyId || t.CompanyId == null` filter), which only SuperAdmins
            // are allowed to do.
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Description) || string.IsNullOrWhiteSpace(request.Category))
        {
            return Results.Json(new { message = "Name, description, and category are required" }, statusCode: 400);
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description.Trim(),
            Category = request.Category,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id,
            IsSystemTemplate = !request.CompanyId.HasValue,
            UsageCount = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(template), statusCode: 201);
    }
}
