using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Questions;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class MicroclimateEndpoints
{
    // Shared with Program.cs's rate limiter registration -- this is the only
    // unauthenticated write surface in the domain (POST /responses), so it gets its
    // own named policy rather than a global limiter that would also throttle
    // authenticated admin traffic.
    internal const string ResponseSubmissionRateLimiterPolicy = "microclimate-response-submission";

    public static void MapMicroclimateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        // AllowAnonymous so the public MicroclimateRespondPage (Task 7) can load a microclimate's
        // title/questions without a JWT -- GetAsync still enforces its own access rule below
        // (authenticated requests get the usual CanAccessCompany check; unauthenticated requests
        // are only served when the microclimate is configured for AnonymousResponses AND is
        // currently active, mirroring the policy SubmitResponseAsync already enforces for the
        // actual submission, and are served a reduced PublicMicroclimateDetail payload instead
        // of the full admin detail).
        group.MapGet("/{id:guid}", GetAsync).AllowAnonymous();
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapGet("/{id:guid}/live-results", GetLiveResultsAsync);

        // Only unauthenticated write surface in the app -- rate-limited per client IP so a
        // single visitor/bot holding the microclimate's GUID can't unboundedly inflate
        // ResponseCount/EngagementLevel/the word cloud (individual responses aren't persisted,
        // so there is nothing to reconcile against after the fact).
        app.MapPost("/microclimates/{id:guid}/responses", SubmitResponseAsync)
            .RequireRateLimiting(ResponseSubmissionRateLimiterPolicy);
    }

    // SuperAdmin can access any company; CompanyAdmin only their own. Every other role
    // (employee/supervisor/leader) is deliberately excluded -- matches the identically-named
    // helper in ActionPlanEndpoints and the plan's Global Constraint ("Roles.Admin.Contains +
    // own-company for CompanyAdmin, any for SuperAdmin"). Do not weaken this to a bare
    // CompanyId match: that previously let any authenticated employee of the company rewrite
    // Title/Description/EndTime and flip Status via PUT /microclimates/{id}.
    internal static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    internal static async Task<MicroclimateDetail> ToDetailAsync(
        Microclimate m,
        ClimateProjectDbContext db,
        string? lang,
        CancellationToken cancellationToken)
    {
        var locale = MicroclimateContent.ResolveRequestLocale(lang, m.Language);
        var fallbackFields = new List<string>();
        var questions = await LoadQuestionDtosAsync(m, db, locale, fallbackFields, cancellationToken);

        return new MicroclimateDetail(
            m.Id,
            MicroclimateContent.Resolve(m.TitleEn, m.TitleEs, locale, m.Language, "title", fallbackFields),
            MicroclimateContent.Resolve(m.DescriptionEn, m.DescriptionEs, locale, m.Language, "description", fallbackFields),
            m.CompanyId, m.CreatedBy, m.Status,
            m.ResponseCount, m.TargetParticipantCount, m.Scheduling.StartTime, m.Scheduling.EndTime,
            m.RealtimeSettings.AnonymousResponses, m.RealtimeSettings.ShowLiveResults, questions,
            m.Language, locale, fallbackFields);
    }

    private static async Task<List<QuestionDto>> LoadQuestionDtosAsync(
        Microclimate m,
        ClimateProjectDbContext db,
        string locale,
        List<string> fallbackFields,
        CancellationToken cancellationToken)
    {
        var questions = await db.MicroclimateQuestions.Where(q => q.MicroclimateId == m.Id)
            .OrderBy(q => q.Order)
            .ToListAsync(cancellationToken);

        var optionsByQuestion = await MicroclimateContent.LoadOptionsAsync(
            db, questions.Select(q => q.Id).ToList(), cancellationToken);

        return questions.Select(q =>
        {
            var path = $"questions[{q.Order}]";
            optionsByQuestion.TryGetValue(q.Id, out var options);
            return new QuestionDto(
                q.Id,
                MicroclimateContent.Resolve(q.TextEn, q.TextEs, locale, m.Language, $"{path}.text", fallbackFields),
                q.Type,
                MicroclimateContent.ToOptionDtos(options, locale, m.Language, path, fallbackFields),
                q.Required,
                q.Order);
        }).ToList();
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        string? status,
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

        var query = db.Microclimates.Where(m => m.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(m => m.Status == status);

        var rows = await query
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new
            {
                m.Id, m.TitleEn, m.TitleEs, m.CompanyId, m.Status, m.Language,
                m.ResponseCount, m.TargetParticipantCount, m.CreatedAt,
            })
            .ToListAsync(cancellationToken);

        var microclimates = rows
            .Select(m => new MicroclimateListItem(
                m.Id,
                LocalizedContent.ResolveText(m.TitleEn, m.TitleEs, lang, m.Language),
                m.CompanyId, m.Status, m.Language, m.ResponseCount, m.TargetParticipantCount, m.CreatedAt))
            .ToList();

        return Results.Ok(new MicroclimateListResponse(microclimates));
    }

    // A question's localized text and stable-value options, validated before anything
    // is added to the change tracker -- so a bad option on question 5 does not leave
    // questions 1-4 half-built.
    private sealed record PreparedQuestion(
        CreateQuestionInput Input,
        string? TextEn,
        string? TextEs,
        List<MicroclimateQuestionOption> Options);

    private static async Task<IResult> CreateAsync(
        CreateMicroclimateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        // The content language defaults to the company's own, so a single-language
        // company never has to think about translations and 'both' stays an explicit
        // opt-in. The company is loaded rather than assumed: without it there is no
        // default to inherit, and an unknown CompanyId would surface as an opaque 500
        // from the FK instead of a 400.
        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == request.CompanyId, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = $"Company {request.CompanyId} not found" }, statusCode: 400);
        }

        var language = ContentLanguages.NormaliseLanguage(request.Language)
                       ?? ContentLanguages.NormaliseLanguage(company.Settings.Language)
                       ?? ContentLanguages.FallbackLocale;
        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return Results.Json(new { message = $"Invalid language: {request.Language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" }, statusCode: 400);
        }

        if (request.Title is null)
        {
            return Results.Json(new { message = "Title is required" }, statusCode: 400);
        }

        if (!request.Title.TryResolve(language, "title", out var titleEn, out var titleEs, out var titleError))
        {
            return Results.Json(new { message = titleError }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(titleEn) && string.IsNullOrWhiteSpace(titleEs))
        {
            return Results.Json(new { message = "Title is required" }, statusCode: 400);
        }

        string? descriptionEn = null;
        string? descriptionEs = null;
        if (request.Description is not null
            && !request.Description.TryResolve(language, "description", out descriptionEn, out descriptionEs, out var descriptionError))
        {
            return Results.Json(new { message = descriptionError }, statusCode: 400);
        }

        var preparedQuestions = new List<PreparedQuestion>();
        foreach (var question in request.Questions ?? [])
        {
            if (!MicroclimateValidation.ValidQuestionTypes.Contains(question.Type))
            {
                return Results.Json(new { message = $"Invalid question type: {question.Type}" }, statusCode: 400);
            }

            if (question.Text is null)
            {
                return Results.Json(new { message = $"Question {question.Order} requires text" }, statusCode: 400);
            }

            if (!question.Text.TryResolve(language, $"questions[{question.Order}].text", out var questionTextEn, out var questionTextEs, out var textError))
            {
                return Results.Json(new { message = textError }, statusCode: 400);
            }

            if (string.IsNullOrWhiteSpace(questionTextEn) && string.IsNullOrWhiteSpace(questionTextEs))
            {
                return Results.Json(new { message = $"Question {question.Order} requires text" }, statusCode: 400);
            }

            var options = new List<MicroclimateQuestionOption>();
            var order = 0;
            foreach (var optionInput in question.Options ?? [])
            {
                string? labelEn = null;
                string? labelEs = null;
                if (optionInput.Label is not null
                    && !optionInput.Label.TryResolve(language, $"questions[{question.Order}].options[{order}].label", out labelEn, out labelEs, out var labelError))
                {
                    return Results.Json(new { message = labelError }, statusCode: 400);
                }

                var value = MicroclimateContent.DeriveOptionValue(optionInput.Value, labelEn, labelEs);
                if (value is null)
                {
                    return Results.Json(new { message = $"Option {order} of question {question.Order} needs a value or a label" }, statusCode: 400);
                }

                if (options.Any(o => string.Equals(o.Value, value, StringComparison.Ordinal)))
                {
                    // Caught here rather than by the unique index so it is a 400 naming
                    // the option instead of an opaque DbUpdateException. Duplicate values
                    // would make a stored answer ambiguous -- the exact failure the stable
                    // value exists to prevent.
                    return Results.Json(new { message = $"Question {question.Order} has duplicate option value '{value}'" }, statusCode: 400);
                }

                options.Add(new MicroclimateQuestionOption
                {
                    Order = order,
                    Value = value,
                    LabelEn = labelEn,
                    LabelEs = labelEs,
                });
                order++;
            }

            // multiple_choice has no meaningful fallback rendering -- unlike "rating" (which
            // falls back to a 1-5 scale) there is nothing to show the respondent without at
            // least 2 real options, and SubmitResponseAsync's validation for this type only
            // makes sense once the option set is guaranteed non-empty. Reject at creation time
            // instead of persisting an unanswerable question.
            if (question.Type == QuestionTypes.MultipleChoice && options.Count < 2)
            {
                return Results.Json(new { message = "multiple_choice questions require at least 2 options" }, statusCode: 400);
            }

            preparedQuestions.Add(new PreparedQuestion(question, questionTextEn, questionTextEs, options));
        }

        // TemplateId has a real FK to microclimate_templates (see MicroclimateConfiguration).
        // An unknown id would otherwise surface as an opaque 500 from the DbUpdateException
        // handler in Program.cs, and an unscoped id would let a CompanyAdmin reference another
        // tenant's template. Scope the lookup the same way ActionPlanEndpoints.CreateAsync
        // and the templates List endpoint scope visibility: the caller's own company, or a
        // system-wide template.
        MicroclimateTemplate? template = null;
        if (request.TemplateId.HasValue)
        {
            template = await db.MicroclimateTemplates.FirstOrDefaultAsync(
                t => t.Id == request.TemplateId.Value
                     && (t.CompanyId == request.CompanyId || t.CompanyId == null)
                     && t.IsActive,
                cancellationToken);
            if (template is null)
            {
                return Results.Json(new { message = $"Template {request.TemplateId} not found" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            TitleEn = titleEn?.Trim(),
            TitleEs = titleEs?.Trim(),
            DescriptionEn = descriptionEn,
            DescriptionEs = descriptionEs,
            Language = language,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            TemplateId = request.TemplateId,
            Status = "draft",
            TargetParticipantCount = request.TargetParticipantCount,
            CreatedAt = now,
            UpdatedAt = now,
        };
        microclimate.Scheduling.StartTime = request.StartTime;
        microclimate.Scheduling.EndTime = request.EndTime;
        if (!string.IsNullOrWhiteSpace(request.Timezone)) microclimate.Scheduling.Timezone = request.Timezone;
        microclimate.RealtimeSettings.AnonymousResponses = request.AnonymousResponses;

        db.Microclimates.Add(microclimate);

        if (template is not null)
        {
            template.UsageCount += 1;
            template.UpdatedAt = now;
        }

        foreach (var prepared in preparedQuestions)
        {
            var questionId = Guid.NewGuid();
            db.MicroclimateQuestions.Add(new MicroclimateQuestion
            {
                Id = questionId,
                MicroclimateId = microclimate.Id,
                TextEn = prepared.TextEn,
                TextEs = prepared.TextEs,
                Type = prepared.Input.Type,
                Required = prepared.Input.Required,
                Order = prepared.Input.Order,
            });

            foreach (var option in prepared.Options)
            {
                option.MicroclimateQuestionId = questionId;
                db.MicroclimateQuestionOptions.Add(option);
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(microclimate, db, lang, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        var isAuthenticated = principal.Identity?.IsAuthenticated ?? false;
        if (isAuthenticated)
        {
            var currentUser = principal.GetCurrentUser();
            if (!CanAccessCompany(currentUser, microclimate.CompanyId))
            {
                return Results.Forbid();
            }

            return Results.Ok(await ToDetailAsync(microclimate, db, lang, cancellationToken));
        }

        // Unauthenticated visitors may only view microclimates that are both configured for
        // anonymous responses AND currently active -- the same policy SubmitResponseAsync
        // enforces for the actual submission. Draft (unlaunched) and closed (finished)
        // microclimates must never be publicly readable, even when AnonymousResponses is true.
        if (!microclimate.RealtimeSettings.AnonymousResponses || microclimate.Status != "active")
        {
            return Results.Json(new { message = "This microclimate is not currently available" }, statusCode: 401);
        }

        // Anonymous callers get a deliberately reduced payload -- title/status/questions only.
        // The full MicroclimateDetail (CompanyId, CreatedBy, Description, ResponseCount,
        // TargetParticipantCount) is internal data the public respond page never needs and
        // must not leak to an unauthenticated caller holding only the microclimate's GUID.
        var publicLocale = MicroclimateContent.ResolveRequestLocale(lang, microclimate.Language);
        var publicFallbacks = new List<string>();
        var questions = await LoadQuestionDtosAsync(microclimate, db, publicLocale, publicFallbacks, cancellationToken);

        return Results.Ok(new PublicMicroclimateDetail(
            microclimate.Id,
            MicroclimateContent.Resolve(microclimate.TitleEn, microclimate.TitleEs, publicLocale, microclimate.Language, "title", publicFallbacks),
            microclimate.Status,
            questions,
            microclimate.Language,
            publicLocale,
            publicFallbacks));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateMicroclimateRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        if (request.Language is not null)
        {
            var requestedLanguage = ContentLanguages.NormaliseLanguage(request.Language);
            if (requestedLanguage is null)
            {
                return Results.Json(new { message = $"Invalid language: {request.Language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" }, statusCode: 400);
            }

            microclimate.Language = requestedLanguage;
        }

        if (request.Title is not null)
        {
            if (!request.Title.TryResolve(microclimate.Language, "title", out var titleEn, out var titleEs, out var titleError))
            {
                return Results.Json(new { message = titleError }, statusCode: 400);
            }

            // Null means "this locale was not supplied", which on an update leaves the
            // stored translation alone. Clearing one is an explicit empty string --
            // the same omitted/blanked distinction the other update handlers draw.
            if (titleEn is not null) microclimate.TitleEn = titleEn.Trim();
            if (titleEs is not null) microclimate.TitleEs = titleEs.Trim();
        }

        if (request.Description is not null)
        {
            if (!request.Description.TryResolve(microclimate.Language, "description", out var descriptionEn, out var descriptionEs, out var descriptionError))
            {
                return Results.Json(new { message = descriptionError }, statusCode: 400);
            }

            if (descriptionEn is not null) microclimate.DescriptionEn = descriptionEn;
            if (descriptionEs is not null) microclimate.DescriptionEs = descriptionEs;
        }

        if (request.EndTime.HasValue) microclimate.Scheduling.EndTime = request.EndTime.Value;

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!MicroclimateValidation.ValidStatuses.Contains(request.Status))
            {
                return Results.Json(new { message = $"Invalid status: {request.Status}" }, statusCode: 400);
            }

            // The publish gate. Leaving draft is the point at which "export/show the
            // survey in ES and EN without untranslated strings" has to be
            // deterministically true, and a read-time fallback can only ever make it
            // usually true. Not enforced on save: autosave runs every 5-10s and
            // side-by-side editing means saving a half-translated question is normal.
            if (ContentPublishValidation.IsPublishTransition(microclimate.Status, request.Status))
            {
                var gateQuestions = await db.MicroclimateQuestions
                    .Where(q => q.MicroclimateId == microclimate.Id)
                    .ToListAsync(cancellationToken);
                var gateOptions = await MicroclimateContent.LoadOptionsAsync(
                    db, gateQuestions.Select(q => q.Id).ToList(), cancellationToken);

                var missing = ContentPublishValidation.FindMissing(
                    microclimate.Language,
                    MicroclimateContent.GateFields(microclimate, gateQuestions, gateOptions));

                if (missing.Count > 0)
                {
                    return Results.Json(
                        new { message = ContentPublishValidation.Describe(missing), missingTranslations = missing },
                        statusCode: 400);
                }
            }

            microclimate.Status = request.Status;
        }

        microclimate.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(microclimate, db, lang, cancellationToken));
    }

    // Keyed by (language, word), not by word. Counting "trabajo" and "work" as
    // unrelated entries in one map was the whole defect: the frequencies were correct
    // per string and meaningless as a picture of what people said.
    private static Dictionary<(string Language, string Word), int> CountWordFrequencies(IEnumerable<string> texts, string language)
    {
        var counts = new Dictionary<(string, string), int>();
        foreach (var text in texts)
        {
            var words = text.ToLowerInvariant()
                .Split([' ', '\t', '\n', '.', ',', '!', '?'], StringSplitOptions.RemoveEmptyEntries);
            foreach (var word in words)
            {
                counts[(language, word)] = counts.GetValueOrDefault((language, word)) + 1;
            }
        }

        return counts;
    }

    private static string ComputeEngagementLevel(int responseCount, int targetParticipantCount)
    {
        if (targetParticipantCount <= 0)
        {
            return "medium";
        }

        var ratio = (double)responseCount / targetParticipantCount;
        return ratio switch
        {
            < 0.3 => "low",
            < 0.7 => "medium",
            _ => "high",
        };
    }

    private static async Task<IResult> GetLiveResultsAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        var wordCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? []
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData) ?? [];

        return Results.Ok(new LiveResultsDetail(
            microclimate.LiveResults.SentimentScore,
            microclimate.LiveResults.EngagementLevel,
            wordCloud,
            microclimate.ResponseCount,
            microclimate.TargetParticipantCount));
    }

    private static async Task<IResult> SubmitResponseAsync(
        Guid id,
        SubmitResponseRequest request,
        HttpContext httpContext,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated ?? false;

        if (!microclimate.RealtimeSettings.AnonymousResponses)
        {
            if (!isAuthenticated)
            {
                return Results.Json(new { message = "This microclimate requires authentication to respond" }, statusCode: 401);
            }

            // Non-anonymous microclimates require the submitter to belong to the same
            // company -- otherwise any authenticated user from any company could inflate
            // another company's ResponseCount/word cloud.
            if (!CanAccessCompany(httpContext.User.GetCurrentUser(), microclimate.CompanyId))
            {
                return Results.Forbid();
            }
        }

        if (microclimate.Status != "active")
        {
            return Results.Json(new { message = "This microclimate is not currently accepting responses" }, statusCode: 400);
        }

        // The respondent's own locale, recorded rather than guessed from their words.
        // An unrecognised value is rejected instead of silently bucketed as English --
        // a mislabelled bucket is worse than a rejected submission, because it is
        // invisible afterwards.
        if (request.Language is not null && ContentLanguages.NormaliseLocale(request.Language) is null)
        {
            return Results.Json(new { message = $"Invalid language: {request.Language}. Expected one of: {string.Join(", ", ContentLanguages.Locales)}" }, statusCode: 400);
        }

        var respondentLanguage = MicroclimateContent.ResolveRequestLocale(request.Language, microclimate.Language);

        var questions = await db.MicroclimateQuestions
            .Where(q => q.MicroclimateId == id)
            .Select(q => new { q.Id, q.Type })
            .ToListAsync(cancellationToken);
        var questionsById = questions.ToDictionary(q => q.Id);

        // Allowed answers are the options' stable VALUES, never their labels. This is
        // the line that stops two respondents who picked the same option in different
        // languages from storing two unrelated strings -- a split that produced no
        // error, no constraint violation, and row counts that reconciled exactly.
        var optionValues = await MicroclimateContent.LoadOptionsAsync(
            db, questions.Select(q => q.Id).ToList(), cancellationToken);

        // Constrained question types (multiple_choice, likert, rating, yes_no) must not accept arbitrary
        // freeform text -- validate each submitted answer against the question's own allowed
        // values so an invalid choice/rating never gets counted as a "real" response.
        foreach (var (questionId, answer) in request.Answers)
        {
            if (!questionsById.TryGetValue(questionId, out var question))
            {
                continue;
            }

            var validationError = question.Type switch
            {
                QuestionTypes.YesNo => answer.Equals("yes", StringComparison.OrdinalIgnoreCase)
                    || answer.Equals("no", StringComparison.OrdinalIgnoreCase)
                    ? null
                    : "must be 'yes' or 'no'",
                // likert and rating are validated identically: an explicit option set if
                // one is configured, otherwise a 1-5 scale. They stay distinct types
                // because they mean different things to the reader (agreement vs
                // quality), not because they are answered differently.
                _ when QuestionTypes.NumericScale.Contains(question.Type)
                        && optionValues.TryGetValue(question.Id, out var scaleOptions)
                        && scaleOptions.Count > 0
                    => scaleOptions.Any(o => o.Value == answer)
                        ? null
                        : $"must be one of: {string.Join(", ", scaleOptions.Select(o => o.Value))}",
                _ when QuestionTypes.NumericScale.Contains(question.Type)
                    => int.TryParse(answer, out var rating) && rating is >= 1 and <= 5
                        ? null
                        : "must be a rating between 1 and 5",
                // No "no options configured" fallback here (unlike "rating"'s 1-5 default) --
                // multiple_choice has no valid answer without a configured option set, so an
                // answer against an options-less multiple_choice question must always be
                // rejected rather than silently accepted (CreateAsync now guarantees every
                // multiple_choice question has >= 2 options, but this stays defensive against
                // any question created before that check existed).
                QuestionTypes.MultipleChoice
                    => optionValues.TryGetValue(question.Id, out var choices) && choices.Count > 0
                        ? choices.Any(o => o.Value == answer)
                            ? null
                            : $"must be one of: {string.Join(", ", choices.Select(o => o.Value))}"
                        : "this question has no configured options to answer",
                _ => null,
            };

            if (validationError is not null)
            {
                return Results.Json(new { message = $"Invalid answer for question {questionId}: {validationError}" }, statusCode: 400);
            }
        }

        // Word cloud is built from open-text responses only -- ratings, yes/no, and
        // multiple-choice option text must not be fed into word-frequency counting.
        var openTextQuestionIds = questions
            .Where(q => QuestionTypes.FreeText.Contains(q.Type))
            .Select(q => q.Id)
            .ToHashSet();

        var openTextAnswers = request.Answers
            .Where(kv => openTextQuestionIds.Contains(kv.Key))
            .Select(kv => kv.Value)
            .ToList();

        // ResponseCount and LiveResults.WordCloudData are a read-modify-write aggregate with
        // no natural per-response row to insert into, so concurrent submissions (the normal
        // case for a live microclimate) can race. Retry on optimistic-concurrency conflict
        // (backed by the "xmin" token configured in MicroclimateConfiguration.cs) instead of
        // silently losing one submission's increment/word counts.
        const int maxAttempts = 20;
        for (var attempt = 1; ; attempt++)
        {
            var existingCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
                ? new Dictionary<(string Language, string Word), int>()
                : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData)!
                    .ToDictionary(w => (Language: w.Language, Word: w.Text), w => w.Value);

            foreach (var (key, count) in CountWordFrequencies(openTextAnswers, respondentLanguage))
            {
                existingCloud[key] = existingCloud.GetValueOrDefault(key) + count;
            }

            // Top 20 PER LANGUAGE, not top 20 overall -- one busy language would
            // otherwise crowd the other out of the stored cloud entirely, and the
            // minority language is precisely the one an admin needs to see.
            var topWords = existingCloud
                .GroupBy(kv => kv.Key.Language)
                .SelectMany(g => g
                    .OrderByDescending(kv => kv.Value)
                    .Take(20)
                    .Select(kv => new WordCloudEntry(kv.Key.Word, kv.Value, kv.Key.Language)))
                .ToList();

            microclimate.ResponseCount += 1;
            microclimate.LiveResults.WordCloudData = System.Text.Json.JsonSerializer.Serialize(topWords);
            microclimate.LiveResults.EngagementLevel = ComputeEngagementLevel(microclimate.ResponseCount, microclimate.TargetParticipantCount);
            microclimate.LiveResults.SentimentScore = 0;
            microclimate.UpdatedAt = DateTimeOffset.UtcNow;

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateConcurrencyException) when (attempt < maxAttempts)
            {
                // Another submission won the race and committed first. Discard our stale
                // tracked state entirely and re-read the now-current row, then reapply this
                // submission's word counts/increment on top of it.
                db.ChangeTracker.Clear();
                microclimate = await db.Microclimates.FirstAsync(m => m.Id == id, cancellationToken);
            }
        }

        return Results.StatusCode(201);
    }
}
