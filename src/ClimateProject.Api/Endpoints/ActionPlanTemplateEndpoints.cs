using System.Security.Claims;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ActionPlanTemplateEndpoints
{
    public static void MapActionPlanTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/action-plan-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static ActionPlanTemplateDetail ToDetail(ActionPlanTemplate t)
        => new(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.Tags, t.UsageCount, t.IsActive);

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

        var templates = await db.ActionPlanTemplates
            .Where(t => t.CompanyId == companyId || t.CompanyId == null)
            .Where(t => t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new ActionPlanTemplateDetail(t.Id, t.Name, t.Description, t.Category, t.CompanyId, t.Tags, t.UsageCount, t.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new ActionPlanTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanTemplateRequest request,
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
            // Non-super-admins must scope the template to their own company; only a
            // super_admin may create a system-wide template (CompanyId == null), which
            // would otherwise be visible to every tenant via the List query.
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Description) || string.IsNullOrWhiteSpace(request.Category))
        {
            return Results.Json(new { message = "Name, description, and category are required" }, statusCode: 400);
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description.Trim(),
            Category = request.Category,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            Tags = request.Tags ?? [],
            UsageCount = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(template), statusCode: 201);
    }
}
