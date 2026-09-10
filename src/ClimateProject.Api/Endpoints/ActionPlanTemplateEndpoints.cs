using ClimateProject.Application.Localization;
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

    private static ActionPlanTemplateDetail ToDetail(ActionPlanTemplate t, string? lang)
    {
        // #210: resolved for the reader, never nameEn/nameEs; FallbackFields says which
        // field had to reach for the other language.
        var locale = ContentLanguages.NormaliseLocale(lang) ?? ContentLanguages.FallbackLocale;
        var fallbackFields = new List<string>();
        var name = AuthoredContent.Resolve(t.NameEn, t.NameEs, locale, "name", fallbackFields) ?? string.Empty;
        var description = AuthoredContent.Resolve(t.DescriptionEn, t.DescriptionEs, locale, "description", fallbackFields) ?? string.Empty;
        return new(t.Id, name, description, t.Category, t.CompanyId, t.Tags, t.UsageCount, t.IsActive, fallbackFields);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var rows = await db.ActionPlanTemplates
            .Where(t => t.CompanyId == companyId || t.CompanyId == null)
            .Where(t => t.IsActive)
            .ToListAsync(cancellationToken);

        // Ordered by the name the reader can see (#210); Id second so two same-named
        // templates cannot swap places between reads.
        var templates = rows
            .Select(t => ToDetail(t, lang))
            .OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.Id)
            .ToList();

        return Results.Ok(new ActionPlanTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanTemplateRequest request,
        string? lang,
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

        if (request.Name is null || request.Description is null || string.IsNullOrWhiteSpace(request.Category))
        {
            return Results.Json(new { message = "Name, description, and category are required" }, statusCode: 400);
        }

        // #210: a bare name lands in the company's language, or the author's for a
        // system-wide template -- never refused; { "en": ..., "es": ... } is explicit.
        var attribution = await AuthoredWrites.AttributionLocaleAsync(db, currentUser, request.CompanyId, null, cancellationToken);
        var name = AuthoredWrites.Apply(request.Name, attribution, "name", "Name is required", required: true, null, null);
        if (name.Error is not null) return name.Error;
        var description = AuthoredWrites.Apply(request.Description, attribution, "description", "Description is required", required: true, null, null);
        if (description.Error is not null) return description.Error;

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            NameEn = name.En,
            NameEs = name.Es,
            DescriptionEn = description.En,
            DescriptionEs = description.Es,
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

        return Results.Json(ToDetail(template, lang), statusCode: 201);
    }
}
