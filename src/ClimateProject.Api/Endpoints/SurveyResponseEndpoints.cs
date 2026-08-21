using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The respondent surface: fetch a survey to answer, and submit the answers (#118).
///
/// Mapped outside the <c>/surveys</c> group on purpose. That group carries
/// <c>RequireAuthorization()</c> and every route under it is gated by
/// <c>SurveyEndpoints.CanAdminister</c> -- correct for authoring, and exactly wrong
/// here: the two routes below are answered by employees who administer nothing, and on
/// an anonymous survey by visitors who are not authenticated at all.
/// </summary>
public static class SurveyResponseEndpoints
{
    /// <summary>
    /// Shared with Program.cs's rate limiter registration. Its own policy rather than the
    /// microclimate one: the two surfaces have different traffic shapes (a survey is
    /// answered once over minutes, a microclimate is a live burst) and sharing a partition
    /// would let a flood against one throttle legitimate respondents on the other.
    /// </summary>
    public const string ResponseSubmissionRateLimiterPolicy = "survey-response-submission";

    /// <summary>Requests per IP per window on the public respond path.</summary>
    private const int RateLimitPermitsPerWindow = 60;

    private static readonly TimeSpan RateLimitWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Partitions the respond path per client IP. Lives here rather than inline in
    /// Program.cs so the limits sit beside the endpoints they defend.
    ///
    /// Generous enough for an office behind one NAT answering a survey together, bounded
    /// against a scripted flood -- which on this surface is not a nuisance but a data
    /// integrity attack: fabricated responses are indistinguishable from real ones once
    /// stored, and on an anonymous survey there is deliberately nothing recorded that
    /// could be used to unpick them afterwards.
    ///
    /// <para>
    /// The address comes from <see cref="RateLimitPolicies.ClientIpFor"/> rather than
    /// <c>Connection.RemoteIpAddress</c>: behind App Runner the socket peer is the AWS proxy,
    /// which would collapse every respondent in the world into one partition. See
    /// <see cref="ClientIpResolver"/>.
    /// </para>
    /// </summary>
    public static RateLimitPartition<string> PartitionResponseSubmission(HttpContext httpContext)
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

    public static void MapSurveyResponseEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // Both routes are rate-limited, not just the write. The read is the one that hands
        // out a survey's full question set to anyone holding its GUID, so leaving it
        // unbounded would make the limiter on the write pointless.
        app.MapGet("/surveys/{id:guid}/respond", GetRespondViewAsync)
            .RequireRateLimiting(ResponseSubmissionRateLimiterPolicy);

        app.MapPost("/surveys/{id:guid}/responses", SubmitAsync)
            .RequireRateLimiting(ResponseSubmissionRateLimiterPolicy);
    }

    // ------------------------------------------------------------------
    // Who is answering
    // ------------------------------------------------------------------

    /// <param name="ActingUserId">
    /// Who is making the request, or null for an unauthenticated visitor. This is NOT
    /// what gets written to <c>responses.user_id</c> -- see <see cref="StoredUserId"/>.
    /// It is kept because an identified respondent to an ANONYMOUS survey still has
    /// demographics worth segmenting by, and refusing to look them up would be a
    /// different (and worse) answer than looking them up and then declining to record
    /// the ones that would identify them.
    /// </param>
    /// <param name="IsAnonymous">
    /// Taken from the SURVEY, never from the request. Anonymity is a promise made to
    /// every respondent before any of them answers; letting a caller opt out per
    /// submission would mean an anonymous survey whose rows are attributable for whoever
    /// forgot to set a flag.
    /// </param>
    private sealed record Respondent(Guid? ActingUserId, Guid? DepartmentId, bool IsAnonymous)
    {
        /// <summary>
        /// What <c>responses.user_id</c> is set to. Null the moment the survey is
        /// anonymous, whether or not we know who the respondent is -- the one place the
        /// distinction between "unknown" and "deliberately not recorded" is collapsed, on
        /// purpose, so no other line can get it wrong.
        /// </summary>
        public Guid? StoredUserId => IsAnonymous ? null : ActingUserId;
    }

    private sealed record RespondentResolution(Respondent? Respondent, IResult? Error);

    private sealed record ActingUser(Guid Id, Guid? CompanyId, Guid? DepartmentId);

    /// <summary>
    /// The user row behind the token, resolved by the same three-step chain
    /// <c>SurveyEndpoints.ResolveActingUserIdAsync</c> uses -- <c>sub</c> as a user id,
    /// then <c>persona_external_id</c>, then email.
    ///
    /// Duplicated rather than shared because that method is private, and matching it
    /// matters here more than anywhere: an email-only lookup would fail to resolve a
    /// respondent who signed in through the tracking identity, and they would be told
    /// they have no user record while <c>/surveys/my</c> happily listed the survey.
    ///
    /// Read from the user's own row rather than from the JWT because department
    /// membership moves, and a token minted before a transfer would otherwise let
    /// somebody answer their old team's targeted survey.
    /// </summary>
    private static async Task<ActingUser?> ResolveActingUserAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var bySub = await db.Users
                .Where(u => u.Id == userId)
                .Select(u => new ActingUser(u.Id, u.CompanyId, u.DepartmentId))
                .FirstOrDefaultAsync(cancellationToken);
            if (bySub is not null)
            {
                return bySub;
            }
        }

        var byExternalId = await db.Users
            .Where(u => u.PersonaExternalId == currentUser.Sub)
            .Select(u => new ActingUser(u.Id, u.CompanyId, u.DepartmentId))
            .FirstOrDefaultAsync(cancellationToken);
        if (byExternalId is not null)
        {
            return byExternalId;
        }

        return await db.Users
            .Where(u => u.Email == currentUser.Email)
            .Select(u => new ActingUser(u.Id, u.CompanyId, u.DepartmentId))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static async Task<RespondentResolution> ResolveRespondentAsync(
        Survey survey,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var isAnonymousSurvey = survey.Settings.Anonymous;
        var isAuthenticated = principal.Identity?.IsAuthenticated ?? false;

        if (!isAuthenticated)
        {
            // Same policy the microclimate respond path settled on: a public link is only
            // honoured when the survey is BOTH configured anonymous AND currently open.
            // A draft or closed survey is never publicly readable, whatever its settings
            // say -- the settings describe how it will be answered, not whether it may be.
            return isAnonymousSurvey && SurveyStatuses.AcceptsResponses(survey.Status)
                ? new RespondentResolution(new Respondent(null, null, true), null)
                : new RespondentResolution(null, Unavailable());
        }

        var currentUser = principal.GetCurrentUser();
        var me = await ResolveActingUserAsync(currentUser, db, cancellationToken);

        if (me is null)
        {
            return new RespondentResolution(
                null,
                Results.Json(new { message = "The authenticated user has no matching user record" }, statusCode: 400));
        }

        // Compare Guids, never Guid.ToString(): User.CompanyId is Guid? since #191 and EF
        // cannot translate Nullable<Guid>.ToString() inside a query.
        if (me.CompanyId != survey.CompanyId)
        {
            // A super_admin has no tenant at all (#191), so there is no survey they are
            // expected to answer. They administer surveys; they do not populate them.
            return new RespondentResolution(null, Results.Forbid());
        }

        var hasDepartmentTargets = await db.SurveyDepartmentTargets
            .AnyAsync(t => t.SurveyId == survey.Id, cancellationToken);
        if (hasDepartmentTargets)
        {
            // Matches SurveyQueries.AssignedTo exactly: no targets means company-wide, any
            // targets means only those departments. Two implementations of "is this survey
            // mine to answer" that disagree would list a survey in /surveys/my that the
            // respond endpoint then refuses.
            var targeted = me.DepartmentId is Guid department
                && await db.SurveyDepartmentTargets
                    .AnyAsync(t => t.SurveyId == survey.Id && t.DepartmentId == department, cancellationToken);
            if (!targeted)
            {
                return new RespondentResolution(null, Results.Forbid());
            }
        }

        // An identified respondent to an anonymous survey stays anonymous. The flag is the
        // survey's, so knowing who they are changes only what we decline to write down.
        return new RespondentResolution(
            new Respondent(me.Id, me.DepartmentId, isAnonymousSurvey),
            null);
    }

    // ------------------------------------------------------------------
    // GET /surveys/{id}/respond
    // ------------------------------------------------------------------

    private static async Task<IResult> GetRespondViewAsync(
        Guid id,
        string? lang,
        string? sessionId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        var resolution = await ResolveRespondentAsync(survey, principal, db, cancellationToken);
        if (resolution.Error is not null)
        {
            return resolution.Error;
        }

        var respondent = resolution.Respondent!;
        if (!SurveyStatuses.AcceptsResponses(survey.Status))
        {
            return NotAccepting();
        }

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();
        var questions = await LoadQuestionDtosAsync(survey, db, locale, fallbackFields, cancellationToken);

        var existing = await FindExistingResponseAsync(survey, respondent, sessionId, db, cancellationToken);
        var inProgress = existing is null
            ? null
            : await ToResponseStateAsync(existing, db, cancellationToken);

        // ResolvedLocale names the language the payload is ACTUALLY in, not the one asked
        // for -- a Spanish-only survey opened with ?lang=en comes back in Spanish and says
        // so. Reporting 'en' there is the silent substitution #195 exists to prevent, and
        // it shipped once already on this domain.
        var resolvedLocale = LocalizedContent
            .Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language)
            .ResolvedLocale ?? locale;

        return Results.Ok(new SurveyRespondView(
            survey.Id,
            SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields),
            SurveyContent.Resolve(survey.DescriptionEn, survey.DescriptionEs, locale, survey.Language, "description", fallbackFields),
            survey.Type,
            survey.Language,
            resolvedLocale,
            fallbackFields,
            survey.StartDate,
            survey.EndDate,
            survey.Settings.Anonymous,
            survey.Settings.AllowPartialResponses,
            survey.Settings.AutoSave,
            survey.Settings.RandomizeQuestions,
            survey.Settings.ShowProgress,
            survey.Settings.TimeLimitMinutes,
            questions,
            inProgress));
    }

    // ------------------------------------------------------------------
    // POST /surveys/{id}/responses
    // ------------------------------------------------------------------

    private static async Task<IResult> SubmitAsync(
        Guid id,
        SubmitSurveyResponseRequest request,
        HttpContext httpContext,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(httpContext);

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return NotFound();
        }

        var resolution = await ResolveRespondentAsync(survey, httpContext.User, db, cancellationToken);
        if (resolution.Error is not null)
        {
            return resolution.Error;
        }

        var respondent = resolution.Respondent!;

        // The whole response window in one predicate, and deliberately status-only.
        // SurveyStatuses already encodes which states are open; re-deriving it from
        // StartDate/EndDate here would let this endpoint refuse a survey that
        // SurveyQueries.AssignedTo still lists in /surveys/my, which is a worse failure
        // than a late response to a survey nobody has closed yet.
        if (!SurveyStatuses.AcceptsResponses(survey.Status))
        {
            return NotAccepting();
        }

        if (request.Language is not null && ContentLanguages.NormaliseLocale(request.Language) is null)
        {
            return Results.Json(
                new { message = $"Invalid language: {request.Language}. Expected one of: {string.Join(", ", ContentLanguages.Locales)}" },
                statusCode: 400);
        }

        if (!request.IsComplete && !survey.Settings.AllowPartialResponses)
        {
            return Results.Json(new { message = "This survey does not allow partial responses" }, statusCode: 400);
        }

        var sessionId = request.SessionId?.Trim();
        if (respondent.IsAnonymous && string.IsNullOrEmpty(sessionId))
        {
            // The only key an anonymous submission has. Without it a retried request is
            // indistinguishable from a second respondent, and "double-submit cannot
            // duplicate a response" becomes unenforceable rather than merely unenforced.
            return Results.Json(
                new { message = "sessionId is required when responding to an anonymous survey" },
                statusCode: 400);
        }

        if (sessionId is { Length: > SessionIdMaxLength })
        {
            return Results.Json(
                new { message = $"sessionId must be at most {SessionIdMaxLength} characters" },
                statusCode: 400);
        }

        var existing = await FindExistingResponseAsync(survey, respondent, sessionId, db, cancellationToken);

        // Idempotency. A response that is already complete is never rewritten and never
        // duplicated: the caller gets 200 and the same response id. Returning 409 instead
        // would be indistinguishable, to a client whose first request timed out after the
        // server committed it, from a real failure -- and the retry it then performs is
        // exactly the double-submit this has to survive.
        if (existing is { IsComplete: true })
        {
            return Results.Ok(await ToResultAsync(existing, db, alreadySubmitted: true, [], cancellationToken));
        }

        var questions = await LoadAnswerableQuestionsAsync(survey.Id, db, cancellationToken);
        List<Guid> alreadyAnswered = existing is null
            ? []
            : await db.QuestionResponses
                .Where(qr => qr.ResponseId == existing.Id)
                .Select(qr => qr.QuestionId)
                .ToListAsync(cancellationToken);

        var submissions = (request.Answers ?? [])
            .Select(a => new SurveyAnswerSubmission(a.QuestionId, a.Value, a.Values, a.Text, a.TimeSpentSeconds))
            .ToList();

        var validation = SurveyAnswerValidation.Validate(questions, submissions, request.IsComplete, alreadyAnswered);
        if (validation.Error is not null)
        {
            return Results.Json(new { message = validation.Error }, statusCode: 400);
        }

        // Checked before a response row exists rather than at completion: a respondent who
        // has already started is finishing, and turning them away at the last question
        // discards work they cannot redo.
        if (existing is null && survey.Settings.ResponseLimit is int limit && survey.ResponseCount >= limit)
        {
            return Results.Json(new { message = "This survey has reached its response limit" }, statusCode: 400);
        }

        var language = SurveyContent.ResolveRequestLocale(request.Language, survey.Language);
        var now = DateTimeOffset.UtcNow;

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var response = existing;
        if (response is null)
        {
            response = new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                CompanyId = survey.CompanyId,
                UserId = respondent.StoredUserId,
                SessionId = string.IsNullOrEmpty(sessionId) ? Guid.NewGuid().ToString("N") : sessionId,
                DepartmentId = null,
                Language = language,
                IsAnonymous = respondent.IsAnonymous,
                IsComplete = false,
                StartTime = now,
                // Never recorded for an anonymous response, and there is nothing to fall
                // back to that would be less identifying. See SurveyResponsePrivacy.
                IpAddress = respondent.IsAnonymous ? null : Truncate(httpContext.Connection.RemoteIpAddress?.ToString(), IpAddressMaxLength),
                UserAgent = respondent.IsAnonymous ? null : Truncate(httpContext.Request.Headers.UserAgent.ToString(), UserAgentMaxLength),
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Responses.Add(response);
        }
        else
        {
            // A resumed response keeps the language it was started in unless the
            // respondent switched, which is a thing the language column exists to record.
            response.Language = language;
        }

        await UpsertAnswersAsync(response.Id, validation.Answers, existing is not null, db, cancellationToken);

        IReadOnlyList<string> suppressed = [];
        if (request.IsComplete)
        {
            var capture = await CaptureDemographicsAsync(survey, respondent, db, cancellationToken);
            suppressed = capture.SuppressedFields;

            response.DepartmentId = capture.DepartmentId;
            response.IsComplete = true;
            response.CompletionTime = now;
            response.TotalTimeSeconds = request.TotalTimeSeconds
                ?? (int)Math.Max(0, Math.Round((now - response.StartTime).TotalSeconds));

            foreach (var demographic in capture.Kept)
            {
                db.ResponseDemographics.Add(new ResponseDemographic
                {
                    ResponseId = response.Id,
                    Field = demographic.Field,
                    // response_demographics.value is jsonb, exactly like
                    // question_responses.response_value. A bare string is not JSON and
                    // Postgres rejects it with 22P02.
                    Value = JsonSerializer.Serialize(demographic.Value),
                });
            }
        }

        response.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        if (request.IsComplete)
        {
            // A SQL-level increment rather than a read-modify-write on the tracked entity.
            // surveys has no concurrency token, so two respondents finishing in the same
            // instant would otherwise both write count+1 and one response would vanish
            // from the total while its rows sat in the table -- a discrepancy that looks
            // exactly like a bug in the aggregation.
            await db.Surveys
                .Where(s => s.Id == survey.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ResponseCount, x => x.ResponseCount + 1), cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        var result = await ToResultAsync(response, db, alreadySubmitted: false, suppressed, cancellationToken);
        return existing is null ? Results.Json(result, statusCode: 201) : Results.Ok(result);
    }

    // ------------------------------------------------------------------
    // Persistence helpers
    // ------------------------------------------------------------------

    private const int SessionIdMaxLength = 200;
    private const int IpAddressMaxLength = 64;
    private const int UserAgentMaxLength = 500;

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length <= maxLength ? value : value[..maxLength];
    }

    /// <summary>
    /// The response this submission belongs to, if any -- the idempotency key in one place.
    ///
    /// Keyed on the acting USER for an identified survey and on the SESSION for an
    /// anonymous one, and that asymmetry is the point. A user id survives a client that
    /// lost its session between retries, so it is the stronger key wherever it exists; on
    /// an anonymous survey it deliberately does not exist, which leaves the session as the
    /// only thing that can tell a retry from a second person.
    ///
    /// KNOWN GAP, reported rather than papered over: this is a check-then-insert, so two
    /// genuinely simultaneous submissions on the same key can both find nothing and both
    /// insert. The real fix is a unique index on (survey_id, user_id) and
    /// (survey_id, session_id), which is a migration -- and every lane in this wave was
    /// told not to generate one, because they collide irreconcilably in the model
    /// snapshot. Tracked for the migration lane; the window is a few milliseconds wide
    /// and needs a client to fire a retry before its first request has committed.
    /// </summary>
    private static Task<Response?> FindExistingResponseAsync(
        Survey survey,
        Respondent respondent,
        string? sessionId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!respondent.IsAnonymous && respondent.ActingUserId is Guid userId)
        {
            return db.Responses.FirstOrDefaultAsync(
                r => r.SurveyId == survey.Id && r.UserId == userId,
                cancellationToken);
        }

        if (string.IsNullOrEmpty(sessionId))
        {
            return Task.FromResult<Response?>(null);
        }

        return db.Responses.FirstOrDefaultAsync(
            r => r.SurveyId == survey.Id && r.SessionId == sessionId,
            cancellationToken);
    }

    private static async Task UpsertAnswersAsync(
        Guid responseId,
        IReadOnlyList<ValidatedSurveyAnswer> answers,
        bool mayHaveExistingRows,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (answers.Count == 0)
        {
            return;
        }

        // question_responses is keyed (response_id, question_id), so a resumed response
        // that revisits a question must UPDATE. Inserting would violate the primary key
        // and surface as the generic 409 from Program.cs's exception handler -- which
        // reads, to a respondent who simply changed their mind on question 3, as the whole
        // submission having conflicted.
        var existingRows = mayHaveExistingRows
            ? await db.QuestionResponses
                .Where(qr => qr.ResponseId == responseId)
                .ToDictionaryAsync(qr => qr.QuestionId, cancellationToken)
            : new Dictionary<Guid, QuestionResponse>();

        foreach (var answer in answers)
        {
            if (existingRows.TryGetValue(answer.QuestionId, out var row))
            {
                row.ResponseValue = answer.ResponseValue;
                row.ResponseText = answer.ResponseText;
                row.TimeSpentSeconds = answer.TimeSpentSeconds;
                continue;
            }

            db.QuestionResponses.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = answer.QuestionId,
                ResponseValue = answer.ResponseValue,
                ResponseText = answer.ResponseText,
                TimeSpentSeconds = answer.TimeSpentSeconds,
            });
        }
    }

    private sealed record DemographicOutcome(
        Guid? DepartmentId,
        IReadOnlyList<DemographicCandidate> Kept,
        IReadOnlyList<string> SuppressedFields)
    {
        public static readonly DemographicOutcome Nothing = new(null, [], []);
    }

    /// <summary>
    /// The demographics a completed response may carry.
    ///
    /// Captured at COMPLETION rather than at creation, on purpose: an abandoned partial
    /// response then carries no demographic trail at all, and the values recorded are the
    /// ones true at the moment the respondent actually answered.
    /// </summary>
    private static async Task<DemographicOutcome> CaptureDemographicsAsync(
        Survey survey,
        Respondent respondent,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (respondent.ActingUserId is null && respondent.DepartmentId is null)
        {
            // An unauthenticated visitor: nothing is known about them, which is the most
            // private outcome available and needs no suppression to reach.
            return DemographicOutcome.Nothing;
        }

        var departmentHeadcount = 0;
        if (respondent.IsAnonymous && respondent.DepartmentId is Guid departmentId)
        {
            // `DepartmentHeadcount.Population`, not a predicate written out here. This is
            // the most consequential copy of the department headcount in the system -- the
            // anonymity floor decides against it whether a response may carry a department
            // at all -- and it used to be a byte-identical hand-written copy of the shared
            // predicate, which is the state that let the read-side copies drift before
            // #310. The floor and the participation denominator it protects now count one
            // population by construction.
            departmentHeadcount = await DepartmentHeadcount
                .Population(db.Users, survey.CompanyId)
                .CountAsync(u => u.DepartmentId == departmentId, cancellationToken);
        }

        var department = SurveyResponsePrivacy.DepartmentFor(
            respondent.IsAnonymous, respondent.DepartmentId, departmentHeadcount);

        if (respondent.ActingUserId is not Guid respondentId)
        {
            return new DemographicOutcome(department, [], []);
        }

        var mine = await db.UserDemographics
            .Where(ud => ud.UserId == respondentId)
            .Join(
                db.DemographicFields.Where(f => f.CompanyId == survey.CompanyId && f.IsActive),
                ud => ud.DemographicFieldId,
                f => f.Id,
                (ud, f) => new { f.Id, f.Field, ud.Value })
            .ToListAsync(cancellationToken);

        if (mine.Count == 0)
        {
            return new DemographicOutcome(department, [], []);
        }

        var cohortSizes = new Dictionary<(Guid FieldId, string Value), int>();
        if (respondent.IsAnonymous)
        {
            var fieldIds = mine.Select(m => m.Id).Distinct().ToList();
            var rows = await db.UserDemographics
                .Where(ud => fieldIds.Contains(ud.DemographicFieldId))
                .Join(
                    db.Users.Where(u => u.CompanyId == survey.CompanyId && u.IsActive),
                    ud => ud.UserId,
                    u => u.Id,
                    (ud, u) => new { ud.DemographicFieldId, ud.Value })
                .GroupBy(x => new { x.DemographicFieldId, x.Value })
                .Select(g => new { g.Key.DemographicFieldId, g.Key.Value, Count = g.Count() })
                .ToListAsync(cancellationToken);

            foreach (var row in rows)
            {
                cohortSizes[(row.DemographicFieldId, row.Value)] = row.Count;
            }
        }

        var candidates = mine
            .Select(m => new DemographicCandidate(
                m.Field,
                m.Value,
                cohortSizes.GetValueOrDefault((m.Id, m.Value))))
            .ToList();

        var capture = SurveyResponsePrivacy.Filter(respondent.IsAnonymous, candidates);
        return new DemographicOutcome(department, capture.Kept, capture.SuppressedFields);
    }

    // ------------------------------------------------------------------
    // Read shapes
    // ------------------------------------------------------------------

    private static async Task<List<SurveyAnswerableQuestion>> LoadAnswerableQuestionsAsync(
        Guid surveyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var questions = await db.Questions
            .Where(q => q.SurveyId == surveyId)
            .OrderBy(q => q.Order)
            .Select(q => new { q.Id, q.Type, q.Required, q.ScaleMin, q.ScaleMax })
            .ToListAsync(cancellationToken);

        var optionsByQuestion = await SurveyContent.LoadOptionsAsync(
            db, questions.Select(q => q.Id).ToList(), cancellationToken);

        return questions
            .Select(q => new SurveyAnswerableQuestion(
                q.Id,
                q.Type,
                q.Required,
                q.ScaleMin,
                q.ScaleMax,
                optionsByQuestion.TryGetValue(q.Id, out var options)
                    ? options.Select(o => o.Value).ToList()
                    : []))
            .ToList();
    }

    private static async Task<List<SurveyQuestionDto>> LoadQuestionDtosAsync(
        Survey survey,
        ClimateProjectDbContext db,
        string locale,
        List<string> fallbackFields,
        CancellationToken cancellationToken)
    {
        var questions = await db.Questions
            .Where(q => q.SurveyId == survey.Id)
            .OrderBy(q => q.Order)
            .ToListAsync(cancellationToken);

        var optionsByQuestion = await SurveyContent.LoadOptionsAsync(
            db, questions.Select(q => q.Id).ToList(), cancellationToken);

        return questions.Select(question =>
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
    }

    private static async Task<SurveyResponseState> ToResponseStateAsync(
        Response response,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var rows = await db.QuestionResponses
            .Where(qr => qr.ResponseId == response.Id)
            .ToListAsync(cancellationToken);

        var answers = rows
            .Select(row =>
            {
                var (value, values) = SurveyResponseValues.Read(row.ResponseValue);
                return new SurveySavedAnswerDto(row.QuestionId, value, values, row.ResponseText, row.TimeSpentSeconds);
            })
            .ToList();

        return new SurveyResponseState(
            response.Id,
            response.SessionId,
            response.IsComplete,
            response.Language,
            response.StartTime,
            response.CompletionTime,
            answers);
    }

    private static async Task<SurveySubmissionResult> ToResultAsync(
        Response response,
        ClimateProjectDbContext db,
        bool alreadySubmitted,
        IReadOnlyList<string> suppressedDemographics,
        CancellationToken cancellationToken)
    {
        var answered = await db.QuestionResponses.CountAsync(qr => qr.ResponseId == response.Id, cancellationToken);
        var questionCount = await db.Questions.CountAsync(q => q.SurveyId == response.SurveyId, cancellationToken);

        return new SurveySubmissionResult(
            response.Id,
            response.SessionId,
            response.IsComplete,
            response.IsAnonymous,
            alreadySubmitted,
            response.Language,
            answered,
            questionCount,
            suppressedDemographics);
    }

    private static IResult NotFound()
        => Results.Json(new { message = "Survey not found" }, statusCode: 404);

    private static IResult NotAccepting()
        => Results.Json(new { message = "This survey is not currently accepting responses" }, statusCode: 400);

    private static IResult Unavailable()
        => Results.Json(new { message = "This survey is not currently available" }, statusCode: 401);
}
