using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class SurveyEndpoints
{
    public static void MapSurveyEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/surveys").RequireAuthorization();

        // "scoped" and "my" are the two listings and they are NOT the same list:
        // /surveys/scoped is what the caller may administer, /surveys/my is what the
        // caller is expected to answer. A company_admin sees their own surveys in both,
        // which is exactly why conflating them is tempting and wrong -- an employee has a
        // non-empty /my and an empty /scoped, and a super_admin the reverse.
        //
        // Neither literal segment can shadow /{id:guid}: the route constraint means
        // "scoped" and "my" never parse as an id.
        group.MapGet("", ListAsync);
        group.MapGet("/scoped", ListAsync);
        group.MapGet("/my", ListMineAsync);

        group.MapPost("", CreateAsync);
        group.MapPost("/bulk", BulkAsync);

        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);

        // Status is its own route and is absent from UpdateSurveyRequest. Publishing is
        // the one irreversible checkpoint in the domain (it runs the content-i18n gate
        // and freezes the survey's content), and an update that could also publish is an
        // update that publishes by accident.
        group.MapPut("/{id:guid}/status", UpdateStatusAsync);

        group.MapPost("/{id:guid}/duplicate", DuplicateAsync);
    }

    // Surveys have a NOT NULL company_id -- unlike Benchmark/SurveyTemplate there is no
    // such thing as a global survey, so Benchmark's read/write split (which exists purely
    // to stop a CompanyAdmin writing to rows every tenant can see) has nothing to protect
    // here. The split that does exist on this surface is administer-vs-answer: this guard
    // gates every admin route, and /surveys/my is the separate, role-agnostic read path.
    //
    // Do not weaken to a bare CompanyId match: that would let any authenticated employee
    // of the company rewrite questions and publish surveys.
    internal static bool CanAdminister(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    // internal so SurveyAuditTrail resolves the actor the same way every write path here
    // already does -- two resolution rules would mean an audit row attributed to a
    // different user than the one the foreign key on created_by points at.
    internal static async Task<Guid?> ResolveActingUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId)
            && await db.Users.AnyAsync(u => u.Id == userId, cancellationToken))
        {
            return userId;
        }

        var byExternalId = await db.Users
            .Where(u => u.PersonaExternalId == currentUser.Sub)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (byExternalId is not null)
        {
            return byExternalId;
        }

        return await db.Users
            .Where(u => u.Email == currentUser.Email)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    // surveys.created_by is NOT NULL with a RESTRICT foreign key, so an unresolvable
    // acting user must be a 400 here rather than Guid.Empty and an opaque 500 out of the
    // DbUpdateException handler.
    private static IResult ActingUserRequired()
        => Results.Json(new { message = "The authenticated user has no matching user record" }, statusCode: 400);

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    private static async Task<IResult> ListAsync(
        Guid? companyId,
        string? status,
        string? type,
        string? q,
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

        var query = db.Surveys.AsQueryable();

        if (currentUser.Role == Roles.SuperAdmin)
        {
            if (companyId.HasValue)
            {
                query = query.Where(s => s.CompanyId == companyId.Value);
            }
        }
        else
        {
            // Compare Guids, never Guid.ToString() -- since #191 CompanyId is Guid? and EF
            // cannot translate Nullable<Guid>.ToString() inside a query.
            var ownCompanyId = CompanyScope.OwnCompanyId(currentUser);
            if (ownCompanyId is null)
            {
                return Results.Forbid();
            }

            if (companyId.HasValue && companyId.Value != ownCompanyId.Value)
            {
                return Results.Forbid();
            }

            query = query.Where(s => s.CompanyId == ownCompanyId.Value);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!SurveyStatuses.IsValid(status))
            {
                return InvalidStatus(status);
            }

            query = query.Where(s => s.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            query = query.Where(s => s.Type == type);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            query = SurveyQueries.WithTitleMatching(query, q);
        }

        var rows = await SurveyQueries.ToListRows(query, db.Questions).ToListAsync(cancellationToken);

        var surveys = rows
            .Select(s => new SurveyListItem(
                s.Id,
                LocalizedContent.ResolveText(s.TitleEn, s.TitleEs, lang, s.Language),
                s.CompanyId, s.Type, s.Status, s.Language, s.StartDate, s.EndDate,
                s.ResponseCount, s.TargetAudienceCount, s.QuestionCount, s.CreatedAt))
            .ToList();

        return Results.Ok(new SurveyListResponse(surveys));
    }

    private static async Task<IResult> ListMineAsync(
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // Read the user's OWN row rather than the JWT: department membership moves, and a
        // token minted before a transfer would otherwise keep serving the old team's
        // surveys until it expired.
        var actingUserId = await ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null)
        {
            return ActingUserRequired();
        }

        var me = await db.Users
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => new { u.Id, u.CompanyId, u.DepartmentId })
            .FirstAsync(cancellationToken);

        // A user with no company is a global super_admin (#191). They belong to no tenant,
        // so there is no survey they are expected to answer -- an empty list, not an error.
        if (me.CompanyId is not Guid myCompanyId)
        {
            return Results.Ok(new MySurveyListResponse([]));
        }

        var query = SurveyQueries.AssignedTo(
            db.Surveys, db.SurveyDepartmentTargets, db.Responses, myCompanyId, me.DepartmentId, me.Id);

        var rows = await SurveyQueries.ToMyRows(query, db.Questions).ToListAsync(cancellationToken);

        var surveys = rows
            .Select(s => new MySurveyListItem(
                s.Id,
                LocalizedContent.ResolveText(s.TitleEn, s.TitleEs, lang, s.Language),
                LocalizedContent.ResolveText(s.DescriptionEn, s.DescriptionEs, lang, s.Language),
                s.Type, s.StartDate, s.EndDate, s.QuestionCount, s.Anonymous, s.TimeLimitMinutes))
            .ToList();

        return Results.Ok(new MySurveyListResponse(surveys));
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    // A question's localized fields and stable-value options, validated before anything is
    // added to the change tracker -- so a bad option on question 5 does not leave
    // questions 1-4 half-built.
    private sealed record PreparedQuestion(
        CreateSurveyQuestionInput Input,
        string? TextEn,
        string? TextEs,
        string? ScaleLabelMinEn,
        string? ScaleLabelMinEs,
        string? ScaleLabelMaxEn,
        string? ScaleLabelMaxEs,
        string? CommentPromptEn,
        string? CommentPromptEs,
        List<QuestionOption> Options);

    private static async Task<IResult> CreateAsync(
        CreateSurveyRequest request,
        string? lang,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAdminister(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        // Loaded rather than assumed: without the company there is no default content
        // language to inherit, and an unknown CompanyId would surface as an opaque 500
        // from the foreign key instead of a 400.
        var company = await db.Companies
            .Where(c => c.Id == request.CompanyId)
            .Select(c => new { c.Settings.Language })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = $"Company {request.CompanyId} not found" }, statusCode: 400);
        }

        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        var language = ContentLanguages.NormaliseLanguage(request.Language)
                       ?? ContentLanguages.NormaliseLanguage(company.Language)
                       ?? ContentLanguages.FallbackLocale;

        var type = request.Type?.Trim();
        if (string.IsNullOrWhiteSpace(type))
        {
            return Results.Json(new { message = "Type is required" }, statusCode: 400);
        }

        if (request.StartDate >= request.EndDate)
        {
            return Results.Json(new { message = "StartDate must be before EndDate" }, statusCode: 400);
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

        var departmentIds = (request.DepartmentIds ?? []).Distinct().ToList();
        var departmentError = await ValidateDepartmentsAsync(db, request.CompanyId, departmentIds, cancellationToken);
        if (departmentError is not null)
        {
            return departmentError;
        }

        var prepared = new List<PreparedQuestion>();
        foreach (var question in request.Questions ?? [])
        {
            var (preparedQuestion, error) = PrepareQuestion(question, language);
            if (error is not null)
            {
                return error;
            }

            prepared.Add(preparedQuestion!);
        }

        var duplicateOrder = prepared.GroupBy(p => p.Input.Order).FirstOrDefault(g => g.Count() > 1);
        if (duplicateOrder is not null)
        {
            return Results.Json(new { message = $"Two questions share order {duplicateOrder.Key}" }, statusCode: 400);
        }

        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return ActingUserRequired();
        }

        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            CreatedBy = actor.UserId,
            TitleEn = titleEn?.Trim(),
            TitleEs = titleEs?.Trim(),
            DescriptionEn = descriptionEn,
            DescriptionEs = descriptionEs,
            Language = language,
            Type = type,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Status = SurveyStatuses.Draft,
            TargetAudienceCount = request.TargetAudienceCount,
            CreatedAt = now,
            UpdatedAt = now,
        };

        if (request.Settings is not null)
        {
            var settingsError = ApplySettings(survey.Settings, request.Settings, language);
            if (settingsError is not null)
            {
                return settingsError;
            }
        }

        db.Surveys.Add(survey);

        foreach (var departmentId in departmentIds)
        {
            db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget { SurveyId = survey.Id, DepartmentId = departmentId });
        }

        AddQuestions(db, survey.Id, prepared);

        SurveyAuditTrail.Record(db, survey.Id, SurveyAuditActions.Created, SurveyAuditEntityTypes.Survey, actor, now);

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(survey, db, lang, cancellationToken), statusCode: 201);
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
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        if (!CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(survey, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Update
    // ------------------------------------------------------------------

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateSurveyRequest request,
        string? lang,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        if (!CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        // Resolved before the mutation, and a hard requirement: survey_audit_logs.user_id
        // is NOT NULL with a RESTRICT foreign key, so a change nobody can be held to is a
        // change that cannot be recorded -- and an unrecordable change to a survey is worse
        // than a rejected one. Same 400 POST /surveys has always returned.
        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return ActingUserRequired();
        }

        // Anonymous is classed as CONTENT, not as a setting. Flipping it changes how every
        // answer already collected may be interpreted and re-identified, which is the
        // definition of invalidating a result -- the rest of the settings blob (reminder
        // cadence, progress bar, autosave) changes nothing about the data.
        var touchesContent = request.Title is not null
                             || request.Description is not null
                             || request.Type is not null
                             || request.Language is not null
                             || request.Questions is not null
                             || request.DepartmentIds is not null
                             || request.Settings?.Anonymous is not null;

        var touchesSchedule = request.StartDate.HasValue
                              || request.EndDate.HasValue
                              || request.TargetAudienceCount.HasValue
                              || request.Settings is not null;

        if (touchesContent)
        {
            if (!SurveyStatuses.AllowsContentEdit(survey.Status))
            {
                return Results.Json(
                    new
                    {
                        message = $"A survey in status '{survey.Status}' cannot have its content edited. "
                                  + (SurveyStatuses.CanTransition(survey.Status, SurveyStatuses.Draft)
                                      ? "Return it to 'draft' first via PUT /surveys/{id}/status."
                                      : "Duplicate it instead -- the copy keeps every option's stable value, so its responses still aggregate with this one's."),
                    },
                    statusCode: 409);
            }

            // Belt and braces on top of the status rule: even a draft is frozen once any
            // response exists. Both the denormalised counter and the responses table are
            // checked, so a stale counter cannot open the gate.
            if (await HasResponsesAsync(db, survey, cancellationToken))
            {
                return Results.Json(
                    new { message = "This survey already has responses; its content can no longer be edited." },
                    statusCode: 409);
            }
        }

        if (touchesSchedule && !SurveyStatuses.AllowsScheduleEdit(survey.Status))
        {
            return Results.Json(
                new { message = $"A survey in status '{survey.Status}' can no longer be rescheduled." },
                statusCode: 409);
        }

        // A start date is a fact once it has passed. Extending EndDate on a running survey
        // is a normal operation; moving the moment it opened is a rewrite of history.
        if (request.StartDate.HasValue
            && request.StartDate.Value != survey.StartDate
            && SurveyStatuses.AcceptsResponses(survey.Status))
        {
            return Results.Json(
                new { message = "StartDate cannot be changed once the survey is active." },
                statusCode: 409);
        }

        // Captured after every guard has passed and before the first mutation, so the audit
        // entry can say what actually CHANGED rather than what the request mentioned. A PUT
        // that resends the same title is not a change, and a history full of no-ops is a
        // history nobody reads.
        var contentBefore = await SurveyAuditTrail.LoadContentAsync(db, survey, cancellationToken);

        if (request.Language is not null)
        {
            var requestedLanguage = ContentLanguages.NormaliseLanguage(request.Language);
            if (requestedLanguage is null)
            {
                return InvalidLanguage(request.Language);
            }

            survey.Language = requestedLanguage;
        }

        if (request.Title is not null)
        {
            if (!request.Title.TryResolve(survey.Language, "title", out var titleEn, out var titleEs, out var titleError))
            {
                return Results.Json(new { message = titleError }, statusCode: 400);
            }

            // Null means "this locale was not supplied", which on an update leaves the
            // stored translation alone. Clearing one is an explicit empty string.
            if (titleEn is not null) survey.TitleEn = titleEn.Trim();
            if (titleEs is not null) survey.TitleEs = titleEs.Trim();
        }

        if (request.Description is not null)
        {
            if (!request.Description.TryResolve(survey.Language, "description", out var descriptionEn, out var descriptionEs, out var descriptionError))
            {
                return Results.Json(new { message = descriptionError }, statusCode: 400);
            }

            if (descriptionEn is not null) survey.DescriptionEn = descriptionEn;
            if (descriptionEs is not null) survey.DescriptionEs = descriptionEs;
        }

        if (request.Type is not null)
        {
            var type = request.Type.Trim();
            if (string.IsNullOrWhiteSpace(type))
            {
                return Results.Json(new { message = "Type is required" }, statusCode: 400);
            }

            survey.Type = type;
        }

        var startDate = request.StartDate ?? survey.StartDate;
        var endDate = request.EndDate ?? survey.EndDate;
        if (startDate >= endDate)
        {
            return Results.Json(new { message = "StartDate must be before EndDate" }, statusCode: 400);
        }

        survey.StartDate = startDate;
        survey.EndDate = endDate;
        if (request.TargetAudienceCount.HasValue) survey.TargetAudienceCount = request.TargetAudienceCount.Value;

        if (request.Settings is not null)
        {
            var settingsError = ApplySettings(survey.Settings, request.Settings, survey.Language);
            if (settingsError is not null)
            {
                return settingsError;
            }
        }

        if (request.DepartmentIds is not null)
        {
            var departmentIds = request.DepartmentIds.Distinct().ToList();
            var departmentError = await ValidateDepartmentsAsync(db, survey.CompanyId, departmentIds, cancellationToken);
            if (departmentError is not null)
            {
                return departmentError;
            }

            var existing = await db.SurveyDepartmentTargets.Where(t => t.SurveyId == survey.Id).ToListAsync(cancellationToken);
            db.SurveyDepartmentTargets.RemoveRange(existing);
            foreach (var departmentId in departmentIds)
            {
                db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget { SurveyId = survey.Id, DepartmentId = departmentId });
            }
        }

        if (request.Questions is not null)
        {
            var prepared = new List<PreparedQuestion>();
            foreach (var question in request.Questions)
            {
                var (preparedQuestion, error) = PrepareQuestion(question, survey.Language);
                if (error is not null)
                {
                    return error;
                }

                prepared.Add(preparedQuestion!);
            }

            var duplicateOrder = prepared.GroupBy(p => p.Input.Order).FirstOrDefault(g => g.Count() > 1);
            if (duplicateOrder is not null)
            {
                return Results.Json(new { message = $"Two questions share order {duplicateOrder.Key}" }, statusCode: 400);
            }

            // Replace wholesale. Safe only because we have already established the survey
            // is a draft with zero responses -- with responses in play this would orphan
            // every question_responses row, which is precisely what the guard above exists
            // to prevent.
            var existingQuestions = await db.Questions.Where(x => x.SurveyId == survey.Id).ToListAsync(cancellationToken);
            var existingIds = existingQuestions.Select(x => x.Id).ToList();
            var existingOptions = await db.QuestionOptions.Where(o => existingIds.Contains(o.QuestionId)).ToListAsync(cancellationToken);
            var existingEmoji = await db.QuestionEmojiOptions.Where(o => existingIds.Contains(o.QuestionId)).ToListAsync(cancellationToken);
            var existingLogic = await db.QuestionConditionalLogics.Where(c => existingIds.Contains(c.QuestionId)).ToListAsync(cancellationToken);
            db.QuestionConditionalLogics.RemoveRange(existingLogic);
            db.QuestionEmojiOptions.RemoveRange(existingEmoji);
            db.QuestionOptions.RemoveRange(existingOptions);
            db.Questions.RemoveRange(existingQuestions);

            AddQuestions(db, survey.Id, prepared);
        }

        var updatedAt = DateTimeOffset.UtcNow;
        survey.UpdatedAt = updatedAt;
        await db.SaveChangesAsync(cancellationToken);

        // Read back rather than diffed in memory: the question rows are replaced wholesale,
        // so the post-state only exists once it has been written. Hence the second save --
        // a cost paid on updates only, and only when something actually moved.
        var contentAfter = await SurveyAuditTrail.LoadContentAsync(db, survey, cancellationToken);
        var changedFields = SurveyVersioning.Diff(contentBefore, contentAfter);
        if (changedFields.Count > 0)
        {
            SurveyAuditTrail.Record(
                db, survey.Id, SurveyAuditActions.Updated, SurveyAuditEntityTypes.Survey, actor, updatedAt,
                new SurveyAuditChangeSet(Fields: changedFields));
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(await ToDetailAsync(survey, db, lang, cancellationToken));
    }

    // ------------------------------------------------------------------
    // Status lifecycle
    // ------------------------------------------------------------------

    private static async Task<IResult> UpdateStatusAsync(
        Guid id,
        UpdateSurveyStatusRequest request,
        string? lang,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        if (!CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        // Publishing writes a survey_versions row whose created_by is NOT NULL with a
        // RESTRICT foreign key, so the actor has to resolve before the transition, not after.
        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return ActingUserRequired();
        }

        var transitionError = await ApplyStatusAsync(db, survey, request.Status, actor, cancellationToken);
        if (transitionError is not null)
        {
            return transitionError;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(survey, db, lang, cancellationToken));
    }

    /// <summary>
    /// The whole lifecycle rule, in one place so <c>PUT /status</c> and <c>POST /bulk</c>
    /// cannot drift apart. Mutates <paramref name="survey"/> and returns null on success,
    /// or the <see cref="IResult"/> to send back. Does not save.
    /// </summary>
    private static async Task<IResult?> ApplyStatusAsync(
        ClimateProjectDbContext db,
        Survey survey,
        string? requestedStatus,
        SurveyActor actor,
        CancellationToken cancellationToken)
    {
        if (!SurveyStatuses.IsValid(requestedStatus))
        {
            return InvalidStatus(requestedStatus);
        }

        var target = requestedStatus!;
        if (!SurveyStatuses.CanTransition(survey.Status, target))
        {
            var allowed = SurveyStatuses.AllowedTransitionsFrom(survey.Status);
            return Results.Json(
                new
                {
                    message = allowed.Count == 0
                        ? $"A survey in status '{survey.Status}' is final and cannot change status."
                        : $"Cannot move a survey from '{survey.Status}' to '{target}'. Allowed from '{survey.Status}': {string.Join(", ", allowed)}.",
                    from = survey.Status,
                    to = target,
                    allowedTransitions = allowed,
                },
                statusCode: 409);
        }

        if (string.Equals(survey.Status, target, StringComparison.Ordinal))
        {
            // Idempotent no-op: a retried request is not an error, and re-running the
            // publish gate on an already-published survey could only ever fail a survey
            // that is already live.
            return null;
        }

        // The freeze, restated on the lifecycle path. SurveyStatuses already makes 'draft'
        // unreachable from anything that accepts responses, so this can only fire on a row
        // whose status and responses disagree with the transition map -- a legacy import, a
        // manual UPDATE, a future edge added to the map. It is the same belt-and-braces
        // UpdateAsync applies to a draft that somehow has responses, and it is the guard
        // that survives someone deciding 'active -> draft' would be convenient: the content
        // a response was collected against must not become editable again.
        if (SurveyStatuses.AllowsContentEdit(target) && await HasResponsesAsync(db, survey, cancellationToken))
        {
            return Results.Json(
                new
                {
                    message = $"This survey has responses, so it cannot return to '{target}' where its content would be editable. "
                              + "Duplicate it instead -- the copy keeps every option's stable value, so its responses still aggregate with this one's.",
                    from = survey.Status,
                    to = target,
                },
                statusCode: 409);
        }

        if (SurveyStatuses.IsPublish(survey.Status, target))
        {
            var questions = await db.Questions.Where(x => x.SurveyId == survey.Id).ToListAsync(cancellationToken);
            if (questions.Count == 0)
            {
                return Results.Json(
                    new { message = "Cannot publish a survey with no questions." },
                    statusCode: 400);
            }

            var options = await SurveyContent.LoadOptionsAsync(db, questions.Select(x => x.Id).ToList(), cancellationToken);

            // The content-i18n publish gate (#195). Leaving draft for a respondent-visible
            // status is the point at which "export/show the survey in ES and EN without
            // untranslated strings" has to be deterministically true, and a read-time
            // fallback can only ever make it usually true. Deliberately not enforced on
            // save: a half-translated draft must be savable in order to translate the
            // other half.
            var missing = ContentPublishValidation.FindMissing(
                survey.Language,
                SurveyContent.GateFields(survey, questions, options));

            if (missing.Count > 0)
            {
                return Results.Json(
                    new { message = ContentPublishValidation.Describe(missing), missingTranslations = missing },
                    statusCode: 400);
            }

            // Snapshot AFTER the gate and before the status moves. This is the moment the
            // content becomes visible to respondents and therefore the moment it stops
            // being editable -- so the snapshot taken here is, and stays, an exact copy of
            // whatever every response to this survey was collected against.
            //
            // Only on IsPublish, which is 'draft -> scheduled|active'. 'scheduled -> active'
            // deliberately does not re-snapshot: the gate already ran on the way into
            // scheduled and the content has been frozen ever since, so a second row would
            // be a duplicate of the first with a later timestamp.
            await SurveyAuditTrail.CaptureVersionAsync(
                db, survey, questions, options, actor, DateTimeOffset.UtcNow, cancellationToken);
        }

        var from = survey.Status;
        var changedAt = DateTimeOffset.UtcNow;
        survey.Status = target;
        survey.UpdatedAt = changedAt;

        SurveyAuditTrail.Record(
            db, survey.Id, SurveyAuditActions.StatusChanged, SurveyAuditEntityTypes.Status, actor, changedAt,
            new SurveyAuditChangeSet(From: from, To: target));

        return null;
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
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        if (!CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        var deleteError = await DeleteSurveyAsync(db, survey, cancellationToken);
        if (deleteError is not null)
        {
            return deleteError;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult?> DeleteSurveyAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CancellationToken cancellationToken)
    {
        // Deleting a survey that has been answered destroys the answers with it -- the
        // responses cascade. Archiving is the operation that means "stop showing me this"
        // without discarding what people said.
        if (await HasResponsesAsync(db, survey, cancellationToken))
        {
            return Results.Json(
                new { message = "This survey has responses and cannot be deleted. Archive it instead." },
                statusCode: 409);
        }

        db.Surveys.Remove(survey);
        return null;
    }

    // ------------------------------------------------------------------
    // Duplicate
    // ------------------------------------------------------------------

    private static async Task<IResult> DuplicateAsync(
        Guid id,
        DuplicateSurveyRequest? request,
        string? lang,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        if (!CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        string? titleEn = null;
        string? titleEs = null;
        if (request?.Title is not null
            && !request.Title.TryResolve(survey.Language, "title", out titleEn, out titleEs, out var titleError))
        {
            return Results.Json(new { message = titleError }, statusCode: 400);
        }

        var startDate = request?.StartDate ?? survey.StartDate;
        var endDate = request?.EndDate ?? survey.EndDate;
        if (startDate >= endDate)
        {
            return Results.Json(new { message = "StartDate must be before EndDate" }, statusCode: 400);
        }

        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return ActingUserRequired();
        }

        var questions = await db.Questions.Where(x => x.SurveyId == survey.Id).ToListAsync(cancellationToken);
        var questionIds = questions.Select(x => x.Id).ToList();
        var options = await db.QuestionOptions.Where(o => questionIds.Contains(o.QuestionId)).ToListAsync(cancellationToken);
        var emojiOptions = await db.QuestionEmojiOptions.Where(o => questionIds.Contains(o.QuestionId)).ToListAsync(cancellationToken);
        var conditionalLogic = await db.QuestionConditionalLogics.Where(c => questionIds.Contains(c.QuestionId)).ToListAsync(cancellationToken);
        var departmentTargets = await db.SurveyDepartmentTargets.Where(t => t.SurveyId == survey.Id).ToListAsync(cancellationToken);

        var source = new SurveyStructure(survey, questions, options, emojiOptions, conditionalLogic, departmentTargets);

        // Detached from the change tracker before anything is added: the copy's rows are
        // brand-new instances, and the source's rows must not be marked modified by having
        // been read.
        var duplicatedAt = DateTimeOffset.UtcNow;
        var copy = SurveyDuplication.Duplicate(
            source,
            Guid.NewGuid(),
            actor.UserId,
            duplicatedAt,
            Guid.NewGuid,
            new SurveyDuplicateOptions(titleEn, titleEs, startDate, endDate));

        db.Surveys.Add(copy.Survey);
        db.SurveyDepartmentTargets.AddRange(copy.DepartmentTargets);
        db.Questions.AddRange(copy.Questions);
        db.QuestionOptions.AddRange(copy.Options);
        db.QuestionEmojiOptions.AddRange(copy.EmojiOptions);
        db.QuestionConditionalLogics.AddRange(copy.ConditionalLogic);

        // Two entries, one per survey. The source's history has to show that a copy was
        // taken from it -- a closed survey whose wording reappears in a new draft is a fact
        // about the closed one too -- and the copy's history has to start at its creation
        // like any other survey's, or a duplicate would be the one survey with no origin.
        SurveyAuditTrail.Record(
            db, survey.Id, SurveyAuditActions.Duplicated, SurveyAuditEntityTypes.Survey, actor, duplicatedAt,
            entityId: copy.Survey.Id.ToString());
        SurveyAuditTrail.Record(
            db, copy.Survey.Id, SurveyAuditActions.Created, SurveyAuditEntityTypes.Survey, actor, duplicatedAt,
            entityId: survey.Id.ToString());

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(copy.Survey, db, lang, cancellationToken), statusCode: 201);
    }

    // ------------------------------------------------------------------
    // Bulk
    // ------------------------------------------------------------------

    private static async Task<IResult> BulkAsync(
        BulkSurveyActionRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return ActingUserRequired();
        }

        var action = request.Action?.Trim().ToLowerInvariant();
        if (action is null || !SurveyValidation.BulkActions.Contains(action, StringComparer.Ordinal))
        {
            return Results.Json(
                new { message = $"Invalid action: {request.Action}. Expected one of: {string.Join(", ", SurveyValidation.BulkActions)}" },
                statusCode: 400);
        }

        var ids = (request.SurveyIds ?? []).Distinct().ToList();
        if (ids.Count == 0)
        {
            return Results.Json(new { message = "SurveyIds is required" }, statusCode: 400);
        }

        var surveys = await db.Surveys.Where(s => ids.Contains(s.Id)).ToListAsync(cancellationToken);
        var byId = surveys.ToDictionary(s => s.Id);

        var results = new List<BulkSurveyActionResult>(ids.Count);
        foreach (var id in ids)
        {
            if (!byId.TryGetValue(id, out var survey))
            {
                results.Add(new BulkSurveyActionResult(id, false, "Survey not found"));
                continue;
            }

            if (!CanAdminister(currentUser, survey.CompanyId))
            {
                // Reported as "not found", not "forbidden": telling a CompanyAdmin which
                // arbitrary GUIDs exist in other tenants is a cross-tenant probe, and a
                // bulk endpoint taking a list of ids is the ideal shape for one.
                results.Add(new BulkSurveyActionResult(id, false, "Survey not found"));
                continue;
            }

            // Every action goes through the same helper a single-survey call uses. Bulk is
            // a loop, never a bypass -- a bulk archive must not be able to archive a survey
            // that PUT /status would have refused.
            IResult? error = action switch
            {
                SurveyValidation.BulkActionArchive => await ApplyStatusAsync(db, survey, SurveyStatuses.Archived, actor, cancellationToken),
                SurveyValidation.BulkActionClose => await ApplyStatusAsync(db, survey, SurveyStatuses.Closed, actor, cancellationToken),
                _ => await DeleteSurveyAsync(db, survey, cancellationToken),
            };

            results.Add(error is null
                ? new BulkSurveyActionResult(id, true, null)
                : new BulkSurveyActionResult(id, false, DescribeFailure(survey, action)));
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new BulkSurveyActionResponse(results));
    }

    private static string DescribeFailure(Survey survey, string action) => action switch
    {
        SurveyValidation.BulkActionDelete => "This survey has responses and cannot be deleted. Archive it instead.",
        _ => $"Cannot move a survey from '{survey.Status}' to '{(action == SurveyValidation.BulkActionArchive ? SurveyStatuses.Archived : SurveyStatuses.Closed)}'.",
    };

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    private static async Task<bool> HasResponsesAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CancellationToken cancellationToken)
        => survey.ResponseCount > 0
           || await db.Responses.AnyAsync(r => r.SurveyId == survey.Id, cancellationToken);

    private static async Task<IResult?> ValidateDepartmentsAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        IReadOnlyCollection<Guid> departmentIds,
        CancellationToken cancellationToken)
    {
        if (departmentIds.Count == 0)
        {
            return null;
        }

        // Departments are validated against the SURVEY's company, not the caller's. A
        // super_admin acting on tenant A must not be able to target tenant B's department,
        // which would put tenant B's employees in tenant A's audience.
        var found = await db.Departments
            .Where(d => departmentIds.Contains(d.Id) && d.CompanyId == companyId)
            .Select(d => d.Id)
            .ToListAsync(cancellationToken);

        var unknown = departmentIds.Except(found).ToList();
        return unknown.Count == 0
            ? null
            : Results.Json(
                new { message = $"Unknown department(s) for this company: {string.Join(", ", unknown)}" },
                statusCode: 400);
    }

    private static (PreparedQuestion? Prepared, IResult? Error) PrepareQuestion(
        CreateSurveyQuestionInput question,
        string language)
    {
        var path = $"questions[{question.Order}]";

        if (!SurveyValidation.ValidQuestionTypes.Contains(question.Type, StringComparer.Ordinal))
        {
            return (null, Results.Json(
                new { message = $"Invalid question type: {question.Type}. Expected one of: {string.Join(", ", SurveyValidation.ValidQuestionTypes)}" },
                statusCode: 400));
        }

        if (question.Text is null)
        {
            return (null, Results.Json(new { message = $"Question {question.Order} requires text" }, statusCode: 400));
        }

        if (!question.Text.TryResolve(language, $"{path}.text", out var textEn, out var textEs, out var textError))
        {
            return (null, Results.Json(new { message = textError }, statusCode: 400));
        }

        if (string.IsNullOrWhiteSpace(textEn) && string.IsNullOrWhiteSpace(textEs))
        {
            return (null, Results.Json(new { message = $"Question {question.Order} requires text" }, statusCode: 400));
        }

        string? scaleLabelMinEn = null;
        string? scaleLabelMinEs = null;
        if (question.ScaleLabelMin is not null
            && !question.ScaleLabelMin.TryResolve(language, $"{path}.scaleLabelMin", out scaleLabelMinEn, out scaleLabelMinEs, out var minError))
        {
            return (null, Results.Json(new { message = minError }, statusCode: 400));
        }

        string? scaleLabelMaxEn = null;
        string? scaleLabelMaxEs = null;
        if (question.ScaleLabelMax is not null
            && !question.ScaleLabelMax.TryResolve(language, $"{path}.scaleLabelMax", out scaleLabelMaxEn, out scaleLabelMaxEs, out var maxError))
        {
            return (null, Results.Json(new { message = maxError }, statusCode: 400));
        }

        string? commentPromptEn = null;
        string? commentPromptEs = null;
        if (question.CommentPrompt is not null
            && !question.CommentPrompt.TryResolve(language, $"{path}.commentPrompt", out commentPromptEn, out commentPromptEs, out var promptError))
        {
            return (null, Results.Json(new { message = promptError }, statusCode: 400));
        }

        if (question.ScaleMin.HasValue && question.ScaleMax.HasValue && question.ScaleMin.Value >= question.ScaleMax.Value)
        {
            return (null, Results.Json(new { message = $"Question {question.Order}: ScaleMin must be less than ScaleMax" }, statusCode: 400));
        }

        var options = new List<QuestionOption>();
        var order = 0;
        foreach (var optionInput in question.Options ?? [])
        {
            string? labelEn = null;
            string? labelEs = null;
            if (optionInput.Label is not null
                && !optionInput.Label.TryResolve(language, $"{path}.options[{order}].label", out labelEn, out labelEs, out var labelError))
            {
                return (null, Results.Json(new { message = labelError }, statusCode: 400));
            }

            var value = SurveyContent.DeriveOptionValue(optionInput.Value, labelEn, labelEs);
            if (value is null)
            {
                return (null, Results.Json(
                    new { message = $"Option {order} of question {question.Order} needs a value or a label" },
                    statusCode: 400));
            }

            if (options.Any(o => string.Equals(o.Value, value, StringComparison.Ordinal)))
            {
                // Caught here rather than by the unique index so it is a 400 naming the
                // option instead of an opaque DbUpdateException. Duplicate values make a
                // stored answer ambiguous -- the exact failure the stable value prevents.
                return (null, Results.Json(
                    new { message = $"Question {question.Order} has duplicate option value '{value}'" },
                    statusCode: 400));
            }

            options.Add(new QuestionOption { Order = order, Value = value, LabelEn = labelEn, LabelEs = labelEs });
            order++;
        }

        // multiple_choice has no meaningful fallback rendering: unlike "rating" (which
        // falls back to a 1-5 scale) there is nothing to show a respondent without at
        // least 2 real options. Reject at authoring time rather than persist an
        // unanswerable question.
        if (question.Type == QuestionTypes.MultipleChoice && options.Count < 2)
        {
            return (null, Results.Json(
                new { message = $"Question {question.Order}: multiple_choice questions require at least 2 options" },
                statusCode: 400));
        }

        return (new PreparedQuestion(
            question, textEn, textEs, scaleLabelMinEn, scaleLabelMinEs, scaleLabelMaxEn, scaleLabelMaxEs,
            commentPromptEn, commentPromptEs, options), null);
    }

    private static void AddQuestions(ClimateProjectDbContext db, Guid surveyId, IReadOnlyList<PreparedQuestion> prepared)
    {
        foreach (var item in prepared)
        {
            var questionId = Guid.NewGuid();
            var question = new Question
            {
                Id = questionId,
                SurveyId = surveyId,
                TextEn = item.TextEn?.Trim(),
                TextEs = item.TextEs?.Trim(),
                Type = item.Input.Type,
                ScaleMin = item.Input.ScaleMin,
                ScaleMax = item.Input.ScaleMax,
                ScaleLabelMinEn = item.ScaleLabelMinEn,
                ScaleLabelMinEs = item.ScaleLabelMinEs,
                ScaleLabelMaxEn = item.ScaleLabelMaxEn,
                ScaleLabelMaxEs = item.ScaleLabelMaxEs,
                CommentRequired = item.Input.CommentRequired,
                Required = item.Input.Required,
                Order = item.Input.Order,
                Category = item.Input.Category,
            };

            // Left at the entity's own per-language default when the caller said nothing.
            // Assigning null here would push a null into a NOT NULL column and, worse,
            // discard the Spanish default that #195 added precisely because the single
            // shared column used to serve an English prompt to Spanish-only surveys.
            if (item.CommentPromptEn is not null) question.CommentPromptEn = item.CommentPromptEn;
            if (item.CommentPromptEs is not null) question.CommentPromptEs = item.CommentPromptEs;

            db.Questions.Add(question);

            foreach (var option in item.Options)
            {
                option.QuestionId = questionId;
                db.QuestionOptions.Add(option);
            }
        }
    }

    private static IResult? ApplySettings(SurveySettings settings, SurveySettingsInput input, string language)
    {
        if (input.Anonymous.HasValue) settings.Anonymous = input.Anonymous.Value;
        if (input.AllowPartialResponses.HasValue) settings.AllowPartialResponses = input.AllowPartialResponses.Value;
        if (input.RandomizeQuestions.HasValue) settings.RandomizeQuestions = input.RandomizeQuestions.Value;
        if (input.ShowProgress.HasValue) settings.ShowProgress = input.ShowProgress.Value;
        if (input.AutoSave.HasValue) settings.AutoSave = input.AutoSave.Value;
        if (input.TimeLimitMinutes.HasValue) settings.TimeLimitMinutes = input.TimeLimitMinutes.Value;
        if (input.ResponseLimit.HasValue) settings.ResponseLimit = input.ResponseLimit.Value;
        if (input.NotificationSendInvitations.HasValue) settings.NotificationSendInvitations = input.NotificationSendInvitations.Value;
        if (input.NotificationSendReminders.HasValue) settings.NotificationSendReminders = input.NotificationSendReminders.Value;
        if (input.NotificationReminderFrequencyDays.HasValue) settings.NotificationReminderFrequencyDays = input.NotificationReminderFrequencyDays.Value;
        if (input.InvitationIncludeCredentials.HasValue) settings.InvitationIncludeCredentials = input.InvitationIncludeCredentials.Value;
        if (input.InvitationSendImmediately.HasValue) settings.InvitationSendImmediately = input.InvitationSendImmediately.Value;
        if (input.InvitationBrandingEnabled.HasValue) settings.InvitationBrandingEnabled = input.InvitationBrandingEnabled.Value;

        if (input.InvitationCustomMessage is not null)
        {
            if (!input.InvitationCustomMessage.TryResolve(language, "settings.invitationCustomMessage", out var messageEn, out var messageEs, out var messageError))
            {
                return Results.Json(new { message = messageError }, statusCode: 400);
            }

            if (messageEn is not null) settings.InvitationCustomMessageEn = messageEn;
            if (messageEs is not null) settings.InvitationCustomMessageEs = messageEs;
        }

        if (input.InvitationCustomSubject is not null)
        {
            if (!input.InvitationCustomSubject.TryResolve(language, "settings.invitationCustomSubject", out var subjectEn, out var subjectEs, out var subjectError))
            {
                return Results.Json(new { message = subjectError }, statusCode: 400);
            }

            if (subjectEn is not null) settings.InvitationCustomSubjectEn = subjectEn;
            if (subjectEs is not null) settings.InvitationCustomSubjectEs = subjectEs;
        }

        return null;
    }

    internal static async Task<SurveyDetail> ToDetailAsync(
        Survey survey,
        ClimateProjectDbContext db,
        string? lang,
        CancellationToken cancellationToken)
    {
        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();

        var questions = await db.Questions
            .Where(x => x.SurveyId == survey.Id)
            .OrderBy(x => x.Order)
            .ToListAsync(cancellationToken);

        var optionsByQuestion = await SurveyContent.LoadOptionsAsync(
            db, questions.Select(x => x.Id).ToList(), cancellationToken);

        var questionDtos = questions.Select(question =>
        {
            var path = $"questions[{question.Order}]";
            optionsByQuestion.TryGetValue(question.Id, out var options);
            return new SurveyQuestionDto(
                question.Id,
                SurveyContent.Resolve(question.TextEn, question.TextEs, locale, survey.Language, $"{path}.text", fallbackFields),
                question.Type,
                SurveyContent.ToOptionDtos(options, locale, survey.Language, path, fallbackFields),
                question.ScaleMin,
                question.ScaleMax,
                SurveyContent.Resolve(question.ScaleLabelMinEn, question.ScaleLabelMinEs, locale, survey.Language, $"{path}.scaleLabelMin", fallbackFields),
                SurveyContent.Resolve(question.ScaleLabelMaxEn, question.ScaleLabelMaxEs, locale, survey.Language, $"{path}.scaleLabelMax", fallbackFields),
                question.Required,
                question.CommentRequired,
                SurveyContent.Resolve(question.CommentPromptEn, question.CommentPromptEs, locale, survey.Language, $"{path}.commentPrompt", fallbackFields),
                question.Order,
                question.Category);
        }).ToList();

        var departmentIds = await db.SurveyDepartmentTargets
            .Where(t => t.SurveyId == survey.Id)
            .Select(t => t.DepartmentId)
            .ToListAsync(cancellationToken);

        var settings = new SurveySettingsDto(
            survey.Settings.Anonymous,
            survey.Settings.AllowPartialResponses,
            survey.Settings.RandomizeQuestions,
            survey.Settings.ShowProgress,
            survey.Settings.AutoSave,
            survey.Settings.TimeLimitMinutes,
            survey.Settings.ResponseLimit,
            survey.Settings.NotificationSendInvitations,
            survey.Settings.NotificationSendReminders,
            survey.Settings.NotificationReminderFrequencyDays,
            SurveyContent.Resolve(
                survey.Settings.InvitationCustomMessageEn, survey.Settings.InvitationCustomMessageEs,
                locale, survey.Language, "settings.invitationCustomMessage", fallbackFields),
            SurveyContent.Resolve(
                survey.Settings.InvitationCustomSubjectEn, survey.Settings.InvitationCustomSubjectEs,
                locale, survey.Language, "settings.invitationCustomSubject", fallbackFields),
            survey.Settings.InvitationIncludeCredentials,
            survey.Settings.InvitationSendImmediately,
            survey.Settings.InvitationBrandingEnabled);

        // ResolvedLocale names the language the caller is actually READING, not the one
        // they asked for. A Spanish-only survey fetched with ?lang=en comes back in
        // Spanish; reporting "en" there would be precisely the silent substitution the
        // paired columns and FallbackFields exist to prevent, and it would contradict
        // LocalizedText.ResolvedLocale ("the locale Text is actually written in"). The
        // title is the survey's identifying content, so it names the payload as a whole;
        // FallbackFields still carries the per-field detail for anything that diverges.
        var resolvedLocale = LocalizedContent
            .Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language)
            .ResolvedLocale ?? locale;

        return new SurveyDetail(
            survey.Id,
            SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields),
            SurveyContent.Resolve(survey.DescriptionEn, survey.DescriptionEs, locale, survey.Language, "description", fallbackFields),
            survey.CompanyId,
            survey.CreatedBy,
            survey.Type,
            survey.Status,
            survey.Language,
            resolvedLocale,
            fallbackFields,
            survey.StartDate,
            survey.EndDate,
            survey.ResponseCount,
            survey.TargetAudienceCount,
            survey.Version,
            departmentIds,
            questionDtos,
            settings,
            SurveyStatuses.AllowedTransitionsFrom(survey.Status),
            SurveyStatuses.AllowsContentEdit(survey.Status),
            survey.CreatedAt,
            survey.UpdatedAt);
    }

    private static IResult NotFound() => Results.Json(new { message = "Survey not found" }, statusCode: 404);

    private static IResult InvalidStatus(string? status)
        => Results.Json(
            new { message = $"Invalid status: {status}. Expected one of: {string.Join(", ", SurveyStatuses.All)}" },
            statusCode: 400);

    private static IResult InvalidLanguage(string? language)
        => Results.Json(
            new { message = $"Invalid language: {language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" },
            statusCode: 400);
}
