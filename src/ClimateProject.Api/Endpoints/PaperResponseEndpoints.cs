using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Paper questionnaires entered by a TIMS operator from a roster row, and wording-only
/// corrections of a question on a survey with answers (both ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>).
/// </summary>
/// <remarks>
/// <para><b>Paper.</b> Until this, a paper questionnaire was entered by re-pointing the person's
/// account email at a TIMS inbox and reissuing their key (<c>esph-fisicas-10nov.sh</c>), so TIMS
/// could sign in as them. Now the operator types the answers on a roster row and they are written
/// through the respondent's own write path (<see cref="SurveyResponseEndpoints.SubmitPaperResponseAsync"/>):
/// the account, the email and every credential stay exactly as they were.</para>
/// <para><b>Wording.</b> PROCOMER's question 55 read «¿Hay algun comentario…» with one answer
/// stored, and the only fix was a duplicate. A super admin may now change the WORDS of a question
/// with answers -- its text, comment prompt, scale end labels and option labels -- while every
/// thing an answer depends on stays identical; anything else is refused naming the field. It is
/// a new version (<see cref="SurveyAuditTrail.CaptureVersionAsync"/>), as every operator live edit is.</para>
/// <para>Both are super admin only, and both file their audit row under the survey's company: a
/// TIMS operator has no company of their own, and an unattributed row is not written at all.</para>
/// </remarks>
public static class PaperResponseEndpoints
{
    public static void MapPaperResponseEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        var group = app.MapGroup("/surveys").RequireAuthorization();
        group.MapGet("/{surveyId:guid}/paper-responses/{userId:guid}", GetFormAsync);
        group.MapPost("/{surveyId:guid}/paper-responses/{userId:guid}", EnterAsync);
        group.MapPut("/{surveyId:guid}/wording", CorrectWordingAsync);
    }

    // ------------------------------------------------------------------
    // Paper questionnaires
    // ------------------------------------------------------------------

    /// <summary>
    /// <c>GET /surveys/{surveyId}/paper-responses/{userId}</c>: the questionnaire as this person
    /// would be served it, for the operator to type into. Refused for the same reasons the entry
    /// is, so the screen says so before anybody types 57 answers.
    /// </summary>
    private static async Task<IResult> GetFormAsync(
        Guid surveyId,
        Guid userId,
        string? lang,
        ClaimsPrincipal principal,
        IConfiguration configuration,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, person, refusal) = await AdmitAsync(surveyId, userId, principal, configuration, db, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        // The reader this person is: the survey's anonymity, and an account -- so the view asks
        // no self-declared demographics, exactly as when they answer signed in.
        var view = await SurveyResponseEndpoints.BuildRespondViewAsync(
            db, survey!, lang, new RespondReader(survey!.Settings.Anonymous, HasAccount: true), inProgress: null, cancellationToken);

        return Results.Ok(new PaperResponseForm(view, person!.Id, person.Name, person.Email));
    }

    /// <summary>
    /// <c>POST /surveys/{surveyId}/paper-responses/{userId}</c>: record the paper questionnaire as
    /// this person's completed response.
    /// </summary>
    /// <remarks>
    /// The audit row names the operator and the survey, and never the response: on an anonymous
    /// survey the response id would join the person to their answers, so it is neither returned
    /// nor recorded. On an anonymous survey it does not name the person either, because its
    /// timestamp matches the response's to the second; on an identified one it does.
    /// </remarks>
    private static async Task<IResult> EnterAsync(
        Guid surveyId,
        Guid userId,
        PaperResponseRequest request,
        ClaimsPrincipal principal,
        AuditEntry audit,
        IConfiguration configuration,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (survey, person, refusal) = await AdmitAsync(surveyId, userId, principal, configuration, db, cancellationToken);
        if (survey is not null)
        {
            await AttributeToSurveyCompanyAsync(audit, principal.GetCurrentUser(), survey.CompanyId, db, cancellationToken);
        }

        // Which survey and which roster person, as the credential routes name a person's key.
        // Never the response: see the remarks. On an ANONYMOUS survey not the person either --
        // neither in the resource id nor in the recorded path: the response is written in this
        // request, so this row's timestamp matches its StartTime and CompletionTime to the
        // second, and a row naming the person would join them to their answers by the clock
        // (the join SurveyParticipation keeps to a calendar day to prevent).
        if (survey?.Settings.Anonymous ?? true)
        {
            audit.SetResourceId(surveyId.ToString());
            audit.RedactPath($"/surveys/{surveyId}/paper-responses");
        }
        else
        {
            audit.SetResourceId($"{surveyId}/{userId}");
        }

        if (refusal is not null)
        {
            return refusal;
        }

        var result = await SurveyResponseEndpoints.SubmitPaperResponseAsync(
            survey!, person!.Id, person.DepartmentId, request, configuration, db, loggerFactory, cancellationToken);

        // The write path's own refusals (a required question unanswered, a value outside the
        // scale, an exhausted licence) pass through as they are. Its success body is NOT passed
        // on: it carries the response id -- see the remarks.
        if (result is IValueHttpResult<SurveySubmissionResult> { Value: { } submitted })
        {
            if (submitted.AlreadySubmitted)
            {
                return AlreadyCompleted();
            }

            audit.RecordChange("paperResponse", null, "entered");
            return Results.Json(
                new PaperResponseResult(survey!.Id, person.Id, SurveyParticipantStatuses.Completed),
                statusCode: StatusCodes.Status201Created);
        }

        return result;
    }

    private sealed record RosterPerson(Guid Id, string Name, string Email, Guid? DepartmentId);

    /// <summary>
    /// Every refusal an operator entry has, in one place for the form and the write: super
    /// admin only; not archived; collecting or closed (a draft or scheduled survey has no
    /// respondents yet); the person on the survey's roster -- its population -- and not yet
    /// completed by the roster's own reading of it.
    /// </summary>
    private static async Task<(Survey? Survey, RosterPerson? Person, IResult? Refusal)> AdmitAsync(
        Guid surveyId,
        Guid userId,
        ClaimsPrincipal principal,
        IConfiguration configuration,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return (null, null, Results.NotFound());
        }

        var currentUser = principal.GetCurrentUser();
        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return (survey, null, Results.Forbid());
        }

        if (currentUser.Role != Roles.SuperAdmin)
        {
            return (survey, null, Refuse(
                StatusCodes.Status403Forbidden,
                AdminRefusals.PaperResponseSuperAdminOnly,
                "Only a TIMS super administrator may enter a paper questionnaire."));
        }

        if (string.Equals(survey.Status, SurveyStatuses.Archived, StringComparison.Ordinal))
        {
            return (survey, null, Refuse(
                StatusCodes.Status409Conflict,
                AdminRefusals.PaperResponseSurveyArchived,
                "An archived survey takes no more responses, on paper or otherwise."));
        }

        if (!SurveyStatuses.AcceptsResponses(survey.Status)
            && !string.Equals(survey.Status, SurveyStatuses.Closed, StringComparison.Ordinal))
        {
            return (survey, null, Refuse(
                StatusCodes.Status409Conflict,
                AdminRefusals.PaperResponseNotCollecting,
                $"A survey in status '{survey.Status}' has not been answered yet; a paper questionnaire is entered once it is open."));
        }

        // The roster IS the population: the survey's audience, read by the same method the
        // screen the operator clicked from reads it, with the same completion rule.
        var (roster, _) = await SurveyParticipationEndpoints.BuildRosterAsync(
            survey.Id, survey.CompanyId, survey.Settings.Anonymous,
            SurveyResumeSessionConfiguration.KeyFrom(configuration), db, cancellationToken);
        var row = roster.FirstOrDefault(r => r.UserId == userId);
        if (row is null)
        {
            return (survey, null, Refuse(
                StatusCodes.Status409Conflict,
                AdminRefusals.PaperResponseNotInPopulation,
                "This person is not in this survey's population."));
        }

        if (string.Equals(row.Status, SurveyParticipantStatuses.Completed, StringComparison.Ordinal))
        {
            return (survey, null, AlreadyCompleted());
        }

        var departmentId = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.DepartmentId)
            .FirstOrDefaultAsync(cancellationToken);

        return (survey, new RosterPerson(row.UserId, row.Name, row.Email, departmentId), null);
    }

    private static IResult AlreadyCompleted() => Refuse(
        StatusCodes.Status409Conflict,
        AdminRefusals.PaperResponseAlreadyCompleted,
        "This person has already completed this survey.");

    // ------------------------------------------------------------------
    // Wording-only corrections
    // ------------------------------------------------------------------

    /// <summary>
    /// <c>PUT /surveys/{surveyId}/wording</c>: every question of the survey, as the editor holds
    /// it. The words are applied in place -- the question and option rows keep their ids and
    /// values, so every stored answer still points at them -- and everything else must be equal
    /// to what is stored, or the request is refused naming the question and the field.
    /// </summary>
    private static async Task<IResult> CorrectWordingAsync(
        Guid surveyId,
        SurveyWordingRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        AuditEntry audit,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return Results.NotFound();
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        await AttributeToSurveyCompanyAsync(audit, currentUser, survey.CompanyId, db, cancellationToken);

        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Refuse(
                StatusCodes.Status403Forbidden,
                AdminRefusals.SurveyWordingSuperAdminOnly,
                "Only a TIMS super administrator may correct the wording of a survey's questions.");
        }

        if (string.Equals(survey.Status, SurveyStatuses.Archived, StringComparison.Ordinal))
        {
            return Refuse(StatusCodes.Status409Conflict, AdminRefusals.SurveyContentLocked, "An archived survey cannot be edited.");
        }

        if (request.Questions is null)
        {
            return Results.Json(new { message = "questions is required" }, statusCode: 400);
        }

        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return SurveyEndpoints.ActingUserRequired();
        }

        // The same serialisation the operator live edit takes: the survey row held, so the
        // version written below describes exactly the words a response committed after it saw.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM surveys WHERE \"Id\" = {survey.Id} FOR UPDATE", cancellationToken);

        var questions = await db.Questions.Where(q => q.SurveyId == survey.Id).ToListAsync(cancellationToken);
        var options = await SurveyContent.LoadOptionsAsync(db, questions.Select(q => q.Id).ToList(), cancellationToken);

        var storedIds = questions.Select(q => q.Id).ToHashSet();
        var sentIds = request.Questions.Select(q => q.Id).ToList();
        if (sentIds.Count != storedIds.Count || sentIds.Distinct().Count() != sentIds.Count || !storedIds.SetEquals(sentIds))
        {
            return Refuse(
                StatusCodes.Status409Conflict,
                AdminRefusals.SurveyWordingQuestionsMismatch,
                "A wording correction keeps every question: send each of the survey's questions once, and no other.");
        }

        var byId = questions.ToDictionary(q => q.Id);

        // Every structural comparison first, before a single word is applied: a refusal leaves
        // nothing half-written in the change tracker.
        foreach (var input in request.Questions)
        {
            var stored = byId[input.Id];
            var storedOptions = options.GetValueOrDefault(stored.Id) ?? [];
            if (StructuralDifference(input, stored, storedOptions) is { } field)
            {
                return StructureChanged(stored, field, $"'{field}' of question {stored.Order} differs.");
            }
        }

        var missingBefore = ContentPublishValidation.FindMissing(
            survey.Language, SurveyContent.GateFields(survey, questions, options)).ToList();
        var contentBefore = await SurveyAuditTrail.LoadContentAsync(db, survey, cancellationToken);

        var changed = new List<Guid>();
        foreach (var input in request.Questions)
        {
            var stored = byId[input.Id];
            var (moved, error) = ApplyWording(input, stored, options.GetValueOrDefault(stored.Id) ?? [], survey.Language);
            if (error is not null)
            {
                return error;
            }

            if (moved)
            {
                changed.Add(stored.Id);
            }
        }

        if (changed.Count == 0)
        {
            return Results.Ok(new SurveyWordingResult(survey.Id, survey.Version, []));
        }

        // The publish gate, held as the operator live edit holds it: a correction may not leave
        // untranslated a text that was translated.
        var newlyMissing = ContentPublishValidation
            .FindMissing(survey.Language, SurveyContent.GateFields(survey, questions, options))
            .Except(missingBefore)
            .ToList();
        if (newlyMissing.Count > 0)
        {
            return Results.Json(
                new { message = ContentPublishValidation.Describe(newlyMissing), missingTranslations = newlyMissing, code = AdminRefusals.SurveyMissingTranslations },
                statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        survey.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        var contentAfter = await SurveyAuditTrail.LoadContentAsync(db, survey, cancellationToken);
        var changedFields = SurveyVersioning.Diff(contentBefore, contentAfter).ToList();

        // A response resolves to its wording through survey.Version. A survey that was never
        // published has no snapshot to supersede: its first one is written when it is.
        if (await db.SurveyVersions.AnyAsync(v => v.SurveyId == survey.Id, cancellationToken))
        {
            await SurveyAuditTrail.CaptureVersionAsync(db, survey, questions, options, actor, now, cancellationToken);
        }

        SurveyAuditTrail.Record(
            db, survey.Id, SurveyAuditActions.Updated, SurveyAuditEntityTypes.Survey, actor, now,
            new SurveyAuditChangeSet(Fields: changedFields));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        audit.RecordChange("wording", null, $"{changed.Count} question(s)");
        return Results.Ok(new SurveyWordingResult(survey.Id, survey.Version, changed));
    }

    /// <summary>
    /// The first thing about <paramref name="input"/> that is not a word and differs from what is
    /// stored, by its request field name; null when only words differ.
    /// </summary>
    /// <remarks>
    /// The comment prompt is a word, but whether there IS one is not: a prompt is what renders a
    /// comment box (<c>Question.CommentPromptEn</c>), so writing one where there was none, or
    /// clearing the last one, adds or removes something asked. Refused as <c>commentPrompt</c>.
    /// </remarks>
    internal static string? StructuralDifference(
        SurveyWordingQuestionInput input,
        Question stored,
        IReadOnlyList<QuestionOption> storedOptions)
    {
        if (!string.Equals(input.Type, stored.Type, StringComparison.Ordinal)) return "type";
        if (input.Order != stored.Order) return "order";
        if (!string.Equals(Blank(input.Category), Blank(stored.Category), StringComparison.Ordinal)) return "category";
        if (input.Required != stored.Required) return "required";
        if (input.CommentRequired != stored.CommentRequired) return "commentRequired";
        if (input.KeepAtEnd != stored.KeepAtEnd) return "keepAtEnd";
        if (input.ScaleMin != stored.ScaleMin) return "scaleMin";
        if (input.ScaleMax != stored.ScaleMax) return "scaleMax";

        var sent = input.Options ?? [];
        if (sent.Count != storedOptions.Count)
        {
            return "options";
        }

        for (var index = 0; index < sent.Count; index++)
        {
            // By position: the stored list is ordered, so equal values at equal positions is
            // "the number, order and values of the options are identical".
            if (!string.Equals(sent[index].Value, storedOptions[index].Value, StringComparison.Ordinal))
            {
                return "options";
            }
        }

        return null;
    }

    /// <summary>
    /// Applies the words of <paramref name="input"/> to the tracked rows. A locale left out keeps
    /// its stored words; an empty string clears them. Returns whether anything moved.
    /// </summary>
    private static (bool Moved, IResult? Error) ApplyWording(
        SurveyWordingQuestionInput input,
        Question stored,
        IReadOnlyList<QuestionOption> storedOptions,
        string language)
    {
        var path = $"questions[{stored.Order}]";
        var moved = false;

        if (!Resolve(input.Text, language, $"{path}.text", out var textEn, out var textEs, out var error)
            || !Resolve(input.ScaleLabelMin, language, $"{path}.scaleLabelMin", out var minEn, out var minEs, out error)
            || !Resolve(input.ScaleLabelMax, language, $"{path}.scaleLabelMax", out var maxEn, out var maxEs, out error)
            || !Resolve(input.CommentPrompt, language, $"{path}.commentPrompt", out var promptEn, out var promptEs, out error))
        {
            return (false, error);
        }

        var hadPrompt = HasWords(stored.CommentPromptEn) || HasWords(stored.CommentPromptEs);
        var hasPrompt = HasWords(promptEn ?? stored.CommentPromptEn) || HasWords(promptEs ?? stored.CommentPromptEs);
        if (hadPrompt != hasPrompt)
        {
            return (false, StructureChanged(
                stored, "commentPrompt", $"'commentPrompt' of question {stored.Order} would add or remove its comment box."));
        }

        var newTextEn = textEn?.Trim() ?? stored.TextEn;
        var newTextEs = textEs?.Trim() ?? stored.TextEs;
        if (!HasWords(newTextEn) && !HasWords(newTextEs))
        {
            return (false, Refuse(
                StatusCodes.Status400BadRequest,
                AdminRefusals.QuestionTextRequired,
                $"Question {stored.Order} requires text"));
        }

        moved |= Set(stored.TextEn, newTextEn, v => stored.TextEn = v);
        moved |= Set(stored.TextEs, newTextEs, v => stored.TextEs = v);
        moved |= Set(stored.ScaleLabelMinEn, minEn ?? stored.ScaleLabelMinEn, v => stored.ScaleLabelMinEn = v);
        moved |= Set(stored.ScaleLabelMinEs, minEs ?? stored.ScaleLabelMinEs, v => stored.ScaleLabelMinEs = v);
        moved |= Set(stored.ScaleLabelMaxEn, maxEn ?? stored.ScaleLabelMaxEn, v => stored.ScaleLabelMaxEn = v);
        moved |= Set(stored.ScaleLabelMaxEs, maxEs ?? stored.ScaleLabelMaxEs, v => stored.ScaleLabelMaxEs = v);
        moved |= Set(stored.CommentPromptEn, promptEn ?? stored.CommentPromptEn, v => stored.CommentPromptEn = v);
        moved |= Set(stored.CommentPromptEs, promptEs ?? stored.CommentPromptEs, v => stored.CommentPromptEs = v);

        var sent = input.Options ?? [];
        for (var index = 0; index < sent.Count; index++)
        {
            var option = storedOptions[index];
            if (!Resolve(sent[index].Label, language, $"{path}.options[{index}].label", out var labelEn, out var labelEs, out error))
            {
                return (false, error);
            }

            moved |= Set(option.LabelEn, labelEn ?? option.LabelEn, v => option.LabelEn = v);
            moved |= Set(option.LabelEs, labelEs ?? option.LabelEs, v => option.LabelEs = v);
        }

        return (moved, null);
    }

    private static bool Resolve(
        LocalizedInput? input, string language, string field, out string? en, out string? es, out IResult? error)
    {
        en = null;
        es = null;
        error = null;
        if (input is null)
        {
            return true;
        }

        if (!input.TryResolve(language, field, out en, out es, out var message))
        {
            error = Results.Json(new { message }, statusCode: 400);
            return false;
        }

        return true;
    }

    private static bool Set(string? before, string? after, Action<string?> assign)
    {
        if (string.Equals(before, after, StringComparison.Ordinal))
        {
            return false;
        }

        assign(after);
        return true;
    }

    private static bool HasWords(string? value) => !string.IsNullOrWhiteSpace(value);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ------------------------------------------------------------------
    // Shared
    // ------------------------------------------------------------------

    /// <summary>
    /// File the audit row under the survey's company: a TIMS operator has none, and the middleware
    /// writes NO row for a caller that resolves to no company (<c>audit_logs.company_id</c> is NOT
    /// NULL). The same reason <c>SurveyCredentialEndpoints</c> gives.
    /// </summary>
    private static async Task AttributeToSurveyCompanyAsync(
        AuditEntry audit, CurrentUser currentUser, Guid companyId, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, companyId);
        }
    }

    /// <summary>The 409 naming the question and the field, beside the code, so a screen can point at it.</summary>
    private static IResult StructureChanged(Question stored, string field, string what)
        => Results.Json(
            new
            {
                message = "Only the wording of a question may change once it has answers; " + what,
                code = AdminRefusals.SurveyWordingStructureChanged,
                questionId = stored.Id,
                field,
            },
            statusCode: StatusCodes.Status409Conflict);

    private static IResult Refuse(int status, string code, string message)
        => Results.Json(new { message, code }, statusCode: status);
}
