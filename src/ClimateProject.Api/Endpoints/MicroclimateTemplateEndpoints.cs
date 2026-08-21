using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
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

        // Instantiation. A POST because it creates a microclimate; on the template rather
        // than on /microclimates because the template is what is being acted on and what
        // gets its usage counted. Mirrors POST /survey-templates/{id}/use (#107).
        group.MapPost("/{id:guid}/use", UseAsync);
    }

    /// <summary>
    /// READ access to a template. Laxer than <see cref="CanWriteTemplate"/> on purpose: a
    /// company admin may SEE and USE a global template, which is what a global template is
    /// for. Mirrors <c>SurveyTemplateEndpoints.CanReadTemplate</c>.
    /// </summary>
    private static bool CanReadTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is null || currentUser.CompanyId == templateCompanyId.Value.ToString();
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

    // ------------------------------------------------------------------
    // Instantiate
    // ------------------------------------------------------------------

    /// <summary>Fallback window when the template's own duration is missing or nonsensical.</summary>
    private static readonly TimeSpan DefaultMicroclimateWindow = TimeSpan.FromMinutes(30);

    private static async Task<IResult> UseAsync(
        Guid id,
        UseMicroclimateTemplateRequest? request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.MicroclimateTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return Results.Json(new { message = "Template not found" }, statusCode: 404);
        }

        // READ access to the template, not write: using a global template is exactly what a
        // global template is for. The check that follows is about the MICROCLIMATE being
        // created, in the target company.
        if (!CanReadTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        if (!template.IsActive)
        {
            // Retired rather than deleted, so it stays readable as the provenance of
            // microclimates already created from it -- but it must not seed new ones.
            return Results.Json(new { message = "This template is no longer active" }, statusCode: 400);
        }

        // A SuperAdmin has no implicit tenant since #191, so they must name one; a
        // CompanyAdmin's own company is the only legal answer and may be omitted.
        var targetCompanyId = request?.CompanyId ?? CompanyScope.OwnCompanyId(currentUser);
        if (targetCompanyId is null)
        {
            return Results.Json(new { message = "CompanyId is required" }, statusCode: 400);
        }

        if (!Roles.Admin.Contains(currentUser.Role)
            || !MicroclimateEndpoints.CanAccessCompany(currentUser, targetCompanyId.Value))
        {
            return Results.Forbid();
        }

        var company = await db.Companies
            .FirstOrDefaultAsync(c => c.Id == targetCompanyId.Value, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = $"Company {targetCompanyId} not found" }, statusCode: 400);
        }

        if (request?.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return Results.Json(
                new { message = $"Invalid language: {request.Language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" },
                statusCode: 400);
        }

        var questions = await db.MicroclimateTemplateQuestions
            .Where(q => q.TemplateId == template.Id)
            .OrderBy(q => q.Order)
            .ToListAsync(cancellationToken);
        var questionIds = questions.Select(q => q.Id).ToList();
        var options = await db.MicroclimateTemplateQuestionOptions
            .Where(o => questionIds.Contains(o.MicroclimateTemplateQuestionId))
            .ToListAsync(cancellationToken);

        // The template's OWN authored language comes before the company's default. An
        // English-only template instantiated into a Spanish company would otherwise produce a
        // microclimate declaring itself Spanish while holding only English text -- content
        // that reads correctly, fails its own publish gate, and blames a translation the
        // author never had.
        var language = ContentLanguages.NormaliseLanguage(request?.Language)
                       ?? MicroclimateTemplateLanguage.Infer(questions)
                       ?? ContentLanguages.NormaliseLanguage(company.Settings.Language)
                       ?? ContentLanguages.FallbackLocale;

        var titleInput = request?.Title ?? LocalizedInput.FromBare(template.Name);
        if (!titleInput.TryResolve(language, "title", out var titleEn, out var titleEs, out var titleError))
        {
            return Results.Json(new { message = titleError }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(titleEn) && string.IsNullOrWhiteSpace(titleEs))
        {
            return Results.Json(new { message = "Title is required" }, statusCode: 400);
        }

        string? descriptionEn = null;
        string? descriptionEs = null;
        if (request?.Description is not null)
        {
            if (!request.Description.TryResolve(language, "description", out descriptionEn, out descriptionEs, out var descriptionError))
            {
                return Results.Json(new { message = descriptionError }, statusCode: 400);
            }
        }
        else if (ContentLanguages.SingleLocaleOf(language) is string singleLocale)
        {
            // Description is optional, so an un-attributable template description is left out
            // rather than 400'd: refusing to create the microclimate over a field the caller
            // never asked for would be the validation getting in its own way.
            if (singleLocale == ContentLanguages.Spanish)
            {
                descriptionEs = template.Description;
            }
            else
            {
                descriptionEn = template.Description;
            }
        }

        var startTime = request?.StartTime ?? DateTimeOffset.UtcNow;

        // This is what Settings.DefaultDurationMinutes is for. Guarded against a
        // non-positive stored value, which would otherwise produce EndTime <= StartTime and
        // a microclimate that can never be answered.
        var duration = template.Settings.DefaultDurationMinutes > 0
            ? TimeSpan.FromMinutes(template.Settings.DefaultDurationMinutes)
            : DefaultMicroclimateWindow;
        var endTime = request?.EndTime ?? startTime + duration;
        if (startTime >= endTime)
        {
            return Results.Json(new { message = "StartTime must be before EndTime" }, statusCode: 400);
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;

        var created = MicroclimateTemplateInstantiation.Instantiate(
            new MicroclimateTemplateStructure(template, questions, options),
            Guid.NewGuid(),
            now,
            Guid.NewGuid,
            new MicroclimateInstantiationOptions(
                targetCompanyId.Value,
                actingUser?.Id ?? Guid.Empty,
                language,
                titleEn?.Trim(),
                titleEs?.Trim(),
                descriptionEn,
                descriptionEs,
                startTime,
                endTime,
                request?.Timezone ?? company.Settings.Timezone ?? "UTC",
                request?.TargetParticipantCount ?? template.Settings.MaxParticipants ?? 0,
                template.Settings.AnonymousByDefault,
                template.Settings.ShowLiveResults));

        db.Microclimates.Add(created.Microclimate);
        db.MicroclimateQuestions.AddRange(created.Questions);
        db.MicroclimateQuestionOptions.AddRange(created.Options);

        template.UsageCount += 1;
        template.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(
            await MicroclimateEndpoints.ToDetailAsync(created.Microclimate, db, lang, cancellationToken),
            statusCode: 201);
    }
}
