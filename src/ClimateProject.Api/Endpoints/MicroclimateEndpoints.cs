using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using ClimateProject.Api.Infrastructure;
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
    // Shared with RateLimitPolicies -- POST /responses is this domain's unauthenticated
    // write surface, so it gets its own named policy rather than relying on the coarse
    // global ceiling that also covers authenticated admin traffic.
    internal const string ResponseSubmissionRateLimiterPolicy = "microclimate-response-submission";

    /// <summary>Requests per window per caller on the public submission path.</summary>
    private const int RateLimitPermitsPerWindow = 30;

    private static readonly TimeSpan RateLimitWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Partitions the public submission path per caller. Generous enough for legitimate
    /// shared-address participation (an office behind one NAT answering together) and
    /// bounded against a scripted flood: with no per-respondent identity and no persisted
    /// individual response rows, a single visitor holding the microclimate's GUID could
    /// otherwise inflate ResponseCount/EngagementLevel/the word cloud without bound, and
    /// nothing recorded afterwards could unpick it.
    ///
    /// <para>
    /// The caller comes from <see cref="Infrastructure.RateLimitPolicies.ClientIpFor"/>
    /// rather than <c>Connection.RemoteIpAddress</c> directly -- see
    /// <see cref="Infrastructure.ClientIpResolver"/> for why the socket peer is the wrong
    /// key behind App Runner.
    /// </para>
    /// </summary>
    internal static RateLimitPartition<string> PartitionResponseSubmission(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ResponseSubmissionRateLimiterPolicy + ":" + RateLimitPolicies.ClientIpFor(httpContext),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = RateLimitPermitsPerWindow,
                Window = RateLimitWindow,
                QueueLimit = 0,
            });
    }

    public static void MapMicroclimateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);

        // Literal segment, so it is unreachable by the "/{id:guid}" templates below whatever
        // order they are registered in -- "bulk" is not a GUID.
        group.MapPost("/bulk", BulkAsync);
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

        // The lifecycle. Both routes funnel into ApplyStatusAsync, as does the Status field
        // on PUT /{id} and every item of POST /bulk -- four callers, one rule.
        //
        // /activate is kept as its own verb rather than left to /status because it is the
        // transition with consequences (it is what puts content in front of respondents and
        // therefore what runs the translation gate), and because the legacy surface this
        // replaces named it. It is exactly `status -> active`, never a second code path.
        group.MapPost("/{id:guid}/activate", ActivateAsync);
        group.MapPut("/{id:guid}/status", UpdateStatusAsync);

        // Export. Two routes over one projection: /export serves JSON unless the legacy
        // ?format=csv query asks otherwise (it does NOT read the Accept header -- see
        // ExportAsync), and /export/csv is the unambiguous link an admin can put in a browser
        // address bar and get a file from. Both suppress before they serialise.
        group.MapGet("/{id:guid}/export", ExportAsync);
        group.MapGet("/{id:guid}/export/csv", ExportCsvAsync);

        // DROPPED, deliberately: GET /{id}/export/pdf. The legacy surface had one; this
        // repository has no PDF renderer and no package that could be one -- neither
        // ClimateProject.Api nor ClimateProject.Application references QuestPDF, iText or a
        // headless browser, and the only "pdf" in src/ is SurveyDistribution.QrCodePdfUrl,
        // a string column holding a URL. Adding a rendering engine is a dependency decision
        // with a licence question attached (QuestPDF is royalty-free only under a revenue
        // threshold), which is not #131's to take. The honest surface is the two formats
        // that exist. A caller wanting PDF gets a 404 rather than a route that returns
        // something that is not a PDF.
        //
        // DROPPED, deliberately: GET /{id}/responses. There is nothing to serve. A
        // microclimate persists no per-respondent row -- there is no MicroclimateResponse
        // entity and no DbSet for one; SubmitResponseAsync folds each submission straight
        // into the ResponseCount/SentimentScore/WordCloudData aggregate on the parent row
        // and discards the individual answers. That is the anonymity guarantee, not an
        // oversight, so this route cannot be implemented without first deciding to store
        // what the product currently promises not to. POST /{id}/responses (the write half
        // of the legacy path) exists and predates #131.
        group.MapGet("/{id:guid}/insights", GetInsightsAsync);

        // Unauthenticated write surface -- rate-limited per caller so a single visitor/bot
        // holding the microclimate's GUID can't unboundedly inflate ResponseCount/
        // EngagementLevel/the word cloud (individual responses aren't persisted, so there is
        // nothing to reconcile against after the fact). See PartitionResponseSubmission.
        //
        // GET /{id:guid} above is anonymous too but is deliberately NOT on this policy: it is
        // the same route an authenticated admin reads a microclimate through, and an
        // address-keyed policy would bucket a whole office of admins together. It is covered
        // by the global ceiling in RateLimitPolicies instead.
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

        var questionIds = questions.Select(q => q.Id).ToList();
        var optionsByQuestion = await MicroclimateContent.LoadOptionsAsync(db, questionIds, cancellationToken);
        var emojiOptionsByQuestion = await MicroclimateContent.LoadEmojiOptionsAsync(db, questionIds, cancellationToken);

        return questions.Select(q =>
        {
            var path = $"questions[{q.Order}]";
            optionsByQuestion.TryGetValue(q.Id, out var options);
            emojiOptionsByQuestion.TryGetValue(q.Id, out var emojiOptions);
            return new QuestionDto(
                q.Id,
                MicroclimateContent.Resolve(q.TextEn, q.TextEs, locale, m.Language, $"{path}.text", fallbackFields),
                q.Type,
                MicroclimateContent.ToOptionDtos(options, locale, m.Language, path, fallbackFields),
                q.Required,
                q.Order,
                MicroclimateContent.ToEmojiOptionDtos(emojiOptions, locale, m.Language, path, fallbackFields));
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
        List<MicroclimateQuestionOption> Options,
        List<MicroclimateQuestionEmojiOption> EmojiOptions);

    /// <summary>
    /// The longest glyph <c>microclimate_question_emoji_options.emoji</c> can hold.
    /// Checked here so an over-long emoji is a 400 naming the limit rather than a
    /// DbUpdateException surfacing as an opaque 500.
    /// </summary>
    /// <remarks>
    /// Counted in CHARACTERS -- code points -- because that is what a Postgres
    /// <c>varchar(16)</c> counts, and on the one input this column exists for the two
    /// units differ by nearly a factor of two: a family ZWJ sequence is 7 code points
    /// but 11 UTF-16 units, and a kiss sequence with skin tones is 10 and 15. A
    /// <see cref="string.Length"/> check would refuse glyphs the column can hold and
    /// name a limit the database does not use.
    /// </remarks>
    private const int MaxEmojiLength = 16;

    /// <summary>
    /// The longest accessible name <c>label_en</c>/<c>label_es</c> can hold, in the same
    /// unit and for the same reason as <see cref="MaxEmojiLength"/>.
    /// </summary>
    /// <remarks>
    /// Guarding the glyph and not the name was the gap: the name is a phrase a human
    /// types, so it is by far the likelier of the two to run past its column, and
    /// without this check a long one reached <c>varchar(100)</c> as a DbUpdateException
    /// and surfaced to the author as an opaque 500 on the one field this whole feature
    /// exists for.
    /// </remarks>
    private const int MaxEmojiLabelLength = 100;

    /// <summary>
    /// The length Postgres will measure: <c>varchar(n)</c> counts characters, i.e. code
    /// points, while <see cref="string.Length"/> counts UTF-16 units.
    /// </summary>
    private static int CharacterCount(string value)
    {
        var count = 0;
        foreach (var _ in value.EnumerateRunes())
        {
            count++;
        }

        return count;
    }

    /// <summary>An emoji scale needs at least this many points to be a scale.</summary>
    /// <remarks>
    /// Same number and same argument as the <c>multiple_choice</c> minimum below it: a
    /// single-point scale has nothing to choose between, so it is an unanswerable
    /// question, and rejecting it at creation is cheaper than discovering it when a
    /// respondent opens the link. This is the check #198 named as the thing that has to
    /// exist before <c>emoji_rating</c> could join the vocabulary at all.
    /// </remarks>
    private const int MinEmojiOptions = 2;

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

            // The emoji scale (#198). Prepared in the same pass and by the same rules as the
            // plain options above -- validated before anything reaches the change tracker, so
            // a bad scale on question 5 does not leave questions 1-4 half-built.
            var emojiOptions = new List<MicroclimateQuestionEmojiOption>();
            var emojiOrder = 0;
            foreach (var emojiInput in question.EmojiOptions ?? [])
            {
                // Refused rather than ignored. Every other type either renders its plain
                // options or falls back to a 1-5 scale; none of them reads this field, so
                // accepting it would take an author's authored scale and drop it silently.
                if (question.Type != QuestionTypes.EmojiRating)
                {
                    return Results.Json(new { message = $"Question {question.Order} is '{question.Type}', which has no emoji scale. emojiOptions is only valid on an {QuestionTypes.EmojiRating} question." }, statusCode: 400);
                }

                var emoji = emojiInput.Emoji?.Trim();
                if (string.IsNullOrEmpty(emoji))
                {
                    return Results.Json(new { message = $"Emoji option {emojiOrder} of question {question.Order} needs an emoji" }, statusCode: 400);
                }

                if (CharacterCount(emoji) > MaxEmojiLength)
                {
                    return Results.Json(new { message = $"Emoji option {emojiOrder} of question {question.Order} is longer than {MaxEmojiLength} characters" }, statusCode: 400);
                }

                string? emojiLabelEn = null;
                string? emojiLabelEs = null;
                if (emojiInput.Label is not null
                    && !emojiInput.Label.TryResolve(language, $"questions[{question.Order}].emojiOptions[{emojiOrder}].label", out emojiLabelEn, out emojiLabelEs, out var emojiLabelError))
                {
                    return Results.Json(new { message = emojiLabelError }, statusCode: 400);
                }

                // The load-bearing rule of this whole feature. An emoji carries no name of
                // its own that a screen reader can be relied on to speak in the respondent's
                // language, so a scale point without a label is exactly the unusable control
                // that reusing the plain Options array was rejected for (#198). Refused at
                // creation, not papered over at render.
                if (string.IsNullOrWhiteSpace(emojiLabelEn) && string.IsNullOrWhiteSpace(emojiLabelEs))
                {
                    return Results.Json(new { message = $"Emoji option {emojiOrder} of question {question.Order} needs a label -- it is the option's accessible name" }, statusCode: 400);
                }

                // ...and a name the column cannot hold is refused here for the same reason the
                // glyph above it is: the alternative is a DbUpdateException the author reads as
                // "An unexpected error occurred."
                var emojiLabelTooLong = new[] { emojiLabelEn?.Trim(), emojiLabelEs?.Trim() }
                    .FirstOrDefault(label => label is not null && CharacterCount(label) > MaxEmojiLabelLength);
                if (emojiLabelTooLong is not null)
                {
                    return Results.Json(new { message = $"Emoji option {emojiOrder} of question {question.Order} has a label longer than {MaxEmojiLabelLength} characters" }, statusCode: 400);
                }

                // Position on the scale when the author did not say. Listing five faces then
                // gets 1..5, which is the numbering a reader of the export expects and the
                // one the plain 1-5 scale already uses.
                var emojiValue = emojiInput.Value ?? emojiOrder + 1;
                if (emojiOptions.Any(o => o.Value == emojiValue))
                {
                    // Caught here rather than by the unique index, for the reason the plain
                    // duplicate check above gives: a duplicate value makes a submission
                    // ambiguous -- two faces accepting the same string, with nothing to say
                    // which one was meant -- and a 400 naming the option beats an opaque
                    // DbUpdateException.
                    return Results.Json(new { message = $"Question {question.Order} has duplicate emoji option value '{emojiValue}'" }, statusCode: 400);
                }

                emojiOptions.Add(new MicroclimateQuestionEmojiOption
                {
                    Order = emojiOrder,
                    Emoji = emoji,
                    Value = emojiValue,
                    LabelEn = emojiLabelEn?.Trim(),
                    LabelEs = emojiLabelEs?.Trim(),
                });
                emojiOrder++;
            }

            if (question.Type == QuestionTypes.EmojiRating)
            {
                if (emojiOptions.Count < MinEmojiOptions)
                {
                    return Results.Json(new { message = $"{QuestionTypes.EmojiRating} questions require at least {MinEmojiOptions} emoji options" }, statusCode: 400);
                }

                // Same "never silently drop input" rule as above, the other way round: the
                // respond page renders the emoji scale for this type and nothing else, so
                // plain options here would be collected and never shown.
                if (options.Count > 0)
                {
                    return Results.Json(new { message = $"Question {question.Order} is '{QuestionTypes.EmojiRating}', which is answered on its emoji scale. Use emojiOptions rather than options." }, statusCode: 400);
                }
            }

            preparedQuestions.Add(new PreparedQuestion(question, questionTextEn, questionTextEs, options, emojiOptions));
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
            Status = MicroclimateStatuses.Draft,
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

            foreach (var emojiOption in prepared.EmojiOptions)
            {
                emojiOption.MicroclimateQuestionId = questionId;
                db.MicroclimateQuestionEmojiOptions.Add(emojiOption);
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
        if (!microclimate.RealtimeSettings.AnonymousResponses || !MicroclimateStatuses.AcceptsResponses(microclimate.Status))
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
            // Was: a membership test against ValidStatuses and nothing else, which let this
            // route walk a microclimate to ANY status from ANY status -- closed back to
            // active, or active back to draft where its questions become editable again
            // underneath responses already counted into the aggregate. The transition map now
            // runs here exactly as it does on PUT /status.
            var transitionFailure = await ApplyStatusAsync(db, microclimate, request.Status, cancellationToken);
            if (transitionFailure is not null)
            {
                return transitionFailure.Result;
            }
        }

        microclimate.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(microclimate, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /// <summary>
    /// A refused status change: the response a single-microclimate route sends back, and the
    /// same reason as bare text so <see cref="BulkAsync"/> can report it per item.
    /// </summary>
    /// <remarks>
    /// Both halves come from one construction site so they cannot disagree. Bulk previously
    /// discarded the <see cref="IResult"/> and rebuilt a message from the target status,
    /// which made every per-item failure read "Cannot move a microclimate from 'draft' to
    /// 'active'" -- false for the case that actually reaches it most, a bulk activate blocked
    /// by the translation gate on a legal transition.
    /// </remarks>
    private sealed record StatusChangeFailure(IResult Result, string Message);

    /// <summary>
    /// The whole lifecycle rule, in one place so <c>POST /activate</c>, <c>PUT /status</c>,
    /// the <c>Status</c> field on <c>PUT /{id}</c> and <c>POST /bulk</c> cannot drift apart.
    /// Mutates <paramref name="microclimate"/> and returns null on success, or the
    /// <see cref="IResult"/> to send back. Does not save.
    /// </summary>
    private static async Task<StatusChangeFailure?> ApplyStatusAsync(
        ClimateProjectDbContext db,
        Microclimate microclimate,
        string? requestedStatus,
        CancellationToken cancellationToken)
    {
        if (!MicroclimateStatuses.IsValid(requestedStatus))
        {
            var invalid = $"Invalid status: {requestedStatus}. Expected one of: {string.Join(", ", MicroclimateStatuses.All)}";
            return new StatusChangeFailure(Results.Json(new { message = invalid }, statusCode: 400), invalid);
        }

        var target = requestedStatus!;
        if (!MicroclimateStatuses.CanTransition(microclimate.Status, target))
        {
            var allowed = MicroclimateStatuses.AllowedTransitionsFrom(microclimate.Status);
            var refused = allowed.Count == 0
                ? $"A microclimate in status '{microclimate.Status}' is final and cannot change status."
                : $"Cannot move a microclimate from '{microclimate.Status}' to '{target}'. Allowed from '{microclimate.Status}': {string.Join(", ", allowed)}.";

            return new StatusChangeFailure(
                Results.Json(
                    new
                    {
                        message = refused,
                        from = microclimate.Status,
                        to = target,
                        allowedTransitions = allowed,
                    },
                    statusCode: 409),
                refused);
        }

        if (string.Equals(microclimate.Status, target, StringComparison.Ordinal))
        {
            // Idempotent no-op: a retried activate is not an error, and re-running the
            // publish gate on an already-live microclimate could only ever fail one that is
            // already in front of respondents.
            return null;
        }

        // The publish gate. Leaving draft for 'active' is the point at which "export/show
        // the survey in ES and EN without untranslated strings" has to be deterministically
        // true, and a read-time fallback can only ever make it usually true. Not enforced on
        // save: autosave runs every 5-10s and side-by-side editing means saving a
        // half-translated question is normal.
        //
        // MicroclimateStatuses.IsPublish, not ContentPublishValidation.IsPublishTransition:
        // the shared predicate is "left draft for anything", which also catches
        // draft -> closed. Demanding a complete set of translations in order to throw an
        // abandoned draft away is a gate that blocks cleanup and protects no respondent.
        if (MicroclimateStatuses.IsPublish(microclimate.Status, target))
        {
            var gateQuestions = await db.MicroclimateQuestions
                .Where(q => q.MicroclimateId == microclimate.Id)
                .ToListAsync(cancellationToken);
            var gateQuestionIds = gateQuestions.Select(q => q.Id).ToList();
            var gateOptions = await MicroclimateContent.LoadOptionsAsync(db, gateQuestionIds, cancellationToken);
            var gateEmojiOptions = await MicroclimateContent.LoadEmojiOptionsAsync(db, gateQuestionIds, cancellationToken);

            // An emoji_rating question with no scale is the unanswerable question #198
            // exists to prevent, one step from a respondent: MicroclimateRespondPage has no
            // control to draw for it and SubmitResponseAsync rejects every answer to it.
            // CreateAsync refuses to build one, but it is not the only endpoint that writes
            // microclimate questions -- MicroclimateTemplateEndpoints does too -- and this
            // gate is the last point before the link goes out, so it is the guard that
            // covers a row which reached the table any other way.
            var scaleless = gateQuestions
                .Where(q => q.Type == QuestionTypes.EmojiRating)
                .Where(q => !gateEmojiOptions.TryGetValue(q.Id, out var faces) || faces.Count < MinEmojiOptions)
                .OrderBy(q => q.Order)
                .ToList();
            if (scaleless.Count > 0)
            {
                var unanswerable = $"Cannot publish: {string.Join(", ", scaleless.Select(q => $"questions[{q.Order}]"))} "
                    + $"{(scaleless.Count == 1 ? "is" : "are")} '{QuestionTypes.EmojiRating}' with fewer than {MinEmojiOptions} emoji options, which a respondent cannot answer.";
                return new StatusChangeFailure(
                    Results.Json(new { message = unanswerable, unanswerableQuestions = scaleless.Select(q => q.Order).ToList() }, statusCode: 400),
                    unanswerable);
            }

            var missing = ContentPublishValidation.FindMissing(
                microclimate.Language,
                MicroclimateContent.GateFields(microclimate, gateQuestions, gateOptions, gateEmojiOptions));

            if (missing.Count > 0)
            {
                var untranslated = ContentPublishValidation.Describe(missing);
                return new StatusChangeFailure(
                    Results.Json(new { message = untranslated, missingTranslations = missing }, statusCode: 400),
                    untranslated);
            }
        }

        microclimate.Status = target;
        microclimate.UpdatedAt = DateTimeOffset.UtcNow;
        return null;
    }

    /// <summary>
    /// Loads a microclimate and checks the caller may administer it. Returns the row, or the
    /// <see cref="IResult"/> to send back -- never both.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>One condition, not two.</b> This guard read
    /// <c>!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(...)</c> under a comment
    /// claiming the two halves were "both required" because "CanAccessCompany alone would let a
    /// company's own employee through". That was false as written.
    /// <see cref="CanAccessCompany"/> returns true only for a SuperAdmin, or for a CompanyAdmin
    /// whose tenant matches, and <c>Roles.Admin</c> is exactly <c>[super_admin, company_admin]</c>
    /// -- so the role test could not refuse a caller the tenancy test had already admitted. The
    /// employee the comment was worried about is refused by <see cref="CanAccessCompany"/>
    /// itself.
    /// </para>
    /// <para>
    /// <b>The redundancy was not free.</b> While both conditions stood, neither could be killed
    /// on its own: weakening <see cref="CanAccessCompany"/> to the bare <c>CompanyId</c> match
    /// its own comment warns against -- the exact regression that once let any authenticated
    /// employee rewrite Title/Description/EndTime and flip Status -- passed all 34 lifecycle
    /// tests, because the redundant <c>Roles.Admin</c> test here caught the employee that
    /// mutation let through. A duplicated check does not double the protection; it hides which
    /// copy is load-bearing. With one condition left,
    /// <c>An_employee_of_the_owning_company_is_refused_every_admin_route</c> fails on all five
    /// routes the moment the role clause of <see cref="CanAccessCompany"/> goes.
    /// </para>
    /// <para>
    /// <c>CreateAsync</c>, <c>UpdateAsync</c> and <c>MicroclimateTemplateEndpoints</c> still
    /// carry the same redundant pair. They predate #131 and are left alone rather than swept
    /// up here; they are inert now that the role clause of <see cref="CanAccessCompany"/> is
    /// held through this helper, which fails whatever those three do.
    /// </para>
    /// </remarks>
    private static async Task<(Microclimate? Microclimate, IResult? Error)> LoadForAdminAsync(
        Guid id,
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return (null, Results.Json(new { message = "Microclimate not found" }, statusCode: 404));
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return (null, Results.Forbid());
        }

        return (microclimate, null);
    }

    private static async Task<IResult> ActivateAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => await TransitionAsync(id, MicroclimateStatuses.Active, lang, principal, db, cancellationToken);

    private static async Task<IResult> UpdateStatusAsync(
        Guid id,
        UpdateMicroclimateStatusRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => await TransitionAsync(id, request?.Status, lang, principal, db, cancellationToken);

    private static async Task<IResult> TransitionAsync(
        Guid id,
        string? target,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadForAdminAsync(id, principal.GetCurrentUser(), db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var failure = await ApplyStatusAsync(db, microclimate!, target, cancellationToken);
        if (failure is not null)
        {
            return failure.Result;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await ToDetailAsync(microclimate!, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Bulk
    // ------------------------------------------------------------------

    private static async Task<IResult> BulkAsync(
        BulkMicroclimateActionRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        var action = request?.Action?.Trim().ToLowerInvariant();
        if (action is null || !MicroclimateValidation.BulkActions.Contains(action, StringComparer.Ordinal))
        {
            return Results.Json(
                new { message = $"Invalid action: {request?.Action}. Expected one of: {string.Join(", ", MicroclimateValidation.BulkActions)}" },
                statusCode: 400);
        }

        var ids = (request!.MicroclimateIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return Results.Json(new { message = "MicroclimateIds is required" }, statusCode: 400);
        }

        var rows = await db.Microclimates.Where(m => ids.Contains(m.Id)).ToListAsync(cancellationToken);
        var byId = rows.ToDictionary(m => m.Id);

        var target = action == MicroclimateValidation.BulkActionActivate
            ? MicroclimateStatuses.Active
            : MicroclimateStatuses.Closed;

        var results = new List<BulkMicroclimateActionResult>(ids.Count);
        foreach (var id in ids)
        {
            if (!byId.TryGetValue(id, out var microclimate)
                || !CanAccessCompany(currentUser, microclimate.CompanyId))
            {
                // A row in another tenant is reported as "not found", not "forbidden".
                // Telling a CompanyAdmin which arbitrary GUIDs exist in other companies is a
                // cross-tenant probe, and an endpoint that takes a list of ids and answers
                // one-by-one is the ideal shape for one.
                results.Add(new BulkMicroclimateActionResult(id, false, "Microclimate not found"));
                continue;
            }

            // Every item goes through the same helper a single-microclimate call uses. Bulk
            // is a loop, never a bypass: a bulk close must not be able to close something
            // PUT /status would have refused, and a bulk activate must still run the
            // translation gate on each row it publishes.
            // The reason comes back from the helper rather than being reconstructed here: a
            // bulk activate refused by the translation gate is a LEGAL transition that failed
            // for another reason entirely, and a message guessed from the target status would
            // send the admin looking at the wrong thing.
            var itemFailure = await ApplyStatusAsync(db, microclimate, target, cancellationToken);
            results.Add(itemFailure is null
                ? new BulkMicroclimateActionResult(id, true, null)
                : new BulkMicroclimateActionResult(id, false, itemFailure.Message));
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new BulkMicroclimateActionResponse(results));
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    /// <summary>
    /// Builds the suppressed export payload. The single path to a microclimate's contents
    /// leaving the server as a file, so the floors cannot be skipped by picking a format.
    /// </summary>
    private static async Task<(MicroclimateExport? Export, IResult? Error)> BuildExportAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadForAdminAsync(id, principal.GetCurrentUser(), db, cancellationToken);
        if (error is not null)
        {
            return (null, error);
        }

        var locale = MicroclimateContent.ResolveRequestLocale(lang, microclimate!.Language);
        var fallbackFields = new List<string>();
        var questions = await LoadQuestionDtosAsync(microclimate, db, locale, fallbackFields, cancellationToken);

        var words = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? []
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData) ?? [];

        return (MicroclimateExportProjection.Project(
            microclimate.Id,
            MicroclimateContent.Resolve(microclimate.TitleEn, microclimate.TitleEs, locale, microclimate.Language, "title", fallbackFields),
            MicroclimateContent.Resolve(microclimate.DescriptionEn, microclimate.DescriptionEs, locale, microclimate.Language, "description", fallbackFields),
            microclimate.CompanyId,
            microclimate.Status,
            microclimate.Language,
            locale,
            fallbackFields,
            microclimate.Scheduling.StartTime,
            microclimate.Scheduling.EndTime,
            microclimate.ResponseCount,
            microclimate.TargetParticipantCount,
            microclimate.LiveResults.EngagementLevel,
            microclimate.LiveResults.SentimentScore,
            questions,
            words,
            DateTimeOffset.UtcNow), null);
    }

    private static async Task<IResult> ExportAsync(
        Guid id,
        string? format,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (export, error) = await BuildExportAsync(id, lang, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        // ?format=csv is accepted here as well as at /export/csv so a caller that only knows
        // the legacy query-string shape still gets a file rather than JSON it did not ask
        // for. Same projection either way.
        return string.Equals(format?.Trim(), "csv", StringComparison.OrdinalIgnoreCase)
            ? CsvFile(export!)
            : Results.Ok(export);
    }

    private static async Task<IResult> ExportCsvAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (export, error) = await BuildExportAsync(id, lang, principal, db, cancellationToken);
        return error ?? CsvFile(export!);
    }

    private static IResult CsvFile(MicroclimateExport export)
        => Results.File(
            MicroclimateExportProjection.ToCsv(export),
            "text/csv",
            $"microclimate-{export.Id}.csv");

    // ------------------------------------------------------------------
    // Insights
    // ------------------------------------------------------------------

    /// <summary>
    /// Serves whatever has been persisted to <c>MicroclimateAiInsight</c> for this session.
    /// </summary>
    /// <remarks>
    /// <b>This endpoint reads a table nothing writes.</b> #131 asked for insights to be
    /// "stubbed or deferred" because they depend on #67, the AI provider decision. #67 is
    /// closed and produced <c>docs/superpowers/specs/2026-08-02-ai-provider-decision.md</c>,
    /// but no inference client was ever built -- there is no Bedrock or Anthropic call
    /// anywhere in <c>src/</c>, and the only writer of <c>MicroclimateAiInsights</c> in the
    /// repository is a persistence test. <c>SubmitResponseAsync</c> hard-codes
    /// <c>SentimentScore = 0</c> for the same reason.
    ///
    /// <para>
    /// So the stub is the read side, wired to the real table, and it reports the gap in the
    /// payload instead of hiding it: <c>generated: false</c> with a reason code, rather than
    /// an empty array that a client would render identically to "the model had nothing to
    /// say". When a generator does land it writes rows and this endpoint starts returning
    /// them with no change here and no change in the client. Inventing plausible-looking
    /// insight text was the alternative and is the one thing this must not do -- a fabricated
    /// narrative about a real team is worse than an empty one.
    /// </para>
    /// </remarks>
    private static async Task<IResult> GetInsightsAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadForAdminAsync(id, principal.GetCurrentUser(), db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var insights = await db.MicroclimateAiInsights
            .AsNoTracking()
            .Where(i => i.MicroclimateId == microclimate!.Id)
            .OrderByDescending(i => i.Timestamp)
            .Select(i => new MicroclimateInsightItem(i.Id, i.Type, i.Message, i.Confidence, i.Timestamp))
            .ToListAsync(cancellationToken);

        return Results.Ok(new MicroclimateInsightsResponse(
            microclimate!.Id,
            insights.Count > 0,
            insights.Count > 0 ? null : NoInsightGeneratorReason,
            insights));
    }

    /// <summary>
    /// Machine-readable, rendered through the client's own i18n keys. Not display copy.
    /// </summary>
    internal const string NoInsightGeneratorReason = "no_insight_generator_configured";

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

        if (!MicroclimateStatuses.AcceptsResponses(microclimate.Status))
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

        // The emoji scale's allowed answers (#198), on exactly the same footing: the
        // stable VALUE, never the glyph and never the label. Loaded whatever the question
        // types are, because a microclimate with no emoji_rating question simply gets an
        // empty lookup and the extra query costs nothing on a page with no scales.
        var emojiOptionValues = await MicroclimateContent.LoadEmojiOptionsAsync(
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
                // emoji_rating is validated against its OWN configured values and nothing
                // else -- there is no 1-5 fallback here, unlike likert/rating. A scale whose
                // author chose the values -2..2, or 1..4, must reject 5; and an emoji_rating
                // question with no scale at all (which CreateAsync now refuses to make, but
                // which a template instantiation could still produce) has no valid answer,
                // so it is rejected rather than silently counted. Compared as the value's
                // decimal string because answers travel as text.
                QuestionTypes.EmojiRating
                    => emojiOptionValues.TryGetValue(question.Id, out var faces) && faces.Count > 0
                        ? faces.Any(o => o.Value.ToString(CultureInfo.InvariantCulture) == answer)
                            ? null
                            : $"must be one of: {string.Join(", ", faces.Select(o => o.Value.ToString(CultureInfo.InvariantCulture)))}"
                        : "this question has no configured emoji options to answer",
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
