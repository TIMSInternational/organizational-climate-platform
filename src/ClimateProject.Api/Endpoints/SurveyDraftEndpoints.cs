using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Autosave and recovery for the survey wizard (#105).
///
/// Three decisions worth reading before changing anything here.
///
/// **1. A draft is keyed on (user, session), not on a survey.** <c>SurveyDraft</c> has no
/// <c>survey_id</c> column -- it is the scratchpad for a survey that does not exist yet,
/// which is exactly why losing it hurts: there is nothing else on the server that holds
/// the work. Once <c>POST /surveys</c> has run, the survey itself is the record and the
/// draft is discardable.
///
/// **2. Drafts are private to their author, and a colleague gets 404 rather than 403.**
/// The issue makes privacy explicit; 404 is the stronger reading of it, because 403 on a
/// specific id confirms that id exists and who has been drafting what. There is no
/// company-admin override and no super-admin override: reading a colleague's half-written
/// survey is not a product feature, and the only route with an elevated role
/// (<c>DELETE /surveys/drafts/expired</c>) deletes by expiry and never reads content.
///
/// **3. Concurrency is a conditional UPDATE, not a read-modify-write.** Every save is one
/// statement that increments <c>version</c> and <c>auto_save_count</c> in SQL, optionally
/// guarded by <c>WHERE version = @expected</c>. Two tabs autosaving at once therefore
/// either both apply (last-writer-wins, both counts intact) or the loser gets a 409 with
/// the current state -- never a half-applied row and never a lost increment. The repo's
/// other precedent is <c>UseXminAsMicroclimateConcurrencyToken</c>; <c>version</c> is used
/// here instead because the column already exists and is already meaningful to the
/// client, so the token needs no migration and no hidden system column on the wire.
/// </summary>
public static class SurveyDraftEndpoints
{
    public static void MapSurveyDraftEndpoints(this WebApplication app)
    {
        // Nested under /surveys but its own group: "drafts" is a literal segment and can
        // never parse as /surveys/{id:guid}, so the two groups cannot shadow each other.
        var group = app.MapGroup("/surveys/drafts").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);

        // Recovery's front door. Sits before /{id:guid} for readability only -- "latest"
        // and "expired" never satisfy the guid constraint, so order is not load-bearing.
        group.MapGet("/latest", LatestAsync);
        group.MapDelete("/expired", PurgeExpiredAsync);

        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", SaveAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);
        group.MapPost("/{id:guid}/autosave", AutosaveAsync);
        group.MapPost("/{id:guid}/recover", RecoverAsync);
    }

    // ------------------------------------------------------------------
    // Acting user
    // ------------------------------------------------------------------

    /// <summary>
    /// Drafting a survey is survey-authoring surface, so it takes the same roles as
    /// <c>POST /surveys</c>. An employee has no wizard to autosave from, and letting one
    /// accumulate drafts would be a write path with no matching read feature.
    /// </summary>
    private static bool CanDraft(CurrentUser currentUser) => Roles.Admin.Contains(currentUser.Role);

    private static async Task<(Guid? UserId, IResult? Error)> ResolveAuthorAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanDraft(currentUser))
        {
            return (null, Results.Forbid());
        }

        var userId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        return userId is null ? (null, ActingUserRequired()) : (userId, null);
    }

    /// <summary>
    /// Every draft read, in one place, with the two filters that are never optional: it is
    /// mine, and it has not expired. Expiry is enforced here rather than only by the sweep
    /// so the retention policy holds even if nothing ever runs the sweep.
    /// </summary>
    private static IQueryable<SurveyDraft> Mine(ClimateProjectDbContext db, Guid userId, DateTimeOffset now)
        => db.SurveyDrafts.Where(d => d.UserId == userId && d.ExpiresAt > now);

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    private static async Task<IResult> ListAsync(
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var now = DateTimeOffset.UtcNow;
        var drafts = await Mine(db, userId!.Value, now)
            .OrderByDescending(d => d.UpdatedAt)
            .ThenByDescending(d => d.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return Results.Ok(new SurveyDraftListResponse(drafts.Select(ToSummary).ToList()));
    }

    private static async Task<IResult> LatestAsync(
        string? sessionId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var now = DateTimeOffset.UtcNow;
        var query = Mine(db, userId!.Value, now);

        // Optional, for "restore what THIS tab was doing" rather than "restore whatever I
        // was last doing anywhere".
        if (!string.IsNullOrWhiteSpace(sessionId))
        {
            var trimmed = sessionId.Trim();
            query = query.Where(d => d.SessionId == trimmed);
        }

        // Deliberately NOT filtered on IsRecovered. A draft you recovered on Tuesday and
        // abandoned again is still the draft you want back on Wednesday; IsRecovered is
        // reported so the client can decide whether to re-prompt, not used to hide work.
        var draft = await query
            .OrderByDescending(d => d.UpdatedAt)
            .ThenByDescending(d => d.Id)
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);

        return Results.Ok(new SurveyDraftLatestResponse(draft is null ? null : ToDetail(draft, lang)));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var draft = await Mine(db, userId!.Value, DateTimeOffset.UtcNow)
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);

        return draft is null ? NotFound() : Results.Ok(ToDetail(draft, lang));
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    private static async Task<IResult> CreateAsync(
        CreateSurveyDraftRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        // The draft's company comes off the user's own row rather than the JWT claim, for
        // the same reason /surveys/my does: a token minted before a transfer would
        // otherwise file the draft against the old tenant until it expired.
        var author = await db.Users
            .Where(u => u.Id == userId!.Value)
            .Select(u => new { u.CompanyId })
            .FirstAsync(cancellationToken);

        // survey_drafts.company_id is NOT NULL, but User.CompanyId has been Guid? since
        // #191 and NULL means "outside every tenant" (a global super_admin). Such a user
        // has no company whose surveys they would be drafting, so this is a 400 with a
        // reason rather than an opaque foreign-key 500.
        if (author.CompanyId is not Guid companyId)
        {
            return Results.Json(
                new { message = "A user with no company cannot own a survey draft" },
                statusCode: 400);
        }

        var sessionId = string.IsNullOrWhiteSpace(request.SessionId)
            ? Guid.NewGuid().ToString("N")
            : request.SessionId.Trim();
        if (sessionId.Length > 200)
        {
            return Results.Json(new { message = "SessionId must be 200 characters or fewer" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;

        // Idempotent per session: opening the wizard twice in the same tab must not leave
        // two drafts racing to be "latest". Deliberately a lookup rather than an upsert --
        // there is no unique index on (user_id, session_id) and adding one needs an EF
        // migration, which this wave is not taking. The residual race is two simultaneous
        // creates for one session producing two rows; the consequence is a duplicate, not
        // corruption, and /latest still resolves it deterministically. Noted as follow-up.
        var existing = await Mine(db, userId!.Value, now)
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.SessionId == sessionId, cancellationToken);
        if (existing is not null)
        {
            return Results.Ok(ToDetail(existing, lang));
        }

        var company = await db.Companies
            .Where(c => c.Id == companyId)
            .Select(c => new { c.Settings.Language })
            .FirstOrDefaultAsync(cancellationToken);

        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        // Same default as POST /surveys: the company's own language, so 'both' stays an
        // opt-in rather than something every draft inherits.
        var language = ContentLanguages.NormaliseLanguage(request.Language)
                       ?? ContentLanguages.NormaliseLanguage(company?.Language)
                       ?? ContentLanguages.FallbackLocale;

        var (envelope, envelopeError) = BuildEnvelope(
            SurveyDraftEnvelope.Empty, language, request.Title, request.Description, request.Content);
        if (envelopeError is not null)
        {
            return envelopeError;
        }

        var draft = new SurveyDraft
        {
            Id = Guid.NewGuid(),
            UserId = userId.Value,
            CompanyId = companyId,
            SessionId = sessionId,
            CurrentStep = request.CurrentStep is int step && step > 0 ? step : 1,
            LastEditedField = Trim(request.LastEditedField),
            AutoSaveCount = 0,
            Version = 1,
            LastAutosaveAt = null,
            ExpiresAt = SurveyDraftRetention.ExpiresAt(now),
            IsRecovered = false,
            DraftData = SurveyDraftContent.Serialise(envelope!),
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.SurveyDrafts.Add(draft);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(draft, lang), statusCode: 201);
    }

    // ------------------------------------------------------------------
    // Save / autosave
    // ------------------------------------------------------------------

    private static Task<IResult> SaveAsync(
        Guid id,
        SaveSurveyDraftRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => WriteAsync(id, request, lang, principal, db, isAutosave: false, cancellationToken);

    private static Task<IResult> AutosaveAsync(
        Guid id,
        SaveSurveyDraftRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => WriteAsync(id, request, lang, principal, db, isAutosave: true, cancellationToken);

    /// <summary>
    /// One code path for both writes; the only difference is that an autosave also
    /// advances <c>auto_save_count</c>/<c>last_autosave_at</c>, which is what the
    /// AutosaveIndicator renders. Everything else -- concurrency, i18n, retention -- must
    /// behave identically, and would drift within a month if written twice.
    /// </summary>
    private static async Task<IResult> WriteAsync(
        Guid id,
        SaveSurveyDraftRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        bool isAutosave,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var now = DateTimeOffset.UtcNow;

        // AsNoTracking is not an optimisation here, it is required for correctness: the
        // write below is an ExecuteUpdate that bypasses the change tracker, and a tracked
        // copy of this row would go stale the instant it runs.
        var current = await Mine(db, userId!.Value, now)
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        if (current is null)
        {
            return NotFound();
        }

        var stored = SurveyDraftContent.Parse(current.DraftData);

        if (request.Language is not null && ContentLanguages.NormaliseLanguage(request.Language) is null)
        {
            return InvalidLanguage(request.Language);
        }

        var language = ContentLanguages.NormaliseLanguage(request.Language)
                       ?? stored.Language
                       ?? ContentLanguages.FallbackLocale;

        var (envelope, envelopeError) = BuildEnvelope(
            stored, language, request.Title, request.Description, request.Content);
        if (envelopeError is not null)
        {
            return envelopeError;
        }

        var draftData = SurveyDraftContent.Serialise(envelope!);
        var currentStep = request.CurrentStep is int step && step > 0 ? step : current.CurrentStep;
        var lastEditedField = request.LastEditedField is null ? current.LastEditedField : Trim(request.LastEditedField);
        var expiresAt = SurveyDraftRetention.ExpiresAt(now);

        var query = db.SurveyDrafts.Where(d => d.Id == id && d.UserId == userId.Value && d.ExpiresAt > now);
        if (request.ExpectedVersion is int expectedVersion)
        {
            // The guard is applied in SQL, not by comparing against the row read above.
            // Checking the in-memory copy would leave the classic window between the read
            // and the write in which the other tab commits.
            query = query.Where(d => d.Version == expectedVersion);
        }

        // version and auto_save_count are incremented by the database, from the value the
        // database holds -- so a concurrent pair of autosaves produces version+2, never a
        // lost increment, whichever order they land in.
        var affected = isAutosave
            ? await query.ExecuteUpdateAsync(
                s => s
                    .SetProperty(d => d.DraftData, draftData)
                    .SetProperty(d => d.CurrentStep, currentStep)
                    .SetProperty(d => d.LastEditedField, lastEditedField)
                    .SetProperty(d => d.Version, d => d.Version + 1)
                    .SetProperty(d => d.AutoSaveCount, d => d.AutoSaveCount + 1)
                    .SetProperty(d => d.LastAutosaveAt, now)
                    .SetProperty(d => d.ExpiresAt, expiresAt)
                    .SetProperty(d => d.UpdatedAt, now),
                cancellationToken)
            : await query.ExecuteUpdateAsync(
                s => s
                    .SetProperty(d => d.DraftData, draftData)
                    .SetProperty(d => d.CurrentStep, currentStep)
                    .SetProperty(d => d.LastEditedField, lastEditedField)
                    .SetProperty(d => d.Version, d => d.Version + 1)
                    .SetProperty(d => d.ExpiresAt, expiresAt)
                    .SetProperty(d => d.UpdatedAt, now),
                cancellationToken);

        if (affected == 0)
        {
            // The row was there a moment ago and is not now, or its version moved. Re-read
            // to tell the caller which, and to hand the conflict body the state that
            // actually won rather than the stale one.
            var latest = await Mine(db, userId.Value, now)
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
            if (latest is null)
            {
                return NotFound();
            }

            return Results.Json(
                new SurveyDraftConflict(
                    $"This draft has moved on since version {request.ExpectedVersion}; it is now at version {latest.Version}.",
                    ToDetail(latest, lang)),
                statusCode: 409);
        }

        // Read back rather than reconstructing: without an ExpectedVersion the update was
        // unconditional, so the resulting version is whatever the database ended up at,
        // not necessarily the one this request would have predicted.
        var saved = await db.SurveyDrafts
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);

        return saved is null ? NotFound() : Results.Ok(ToDetail(saved, lang));
    }

    // ------------------------------------------------------------------
    // Recovery
    // ------------------------------------------------------------------

    /// <summary>
    /// The point of the whole feature. Returns the full draft state -- opaque wizard
    /// content included -- and records that it was recovered.
    ///
    /// Deliberately does NOT bump <c>version</c>: recovery changes no content, and
    /// invalidating the caller's concurrency token at the exact moment they are about to
    /// resume editing would make the first autosave after every recovery a spurious 409.
    /// </summary>
    private static async Task<IResult> RecoverAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var now = DateTimeOffset.UtcNow;
        var expiresAt = SurveyDraftRetention.ExpiresAt(now);

        var affected = await db.SurveyDrafts
            .Where(d => d.Id == id && d.UserId == userId!.Value && d.ExpiresAt > now)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(d => d.IsRecovered, true)
                    .SetProperty(d => d.ExpiresAt, expiresAt)
                    .SetProperty(d => d.UpdatedAt, now),
                cancellationToken);
        if (affected == 0)
        {
            return NotFound();
        }

        var draft = await db.SurveyDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        return draft is null ? NotFound() : Results.Ok(ToDetail(draft, lang));
    }

    // ------------------------------------------------------------------
    // Delete / retention
    // ------------------------------------------------------------------

    private static async Task<IResult> DeleteAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (userId, error) = await ResolveAuthorAsync(principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var now = DateTimeOffset.UtcNow;
        var affected = await db.SurveyDrafts
            .Where(d => d.Id == id && d.UserId == userId!.Value && d.ExpiresAt > now)
            .ExecuteDeleteAsync(cancellationToken);

        return affected == 0 ? NotFound() : Results.NoContent();
    }

    /// <summary>
    /// The retention sweep: reclaims rows the read filters already hide.
    ///
    /// SuperAdmin-only because it crosses every tenant, and safe to call at any cadence --
    /// it deletes strictly by <c>expires_at</c> and every save pushes that out, so it can
    /// never take a draft someone is working on. It reads no draft content, which is what
    /// keeps it compatible with drafts being private to their author.
    /// </summary>
    private static async Task<IResult> PurgeExpiredAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var now = DateTimeOffset.UtcNow;
        var deleted = await db.SurveyDrafts
            .Where(d => d.ExpiresAt <= now)
            .ExecuteDeleteAsync(cancellationToken);

        return Results.Ok(new PurgeExpiredDraftsResponse(deleted));
    }

    // ------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------

    private static (SurveyDraftEnvelope? Envelope, IResult? Error) BuildEnvelope(
        SurveyDraftEnvelope stored,
        string language,
        LocalizedInput? title,
        LocalizedInput? description,
        JsonElement? content)
    {
        string? titleEn = null;
        string? titleEs = null;
        if (title is not null && !title.TryResolve(language, "title", out titleEn, out titleEs, out var titleError))
        {
            // A bare string against a 'both' draft lands here, on purpose: filing
            // unlabelled text into one language column is the silent content-mangling the
            // paired storage exists to prevent, and a draft is content too.
            return (null, Results.Json(new { message = titleError }, statusCode: 400));
        }

        string? descriptionEn = null;
        string? descriptionEs = null;
        if (description is not null
            && !description.TryResolve(language, "description", out descriptionEn, out descriptionEs, out var descriptionError))
        {
            return (null, Results.Json(new { message = descriptionError }, statusCode: 400));
        }

        return (
            SurveyDraftContent.Merge(stored, language, titleEn, titleEs, descriptionEn, descriptionEs, content),
            null);
    }

    private static SurveyDraftSummary ToSummary(SurveyDraft draft)
    {
        var envelope = SurveyDraftContent.Parse(draft.DraftData);
        var resolved = SurveyDraftContent.Resolve(envelope, lang: null);

        return new SurveyDraftSummary(
            draft.Id,
            draft.SessionId,
            resolved.Title,
            envelope.Language ?? ContentLanguages.FallbackLocale,
            resolved.ResolvedLocale,
            draft.CurrentStep,
            draft.LastEditedField,
            draft.Version,
            draft.AutoSaveCount,
            draft.IsRecovered,
            draft.LastAutosaveAt,
            draft.ExpiresAt,
            draft.CreatedAt,
            draft.UpdatedAt);
    }

    private static SurveyDraftDetail ToDetail(SurveyDraft draft, string? lang)
    {
        var envelope = SurveyDraftContent.Parse(draft.DraftData);
        var resolved = SurveyDraftContent.Resolve(envelope, lang);
        var missing = SurveyDraftContent.MissingTranslations(envelope);

        return new SurveyDraftDetail(
            draft.Id,
            draft.SessionId,
            draft.CompanyId,
            resolved.Title,
            resolved.Description,
            envelope.Language ?? ContentLanguages.FallbackLocale,
            resolved.ResolvedLocale,
            resolved.FallbackFields,
            missing,
            missing.Count == 0,
            envelope.Content,
            draft.CurrentStep,
            draft.LastEditedField,
            draft.Version,
            draft.AutoSaveCount,
            draft.IsRecovered,
            draft.LastAutosaveAt,
            draft.ExpiresAt,
            draft.CreatedAt,
            draft.UpdatedAt);
    }

    private static string? Trim(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // Expired, deleted and someone else's are all the same answer on purpose: a distinct
    // 403 for a colleague's draft would confirm the id exists and that they are drafting.
    private static IResult NotFound()
        => Results.Json(new { message = "Survey draft not found" }, statusCode: 404);

    private static IResult ActingUserRequired()
        => Results.Json(new { message = "The authenticated user has no matching user record" }, statusCode: 400);

    private static IResult InvalidLanguage(string? language)
        => Results.Json(
            new { message = $"Invalid language: {language}. Expected one of: {string.Join(", ", ContentLanguages.ValidLanguages)}" },
            statusCode: 400);
}
