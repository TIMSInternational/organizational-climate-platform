using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Admin CRUD for notification templates (#96), replacing the legacy
/// <c>api/notifications/templates</c> surface.
///
/// The legacy implementation handed personalization-rule conditions to the JavaScript
/// Function constructor. Nothing here evaluates a condition as code: conditions are
/// parsed by <see cref="NotificationConditionParser"/> (#73), which is a whitelist
/// grammar admitting exactly one comparison, and this endpoint's contribution is to run
/// that parser on write so an admin gets a 400 rather than a rule that silently never
/// fires.
/// </summary>
public static class NotificationTemplateEndpoints
{
    // The channels a template body can target. "email" is the only one with a subject
    // line, which is why the activation gate below asks for a subject only there.
    private static readonly string[] ValidChannels = ["email", "in_app", "sms", "push"];

    public static void MapNotificationTemplateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/notification-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/preview", PreviewAsync);
    }

    // Read access: a CompanyAdmin may view global templates (CompanyId == null, which
    // every tenant's notifications can be rendered from) as well as their own company's.
    private static bool CanReadTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is null || currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    // Write access: a CompanyAdmin may only create/edit templates scoped to their OWN
    // company. Global templates are readable by every tenant, so a CompanyAdmin write
    // there would let one tenant change the emails every other tenant sends -- global
    // templates are SuperAdmin-only to write, the same rule Benchmark applies.
    //
    // Note this is a separate check from CanReadTemplate rather than a reuse of it: the
    // notifications plan's own sketch reused one helper for both and would have let a
    // CompanyAdmin PUT a global template.
    private static bool CanWriteTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is not null && currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.NotificationTemplates.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            // Since #191 a user's company claim can be absent, so this is a TryParse
            // rather than a Guid.Parse that would throw on a blank claim. A
            // CompanyAdmin without a company sees global templates only.
            var ownCompanyId = CompanyScope.OwnCompanyId(currentUser);
            query = query.Where(t => t.CompanyId == null || t.CompanyId == ownCompanyId);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(t => t.CompanyId == companyId.Value);
        }

        var templates = await query
            .OrderBy(t => t.Name)
            .Select(t => new NotificationTemplateListItem(
                t.Id, t.Name, t.Type, t.Channel, t.CompanyId, t.IsActive, t.IsDefault))
            .ToListAsync(cancellationToken);

        return Results.Ok(new NotificationTemplateListResponse(templates));
    }

    private static async Task<IResult> CreateAsync(
        CreateNotificationTemplateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanWriteTemplate(currentUser, request.CompanyId)) return Results.Forbid();

        var name = request.Name?.Trim();
        var type = request.Type?.Trim();
        var channel = request.Channel?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(channel))
        {
            return Results.Json(new { message = "Name, Type, and Channel are required" }, statusCode: 400);
        }

        if (!ValidChannels.Contains(channel))
        {
            return Results.Json(new { message = $"Invalid channel '{channel}'. Supported: {string.Join(", ", ValidChannels)}" }, statusCode: 400);
        }

        if (request.CompanyId.HasValue
            && !await db.Companies.AnyAsync(c => c.Id == request.CompanyId.Value, cancellationToken))
        {
            return Results.Json(new { message = "CompanyId does not reference an existing company" }, statusCode: 400);
        }

        var contentLanguage = await ResolveContentLanguageAsync(db, request.CompanyId, cancellationToken);

        if (!TryResolveBodies(request.Subject, request.Title, request.Content, request.HtmlContent, contentLanguage, out var body, out var bodyError))
        {
            return Results.Json(new { message = bodyError }, statusCode: 400);
        }

        if (!TryPrepareChildren(request.Variables, request.Rules, out var variables, out var rules, out var childError))
        {
            return Results.Json(new { message = childError }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(),
            Name = name,
            Type = type,
            Channel = channel,
            SubjectEn = body.SubjectEn,
            SubjectEs = body.SubjectEs,
            TitleEn = body.TitleEn,
            TitleEs = body.TitleEs,
            ContentEn = body.ContentEn,
            ContentEs = body.ContentEs,
            HtmlContentEn = body.HtmlContentEn,
            HtmlContentEs = body.HtmlContentEs,
            CompanyId = request.CompanyId,
            IsActive = request.IsActive,
            IsDefault = request.IsDefault,
            CreatedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken),
            CreatedAt = now,
            UpdatedAt = now,
        };

        if (template.IsActive
            && FindMissingTranslations(template, contentLanguage) is { Count: > 0 } missing)
        {
            return Results.Json(new { message = ContentPublishValidation.Describe(missing) }, statusCode: 400);
        }

        db.NotificationTemplates.Add(template);
        foreach (var variable in variables)
        {
            variable.NotificationTemplateId = template.Id;
            db.NotificationTemplateVariables.Add(variable);
        }
        foreach (var rule in rules)
        {
            rule.NotificationTemplateId = template.Id;
            db.NotificationPersonalizationRules.Add(rule);
        }
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, template.Id, lang, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.NotificationTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null) return Results.Json(new { message = "Template not found" }, statusCode: 404);
        if (!CanReadTemplate(currentUser, template.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, lang, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateNotificationTemplateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.NotificationTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null) return Results.Json(new { message = "Template not found" }, statusCode: 404);
        if (!CanWriteTemplate(currentUser, template.CompanyId)) return Results.Forbid();

        var contentLanguage = await ResolveContentLanguageAsync(db, template.CompanyId, cancellationToken);

        if (!TryResolveBodies(request.Subject, request.Title, request.Content, request.HtmlContent, contentLanguage, out var body, out var bodyError))
        {
            return Results.Json(new { message = bodyError }, statusCode: 400);
        }

        if (!TryPrepareChildren(request.Variables, request.Rules, out var variables, out var rules, out var childError))
        {
            return Results.Json(new { message = childError }, statusCode: 400);
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            template.Name = request.Name.Trim();
        }

        // Null means "the caller did not send this locale", which is not the same as
        // "blank it" -- an empty string is. That distinction is what lets an editor
        // save a Spanish translation without wiping the English one.
        template.SubjectEn = body.SubjectEn ?? template.SubjectEn;
        template.SubjectEs = body.SubjectEs ?? template.SubjectEs;
        template.TitleEn = body.TitleEn ?? template.TitleEn;
        template.TitleEs = body.TitleEs ?? template.TitleEs;
        template.ContentEn = body.ContentEn ?? template.ContentEn;
        template.ContentEs = body.ContentEs ?? template.ContentEs;
        template.HtmlContentEn = body.HtmlContentEn ?? template.HtmlContentEn;
        template.HtmlContentEs = body.HtmlContentEs ?? template.HtmlContentEs;

        if (request.IsActive.HasValue)
        {
            template.IsActive = request.IsActive.Value;
        }
        template.UpdatedAt = DateTimeOffset.UtcNow;

        if (template.IsActive
            && FindMissingTranslations(template, contentLanguage) is { Count: > 0 } missing)
        {
            return Results.Json(new { message = ContentPublishValidation.Describe(missing) }, statusCode: 400);
        }

        // Child rows are fully replaced, never incrementally diffed -- the notifications
        // plan's constraint, and it keeps ordering-free lists unambiguous.
        if (request.Variables is not null)
        {
            db.NotificationTemplateVariables.RemoveRange(
                await db.NotificationTemplateVariables.Where(v => v.NotificationTemplateId == id).ToListAsync(cancellationToken));
            foreach (var variable in variables)
            {
                variable.NotificationTemplateId = id;
                db.NotificationTemplateVariables.Add(variable);
            }
        }

        if (request.Rules is not null)
        {
            db.NotificationPersonalizationRules.RemoveRange(
                await db.NotificationPersonalizationRules.Where(r => r.NotificationTemplateId == id).ToListAsync(cancellationToken));
            foreach (var rule in rules)
            {
                rule.NotificationTemplateId = id;
                db.NotificationPersonalizationRules.Add(rule);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await LoadDetailAsync(db, id, lang, cancellationToken));
    }

    /// <summary>
    /// Renders a template against caller-supplied variable values.
    ///
    /// This is the only place a stored condition is evaluated, and it goes through
    /// <see cref="NotificationConditionParser.Evaluate"/>, which re-parses and compares.
    /// A condition that is not a single comparison is false, never executed -- so the
    /// preview of a template carrying an injection string returns an unmatched rule,
    /// not a side effect.
    /// </summary>
    private static async Task<IResult> PreviewAsync(
        Guid id,
        NotificationTemplatePreviewRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.NotificationTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null) return Results.Json(new { message = "Template not found" }, statusCode: 404);
        if (!CanReadTemplate(currentUser, template.CompanyId)) return Results.Forbid();

        var contentLanguage = await ResolveContentLanguageAsync(db, template.CompanyId, cancellationToken);
        var locale = ContentLanguages.NormaliseLocale(request.Lang)
                     ?? ContentLanguages.SingleLocaleOf(contentLanguage)
                     ?? ContentLanguages.FallbackLocale;

        var declaredVariables = await db.NotificationTemplateVariables
            .Where(v => v.NotificationTemplateId == id)
            .ToListAsync(cancellationToken);
        var rules = await db.NotificationPersonalizationRules
            .Where(r => r.NotificationTemplateId == id)
            .ToListAsync(cancellationToken);

        var declared = declaredVariables.ToDictionary(v => v.Name, v => v.DefaultValue, StringComparer.Ordinal);
        var values = NotificationTemplateRenderer.BuildValues(declared, request.Variables);

        var fallbackFields = new List<string>();
        var subject = Resolve(template.SubjectEn, template.SubjectEs, locale, contentLanguage, "subject", fallbackFields);
        var title = Resolve(template.TitleEn, template.TitleEs, locale, contentLanguage, "title", fallbackFields);
        var content = Resolve(template.ContentEn, template.ContentEs, locale, contentLanguage, "content", fallbackFields);
        var htmlContent = Resolve(template.HtmlContentEn, template.HtmlContentEs, locale, contentLanguage, "htmlContent", fallbackFields);

        var preview = new NotificationTemplatePreview(
            NotificationTemplateRenderer.Render(subject, values, escapeHtml: false),
            NotificationTemplateRenderer.Render(title, values, escapeHtml: false),
            NotificationTemplateRenderer.Render(content, values, escapeHtml: false),
            NotificationTemplateRenderer.Render(htmlContent, values, escapeHtml: true),
            [.. rules.Where(r => NotificationConditionParser.Evaluate(r.Condition, values)).Select(r => r.Id)],
            NotificationTemplateRenderer.FindMissingRequired(
                declaredVariables.Where(v => v.Required).Select(v => v.Name), values),
            locale,
            fallbackFields);

        return Results.Ok(preview);
    }

    /// <summary>
    /// The language a template is authored in.
    ///
    /// NotificationTemplate has no <c>Language</c> column -- adding one would mean an EF
    /// migration, and it is derivable. A company template inherits its company's
    /// <c>Settings.Language</c>. A global template has no company to inherit from and is
    /// readable by every tenant regardless of that tenant's language, so it is
    /// <c>both</c>: a bare string is rejected with an explanatory 400 rather than
    /// guessed into the English column, and activating it requires both translations.
    /// </summary>
    private static async Task<string> ResolveContentLanguageAsync(
        ClimateProjectDbContext db,
        Guid? companyId,
        CancellationToken cancellationToken)
    {
        if (companyId is null)
        {
            return ContentLanguages.Both;
        }

        var language = await db.Companies
            .Where(c => c.Id == companyId.Value)
            .Select(c => c.Settings.Language)
            .FirstOrDefaultAsync(cancellationToken);

        return ContentLanguages.NormaliseLanguage(language) ?? ContentLanguages.FallbackLocale;
    }

    private readonly record struct TemplateBody(
        string? SubjectEn,
        string? SubjectEs,
        string? TitleEn,
        string? TitleEs,
        string? ContentEn,
        string? ContentEs,
        string? HtmlContentEn,
        string? HtmlContentEs);

    private static bool TryResolveBodies(
        LocalizedInput? subject,
        LocalizedInput? title,
        LocalizedInput? content,
        LocalizedInput? htmlContent,
        string contentLanguage,
        out TemplateBody body,
        out string? error)
    {
        body = default;
        error = null;

        string? subjectEn = null, subjectEs = null, titleEn = null, titleEs = null;
        string? contentEn = null, contentEs = null, htmlEn = null, htmlEs = null;

        if (subject is not null && !subject.TryResolve(contentLanguage, "subject", out subjectEn, out subjectEs, out error)) return false;
        if (title is not null && !title.TryResolve(contentLanguage, "title", out titleEn, out titleEs, out error)) return false;
        if (content is not null && !content.TryResolve(contentLanguage, "content", out contentEn, out contentEs, out error)) return false;
        if (htmlContent is not null && !htmlContent.TryResolve(contentLanguage, "htmlContent", out htmlEn, out htmlEs, out error)) return false;

        body = new TemplateBody(subjectEn, subjectEs, titleEn, titleEs, contentEn, contentEs, htmlEn, htmlEs);
        return true;
    }

    /// <summary>
    /// The activation gate. An active template is what an employee actually receives, so
    /// it must be authored in every locale its own language demands -- the same
    /// write-time rule #195 applies to publishing a survey, for the same reason: a
    /// read-time fallback can only ever make "no untranslated strings" usually true.
    /// A subject is only demanded for the one channel that has one.
    /// </summary>
    private static IReadOnlyList<MissingTranslation> FindMissingTranslations(
        NotificationTemplate template,
        string contentLanguage)
        => ContentPublishValidation.FindMissing(contentLanguage,
        [
            new LocalizedFieldValue("title", template.TitleEn, template.TitleEs, Required: true),
            new LocalizedFieldValue("content", template.ContentEn, template.ContentEs, Required: true),
            new LocalizedFieldValue("subject", template.SubjectEn, template.SubjectEs,
                Required: string.Equals(template.Channel, "email", StringComparison.Ordinal)),
            new LocalizedFieldValue("htmlContent", template.HtmlContentEn, template.HtmlContentEs, Required: false),
        ]);

    private static bool TryPrepareChildren(
        IReadOnlyList<NotificationTemplateVariableInput>? variableInputs,
        IReadOnlyList<NotificationPersonalizationRuleInput>? ruleInputs,
        out List<NotificationTemplateVariable> variables,
        out List<NotificationPersonalizationRule> rules,
        out string? error)
    {
        variables = [];
        rules = [];
        error = null;

        var index = 0;
        foreach (var input in variableInputs ?? [])
        {
            var name = input.Name?.Trim();
            var type = input.Type?.Trim();
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(type))
            {
                error = $"variables[{index}] requires a name and a type";
                return false;
            }

            if (variables.Any(v => string.Equals(v.Name, name, StringComparison.Ordinal)))
            {
                error = $"variables[{index}] duplicates the name '{name}'";
                return false;
            }

            // default_value is a jsonb column: an unparseable document is a 400 naming
            // the field rather than a 22P02 surfacing as a 500.
            if (!NotificationTemplateRenderer.IsValidJson(input.DefaultValue))
            {
                error = $"variables[{index}].defaultValue must be a JSON document (a string default is \"quoted\")";
                return false;
            }

            variables.Add(new NotificationTemplateVariable
            {
                Id = Guid.NewGuid(),
                NotificationTemplateId = Guid.Empty,
                Name = name,
                Type = type,
                Required = input.Required,
                Description = input.Description?.Trim() ?? string.Empty,
                DefaultValue = input.DefaultValue,
            });
            index++;
        }

        index = 0;
        foreach (var input in ruleInputs ?? [])
        {
            // The point of the whole #73 exercise: a condition that is not a single
            // comparison never reaches storage. Rejecting on write means the admin who
            // typed it finds out, instead of the rule quietly never firing.
            if (!NotificationConditionParser.TryParse(input.Condition, out _))
            {
                error = $"rules[{index}].condition is not a supported comparison. Use the form 'field <op> value', e.g. 'reminderCount >= 3'";
                return false;
            }

            if (!NotificationTemplateRenderer.IsValidJson(input.Modifications))
            {
                error = $"rules[{index}].modifications must be a JSON document";
                return false;
            }

            rules.Add(new NotificationPersonalizationRule
            {
                Id = Guid.NewGuid(),
                NotificationTemplateId = Guid.Empty,
                Condition = input.Condition!.Trim(),
                Modifications = input.Modifications,
            });
            index++;
        }

        return true;
    }

    private static string? Resolve(
        string? en,
        string? es,
        string locale,
        string contentLanguage,
        string fieldPath,
        List<string> fallbackFields)
    {
        var resolved = LocalizedContent.Resolve(en, es, locale, contentLanguage);
        if (resolved.IsFallback)
        {
            fallbackFields.Add(fieldPath);
        }

        return resolved.Text;
    }

    // PersonaExternalId first, then Id -- see ActingUserResolver for why the order is
    // load-bearing. The Guid.Empty fallback for an unresolvable caller is pre-existing
    // behaviour, deliberately left alone by #285.
    private static async Task<Guid> ResolveCurrentUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty;

    private static async Task<NotificationTemplateDetail> LoadDetailAsync(
        ClimateProjectDbContext db,
        Guid id,
        string? lang,
        CancellationToken cancellationToken)
    {
        var template = await db.NotificationTemplates.FirstAsync(t => t.Id == id, cancellationToken);
        var contentLanguage = await ResolveContentLanguageAsync(db, template.CompanyId, cancellationToken);
        var locale = ContentLanguages.NormaliseLocale(lang)
                     ?? ContentLanguages.SingleLocaleOf(contentLanguage)
                     ?? ContentLanguages.FallbackLocale;

        var variables = await db.NotificationTemplateVariables
            .Where(v => v.NotificationTemplateId == id)
            .OrderBy(v => v.Name)
            .Select(v => new NotificationTemplateVariableDto(v.Id, v.Name, v.Type, v.Required, v.Description, v.DefaultValue))
            .ToListAsync(cancellationToken);

        var rules = await db.NotificationPersonalizationRules
            .Where(r => r.NotificationTemplateId == id)
            .OrderBy(r => r.Condition)
            .Select(r => new NotificationPersonalizationRuleDto(r.Id, r.Condition, r.Modifications))
            .ToListAsync(cancellationToken);

        var fallbackFields = new List<string>();

        return new NotificationTemplateDetail(
            template.Id,
            template.Name,
            template.Type,
            template.Channel,
            Resolve(template.SubjectEn, template.SubjectEs, locale, contentLanguage, "subject", fallbackFields),
            Resolve(template.TitleEn, template.TitleEs, locale, contentLanguage, "title", fallbackFields),
            Resolve(template.ContentEn, template.ContentEs, locale, contentLanguage, "content", fallbackFields),
            Resolve(template.HtmlContentEn, template.HtmlContentEs, locale, contentLanguage, "htmlContent", fallbackFields),
            template.CompanyId,
            template.IsActive,
            template.IsDefault,
            template.CreatedBy,
            template.CreatedAt,
            template.UpdatedAt,
            variables,
            rules,
            contentLanguage,
            locale,
            fallbackFields);
    }
}
