using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Survey templates: the catalogue a survey is normally started from.
///
/// Shape follows <see cref="MicroclimateTemplateEndpoints"/> and
/// <see cref="ActionPlanTemplateEndpoints"/>; the read/write authorization split follows
/// <see cref="BenchmarkEndpoints"/>, because this surface has the property those two
/// template surfaces have and Benchmark spells out: a row with
/// <c>CompanyId == null</c> is GLOBAL and visible to every tenant, so it must be
/// super-admin-only to WRITE while staying readable by every company admin. #207 closed a
/// live hole of exactly this shape.
///
/// There is no <c>/seed</c> route. See docs/decisions/survey-template-seed.md.
/// </summary>
public static class SurveyTemplateEndpoints
{
    private const string LikeEscapeCharacter = "\\";

    /// <summary>
    /// A draft created from a template needs a window and the template cannot know one, so
    /// it gets a placeholder the wizard overwrites. Two weeks matches the fixture window
    /// used across the survey tests; the value matters far less than not inventing a
    /// zero-length window that would fail the start &lt; end check the caller never made.
    /// </summary>
    private static readonly TimeSpan DefaultSurveyWindow = TimeSpan.FromDays(14);

    public static void MapSurveyTemplateEndpoints(this WebApplication app)
    {
        // Top-level group, matching /microclimate-templates and /action-plan-templates,
        // rather than legacy's /surveys/templates. Templates are not a sub-resource of any
        // one survey, and nesting them under /surveys would put a literal segment in a
        // group whose sibling routes are all /{id:guid}.
        var group = app.MapGroup("/survey-templates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);

        // Instantiation. A POST because it creates a survey; on the template rather than on
        // /surveys because the template is what is being acted on and what gets its usage
        // counted.
        group.MapPost("/{id:guid}/use", UseAsync);
    }

    // ------------------------------------------------------------------
    // Authorization -- read and write are separate checks, deliberately
    // ------------------------------------------------------------------

    /// <summary>
    /// A company admin may READ global templates (<c>CompanyId == null</c>) as well as
    /// their own company's. That is the whole point of a global template: every tenant can
    /// start from the standard instrument.
    /// </summary>
    private static bool CanReadTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is null || currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    /// <summary>
    /// A company admin may WRITE only templates scoped to their own company. Global
    /// templates are readable by every tenant, so a company admin who could write one
    /// could rewrite the questions every other tenant starts from -- and, because
    /// instantiation deep-copies, the tampering would keep propagating into new surveys
    /// long after it happened. Global templates are super-admin-only to write.
    ///
    /// Note the <c>is not null</c>: it is what stops "no companyId" from being read as
    /// "my company". <see cref="MicroclimateTemplateEndpoints"/> currently only checks the
    /// scope when a CompanyId was supplied, so a company admin there can create a global
    /// template by omitting it -- the #207 shape, reported rather than copied.
    /// </summary>
    private static bool CanWriteTemplate(CurrentUser currentUser, Guid? templateCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return templateCompanyId is not null && currentUser.CompanyId == templateCompanyId.Value.ToString();
    }

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    private static async Task<IResult> ListAsync(
        Guid? companyId,
        string? category,
        string? q,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        var query = db.SurveyTemplates.AsQueryable();

        if (currentUser.Role == Roles.SuperAdmin)
        {
            if (companyId.HasValue)
            {
                query = query.Where(t => t.CompanyId == companyId.Value);
            }
        }
        else
        {
            // Compare Guids, never Guid.ToString(): since #191 User.CompanyId is Guid? and
            // EF cannot translate Nullable<Guid>.ToString() inside a query.
            var ownCompanyId = CompanyScope.OwnCompanyId(currentUser);
            if (ownCompanyId is null)
            {
                return Results.Forbid();
            }

            if (companyId.HasValue && companyId.Value != ownCompanyId.Value)
            {
                return Results.Forbid();
            }

            query = query.Where(t => t.CompanyId == null || t.CompanyId == ownCompanyId.Value);
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            var trimmedCategory = category.Trim();
            query = query.Where(t => t.Category == trimmedCategory);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{SurveyQueries.EscapeLike(q.Trim())}%";
            query = query.Where(t =>
                EF.Functions.ILike(t.Name, pattern, LikeEscapeCharacter)
                || EF.Functions.ILike(t.Description, pattern, LikeEscapeCharacter));
        }

        var rows = await query.OrderBy(t => t.Name).ToListAsync(cancellationToken);
        var ids = rows.Select(t => t.Id).ToList();

        // Counted in a second query rather than as a correlated subquery in the projection.
        // The listing is small, and SurveyQueries already documents that a projection shape
        // EF cannot translate throws at request time rather than at build time -- not a
        // trade worth making for one integer.
        var questionCounts = ids.Count == 0
            ? []
            : await db.TemplateQuestions
                .Where(q => ids.Contains(q.TemplateId))
                .GroupBy(q => q.TemplateId)
                .Select(g => new { TemplateId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.TemplateId, x => x.Count, cancellationToken);

        var templates = rows
            .Select(t => new SurveyTemplateListItem(
                t.Id,
                t.Name,
                t.Description,
                t.Category,
                t.Industry,
                t.CompanySize,
                t.IsPublic,
                t.CompanyId,
                t.CompanyId is null,
                t.Tags,
                t.UsageCount,
                t.Rating,
                questionCounts.GetValueOrDefault(t.Id),
                t.LastUsed,
                t.CreatedAt))
            .ToList();

        return Results.Ok(new SurveyTemplateListResponse(templates));
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    private static async Task<IResult> CreateAsync(
        CreateSurveyTemplateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanWriteTemplate(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        var description = request.Description?.Trim();
        var category = request.Category?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description) || string.IsNullOrWhiteSpace(category))
        {
            return Results.Json(new { message = "Name, description, and category are required" }, statusCode: 400);
        }

        var (companyLanguage, companyError) = await ResolveCompanyLanguageAsync(db, request.CompanyId, cancellationToken);
        if (companyError is not null)
        {
            return companyError;
        }

        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        var language = ContentLanguages.NormaliseLanguage(request.Language)
                       ?? ContentLanguages.NormaliseLanguage(companyLanguage)
                       ?? ContentLanguages.FallbackLocale;

        if (request.SourceSurveyId.HasValue)
        {
            var sourceExists = await db.Surveys.AnyAsync(s => s.Id == request.SourceSurveyId.Value, cancellationToken);
            if (!sourceExists)
            {
                return Results.Json(new { message = "SourceSurveyId does not reference an existing survey" }, statusCode: 400);
            }
        }

        var templateId = Guid.NewGuid();
        if (!SurveyTemplateQuestions.TryPrepare(request.Questions, templateId, language, Guid.NewGuid, out var prepared, out var questionError))
        {
            return Results.Json(new { message = questionError }, statusCode: 400);
        }

        var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var template = new SurveyTemplate
        {
            Id = templateId,
            Name = name,
            Description = description,
            Category = category,
            Industry = request.Industry?.Trim(),
            CompanySize = request.CompanySize?.Trim(),
            IsPublic = request.IsPublic,
            // Nullable with ON DELETE SET NULL, so an unresolvable acting user is a null
            // author rather than a 400 -- unlike surveys.created_by, which is NOT NULL.
            CreatedBy = actingUserId,
            CompanyId = request.CompanyId,
            UsageCount = 0,
            Rating = 0,
            Tags = request.Tags?.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray() ?? [],
            SourceSurveyId = request.SourceSurveyId,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.SurveyTemplates.Add(template);
        AddQuestions(db, prepared);

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(template, db, lang, cancellationToken), statusCode: 201);
    }

    // ------------------------------------------------------------------
    // Read one
    // ------------------------------------------------------------------

    private static async Task<IResult> GetAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.SurveyTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        if (!CanReadTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(template, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Update
    // ------------------------------------------------------------------

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateSurveyTemplateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.SurveyTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        // Read access is not enough. A company admin can GET a global template and must
        // still be refused here.
        if (!CanWriteTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        if (request.Name is not null)
        {
            var name = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return Results.Json(new { message = "Name is required" }, statusCode: 400);
            }

            template.Name = name;
        }

        if (request.Description is not null)
        {
            var description = request.Description.Trim();
            if (string.IsNullOrWhiteSpace(description))
            {
                return Results.Json(new { message = "Description is required" }, statusCode: 400);
            }

            template.Description = description;
        }

        if (request.Category is not null)
        {
            var category = request.Category.Trim();
            if (string.IsNullOrWhiteSpace(category))
            {
                return Results.Json(new { message = "Category is required" }, statusCode: 400);
            }

            template.Category = category;
        }

        if (request.Industry is not null) template.Industry = request.Industry.Trim();
        if (request.CompanySize is not null) template.CompanySize = request.CompanySize.Trim();
        if (request.IsPublic.HasValue) template.IsPublic = request.IsPublic.Value;
        if (request.Tags is not null)
        {
            template.Tags = request.Tags.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).ToArray();
        }

        if (request.Questions is not null)
        {
            var existingQuestions = await db.TemplateQuestions
                .Where(x => x.TemplateId == template.Id)
                .ToListAsync(cancellationToken);

            // Defaults to the language the template is ALREADY authored in, so editing a
            // Spanish template with bare strings keeps writing Spanish instead of silently
            // switching the content to the English column.
            var language = ContentLanguages.NormaliseLanguage(request.Language)
                           ?? SurveyTemplateLanguage.Infer(existingQuestions)
                           ?? ContentLanguages.FallbackLocale;

            if (!SurveyTemplateQuestions.TryPrepare(request.Questions, template.Id, language, Guid.NewGuid, out var prepared, out var questionError))
            {
                return Results.Json(new { message = questionError }, statusCode: 400);
            }

            // Replace wholesale. Unconditionally safe here in a way it is not for a survey:
            // a template has no responses, and surveys already made from it are independent
            // deep copies with their own question rows, so nothing downstream is orphaned.
            var existingIds = existingQuestions.Select(x => x.Id).ToList();
            var existingOptions = await db.TemplateQuestionOptions
                .Where(o => existingIds.Contains(o.TemplateQuestionId))
                .ToListAsync(cancellationToken);
            db.TemplateQuestionOptions.RemoveRange(existingOptions);
            db.TemplateQuestions.RemoveRange(existingQuestions);

            AddQuestions(db, prepared);
        }

        template.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(template, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Delete
    // ------------------------------------------------------------------

    private static async Task<IResult> DeleteAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.SurveyTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        if (!CanWriteTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        var questions = await db.TemplateQuestions.Where(x => x.TemplateId == id).ToListAsync(cancellationToken);
        var questionIds = questions.Select(x => x.Id).ToList();
        var options = await db.TemplateQuestionOptions
            .Where(o => questionIds.Contains(o.TemplateQuestionId))
            .ToListAsync(cancellationToken);

        // Children removed explicitly rather than left to the database cascade: the cascade
        // exists, but relying on it makes the delete's blast radius invisible at the call
        // site. Surveys previously created from this template are untouched -- they hold
        // their own copies, not references.
        db.TemplateQuestionOptions.RemoveRange(options);
        db.TemplateQuestions.RemoveRange(questions);
        db.SurveyTemplates.Remove(template);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    // ------------------------------------------------------------------
    // Instantiate
    // ------------------------------------------------------------------

    private static async Task<IResult> UseAsync(
        Guid id,
        UseSurveyTemplateRequest? request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var template = await db.SurveyTemplates.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        // READ access to the template, not write: using a global template is exactly what a
        // global template is for. The write check that follows is about the SURVEY being
        // created, in the target company.
        if (!CanReadTemplate(currentUser, template.CompanyId))
        {
            return Results.Forbid();
        }

        // A super_admin has no implicit tenant since #191, so they must name one; a
        // company_admin's own company is the only legal answer and may be omitted.
        var targetCompanyId = request?.CompanyId ?? CompanyScope.OwnCompanyId(currentUser);
        if (targetCompanyId is null)
        {
            return Results.Json(new { message = "CompanyId is required" }, statusCode: 400);
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, targetCompanyId.Value))
        {
            return Results.Forbid();
        }

        var (companyLanguage, companyError) = await ResolveCompanyLanguageAsync(db, targetCompanyId, cancellationToken);
        if (companyError is not null)
        {
            return companyError;
        }

        if (request?.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        var questions = await db.TemplateQuestions
            .Where(x => x.TemplateId == template.Id)
            .OrderBy(x => x.Order)
            .ToListAsync(cancellationToken);
        var questionIds = questions.Select(x => x.Id).ToList();
        var options = await db.TemplateQuestionOptions
            .Where(o => questionIds.Contains(o.TemplateQuestionId))
            .ToListAsync(cancellationToken);

        // The template's OWN authored language comes before the company's default. An
        // English-only template instantiated into a Spanish company would otherwise produce
        // a survey declaring itself Spanish while holding only English text -- content that
        // reads correctly, fails its own publish gate, and blames a translation the author
        // never had.
        var language = ContentLanguages.NormaliseLanguage(request?.Language)
                       ?? SurveyTemplateLanguage.Infer(questions)
                       ?? ContentLanguages.NormaliseLanguage(companyLanguage)
                       ?? ContentLanguages.FallbackLocale;

        // Falls back to the template's name, attributed by the ordinary bare-string rule.
        // For a survey authored in 'both' that attribution is refused, and the 400 tells
        // the caller to send { "en": ..., "es": ... } -- which is right: filing one
        // monolingual name into both columns is the content-mangling #195 exists to stop.
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
            // Description is optional, so an un-attributable template description is left
            // out rather than 400'd: refusing to create the survey over a field the caller
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

        var type = request?.Type?.Trim();
        if (string.IsNullOrWhiteSpace(type))
        {
            type = template.Category;
        }

        var startDate = request?.StartDate ?? DateTimeOffset.UtcNow;
        var endDate = request?.EndDate ?? startDate + DefaultSurveyWindow;
        if (startDate >= endDate)
        {
            return Results.Json(new { message = "StartDate must be before EndDate" }, statusCode: 400);
        }

        var departmentIds = (request?.DepartmentIds ?? []).Distinct().ToList();
        if (departmentIds.Count > 0)
        {
            var known = await db.Departments
                .Where(d => d.CompanyId == targetCompanyId.Value && departmentIds.Contains(d.Id))
                .Select(d => d.Id)
                .ToListAsync(cancellationToken);
            var unknown = departmentIds.Except(known).ToList();
            if (unknown.Count > 0)
            {
                return Results.Json(
                    new { message = $"Unknown department(s) for this company: {string.Join(", ", unknown)}" },
                    statusCode: 400);
            }
        }

        // surveys.created_by is NOT NULL with a RESTRICT foreign key, so an unresolvable
        // acting user is a 400 rather than Guid.Empty and an opaque 500.
        var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null)
        {
            return SurveyEndpoints.ActingUserRequired();
        }

        var now = DateTimeOffset.UtcNow;
        var created = SurveyTemplateInstantiation.Instantiate(
            new SurveyTemplateStructure(template, questions, options),
            Guid.NewGuid(),
            now,
            Guid.NewGuid,
            new SurveyInstantiationOptions(
                targetCompanyId.Value,
                actingUserId.Value,
                type,
                language,
                titleEn?.Trim(),
                titleEs?.Trim(),
                descriptionEn,
                descriptionEs,
                startDate,
                endDate,
                request?.TargetAudienceCount,
                departmentIds));

        db.Surveys.Add(created.Survey);
        db.SurveyDepartmentTargets.AddRange(created.DepartmentTargets);
        db.Questions.AddRange(created.Questions);
        db.QuestionOptions.AddRange(created.Options);

        template.UsageCount += 1;
        template.LastUsed = now;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(
            await SurveyEndpoints.ToDetailAsync(created.Survey, db, lang, cancellationToken),
            statusCode: 201);
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    private static void AddQuestions(ClimateProjectDbContext db, IReadOnlyList<PreparedTemplateQuestion> prepared)
    {
        foreach (var item in prepared)
        {
            db.TemplateQuestions.Add(item.Question);
            db.TemplateQuestionOptions.AddRange(item.Options);
        }
    }

    /// <summary>
    /// The owning company's default content language, or null for a global template.
    /// Loaded rather than assumed so an unknown CompanyId surfaces as a 400 instead of an
    /// opaque 500 out of the foreign key.
    /// </summary>
    private static async Task<(string? Language, IResult? Error)> ResolveCompanyLanguageAsync(
        ClimateProjectDbContext db,
        Guid? companyId,
        CancellationToken cancellationToken)
    {
        if (companyId is null)
        {
            return (null, null);
        }

        var company = await db.Companies
            .Where(c => c.Id == companyId.Value)
            .Select(c => new { c.Settings.Language })
            .FirstOrDefaultAsync(cancellationToken);

        return company is null
            ? (null, Results.Json(new { message = $"Company {companyId.Value} not found" }, statusCode: 400))
            : (company.Language, null);
    }

    private static async Task<SurveyTemplateDetail> ToDetailAsync(
        SurveyTemplate template,
        ClimateProjectDbContext db,
        string? lang,
        CancellationToken cancellationToken)
    {
        var questions = await db.TemplateQuestions
            .Where(x => x.TemplateId == template.Id)
            .OrderBy(x => x.Order)
            .ToListAsync(cancellationToken);

        var questionIds = questions.Select(x => x.Id).ToList();
        var optionRows = questionIds.Count == 0
            ? []
            : await db.TemplateQuestionOptions
                .Where(o => questionIds.Contains(o.TemplateQuestionId))
                .OrderBy(o => o.Order)
                .ToListAsync(cancellationToken);
        var optionsByQuestion = optionRows
            .GroupBy(o => o.TemplateQuestionId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var contentLanguage = SurveyTemplateLanguage.Infer(questions) ?? ContentLanguages.FallbackLocale;
        var locale = SurveyContent.ResolveRequestLocale(lang, contentLanguage);
        var fallbackFields = new List<string>();

        var questionDtos = questions.Select(question =>
        {
            var path = $"questions[{question.Order}]";
            optionsByQuestion.TryGetValue(question.Id, out var questionOptions);
            return new SurveyTemplateQuestionDto(
                question.Id,
                SurveyContent.Resolve(question.TextEn, question.TextEs, locale, contentLanguage, $"{path}.text", fallbackFields),
                question.Type,
                ToOptionDtos(questionOptions, locale, contentLanguage, path, fallbackFields),
                question.ScaleMin,
                question.ScaleMax,
                SurveyContent.Resolve(question.ScaleLabelMinEn, question.ScaleLabelMinEs, locale, contentLanguage, $"{path}.scaleLabelMin", fallbackFields),
                SurveyContent.Resolve(question.ScaleLabelMaxEn, question.ScaleLabelMaxEs, locale, contentLanguage, $"{path}.scaleLabelMax", fallbackFields),
                question.Required,
                question.CommentRequired,
                SurveyContent.Resolve(question.CommentPromptEn, question.CommentPromptEs, locale, contentLanguage, $"{path}.commentPrompt", fallbackFields),
                question.Order,
                question.Category);
        }).ToList();

        // ResolvedLocale names the language the caller is actually READING, not the one they
        // asked for. A Spanish-only template fetched with ?lang=en comes back in Spanish;
        // reporting "en" would be the silent substitution FallbackFields exists to prevent.
        // The first question's text is the template's identifying content, so it names the
        // payload as a whole -- an empty template has nothing to resolve and reports the
        // requested locale.
        var first = questions.OrderBy(x => x.Order).FirstOrDefault();
        var resolvedLocale = first is null
            ? locale
            : LocalizedContent.Resolve(first.TextEn, first.TextEs, locale, contentLanguage).ResolvedLocale ?? locale;

        return new SurveyTemplateDetail(
            template.Id,
            template.Name,
            template.Description,
            template.Category,
            template.Industry,
            template.CompanySize,
            template.IsPublic,
            template.CompanyId,
            template.CompanyId is null,
            template.Tags,
            template.UsageCount,
            template.Rating,
            contentLanguage,
            resolvedLocale,
            fallbackFields,
            questionDtos,
            template.SourceSurveyId,
            template.LastUsed,
            template.CreatedAt,
            template.UpdatedAt);
    }

    private static List<SurveyTemplateQuestionOptionDto>? ToOptionDtos(
        List<TemplateQuestionOption>? options,
        string locale,
        string contentLanguage,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options is null || options.Count == 0)
        {
            return null;
        }

        var dtos = new List<SurveyTemplateQuestionOptionDto>(options.Count);
        foreach (var option in options)
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, contentLanguage);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.options[{option.Order}].label");
            }

            dtos.Add(new SurveyTemplateQuestionOptionDto(option.Order, option.Value, label.Text));
        }

        return dtos;
    }

    private static IResult NotFound() => Results.Json(new { message = "Survey template not found" }, statusCode: 404);

    private static IResult InvalidLanguage(string? language)
        => Results.Json(
            new { message = $"Invalid language: {language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" },
            statusCode: 400);
}
