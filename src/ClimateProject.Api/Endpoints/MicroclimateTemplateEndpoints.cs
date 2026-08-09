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

    /// <summary>
    /// A company admin may WRITE only templates scoped to their own company. In this
    /// codebase <c>CompanyId == null</c> means GLOBAL -- <see cref="ListAsync"/> returns
    /// those rows to every tenant, and <c>IsSystemTemplate</c> is derived from exactly the
    /// same null -- so null is the most privileged value the field can take, not the
    /// absence of a value.
    ///
    /// Note the <c>is not null</c>: it is what stops "no companyId" from being read as
    /// "nothing to check". Guarding tenant scope behind <c>request.CompanyId.HasValue</c>
    /// had it backwards, and let a company admin create a global system template simply by
    /// omitting the field (#256, the #207 shape). Mirrors
    /// <see cref="SurveyTemplateEndpoints"/> and <see cref="BenchmarkEndpoints"/>.
    ///
    /// Read access stays a separate, laxer rule: a company admin may SEE global templates.
    /// </summary>
    private static bool CanWriteTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is not null && currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString())
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
        if (!CanWriteTemplate(currentUser, request.CompanyId))
        {
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
