using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Survey distribution, invitations and their state tracking (#116) -- replacing legacy
/// <c>surveys/[id]/invitations</c>, <c>surveys/[id]/invitation-settings</c>,
/// <c>surveys/[id]/share</c> and <c>surveys/reminders</c>.
///
/// <para><b>Three authorization rules live in this file and the split is the point.</b></para>
/// <list type="bullet">
/// <item>The <c>/surveys/{id}/...</c> routes are administrative and use
/// <see cref="SurveyEndpoints.CanAdminister"/> unchanged -- SuperAdmin, or CompanyAdmin whose
/// claim matches the survey's company. Never a bare company match: that would let any
/// employee mail their whole company.</item>
/// <item>The <c>/survey-invitations/{token}</c> routes are <b>unauthenticated, and the token
/// is the credential</b>. That is not a shortcut. An invitee clicking a link from their mail
/// client is routinely not logged in, and <c>Survey.Settings.InvitationIncludeCredentials</c>
/// exists precisely because some of them do not have credentials to hand. Requiring a login
/// here would defeat the reason the token column exists at all.</item>
/// <item>The <c>/survey-links/{token}</c> route is unauthenticated for the same reason, but
/// its token is <b>not</b> a per-person credential the way an invitation token is: it is one
/// open share link for the whole company. That distinction is what decides which rate-limit
/// policy it gets -- see below.</item>
/// </list>
///
/// <para><b>On the unauthenticated surface, and how it is rate limited (#146).</b> The
/// microclimate route <c>POST /microclimates/{id}/responses</c> <b>allocates rows</b> on an
/// unauthenticated call, which is why it has a per-caller limiter. Every write below stamps a
/// timestamp or bumps a counter on <b>one already-existing row</b>, addressed by a 256-bit
/// token, and is strictly monotonic -- so there is no amplification here and no row to flood
/// with, and a per-caller limiter would indeed mostly throttle an office NAT opening its mail.
/// The limiter these routes carry is therefore not a per-caller one: the
/// <c>/survey-invitations/{token}</c> routes and <c>/invitations/{token}/accept</c> take
/// <c>RateLimitPolicies.PublicToken</c>, which buckets by the token, because the risk on a
/// route whose credential is in its URL is that <i>one</i> token is replayed or brute-forced
/// from many addresses. One full bucket can only inconvenience the one invitee it names.</para>
///
/// <para><b><c>/survey-links/{token}</c> is the exception and takes the opposite policy.</b>
/// That token is one company-wide share link, not a person's credential -- one
/// <c>survey_distributions.PublicUrl</c> per survey, handed to everybody by
/// <c>ShareLinkPanel</c>. Bucketing it by the token would make a company's own respondents
/// compete for one bucket and would let anyone holding the (deliberately public) URL keep the
/// survey closed for that company. It takes <c>RateLimitPolicies.PublicLink</c>, keyed by
/// caller.</para>
///
/// <para><b>Where the notification seam is (#100).</b> Nothing in this file sends anything.
/// Inviting and reminding <b>persist <c>notifications</c> rows and stop</b>; delivery is
/// <c>POST /notifications/process</c> and, once it lands, the <c>ClimateProject.Workers</c>
/// sweep of #101. Three consequences, all deliberate:
/// <list type="bullet">
/// <item>Recipient consent (<c>NotificationDispatchPolicy</c>) is evaluated at <i>delivery</i>
/// time by the existing dispatcher, so an invitee who opts out between being invited and the
/// sweep running is honoured. Deciding it here would have frozen the wrong answer.</item>
/// <item>Reminders need no scheduler of their own -- which is the whole of "reminders dispatch
/// through #101, not a new scheduler".</item>
/// <item><b>The notification row does NOT carry the invitation token.</b> Its <c>Data</c> blob
/// carries <c>surveyId</c> and <c>surveyInvitationId</c> only, and the sender resolves the
/// token from <c>survey_invitations</c> when it actually builds the mail. Otherwise every
/// token would be readable through <c>GET /notifications?companyId=</c>, which any
/// CompanyAdmin can call. What that would hand them is <b>invitation-state tampering, not
/// impersonation</b>: a token holder can mark a non-anonymous survey's invitation
/// <c>completed</c>, which is irreversible, answers the real invitee's own link with a 409,
/// and falsifies the response rate. Answering is a separate surface that never consults the
/// token at all. (This wording used to claim impersonation; it was wrong, and
/// <c>ISurveyInvitationTokens</c> carries the checked version.) It also makes revocation real:
/// a token revoked between queueing and sending is gone by the time the sender looks it
/// up.</item>
/// </list></para>
/// </summary>
public static class SurveyDistributionEndpoints
{
    /// <summary>Users one invitation batch will mint for. Bounded because the batch is built in memory and saved in one transaction, matching <c>NotificationEndpoints</c>' bulk cap.</summary>
    private const int MaxInvitationBatch = 500;

    /// <summary>Invitations one listing returns. Same bound and same reason as the notification listings.</summary>
    private const int MaxInvitationPageSize = 500;

    private const int NotificationTitleMaxLength = 500;

    public static void MapSurveyDistributionEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/surveys").RequireAuthorization();

        // Neither literal can shadow SurveyEndpoints' /{id:guid} routes -- the guid
        // constraint means "distribution" and "invitations" never parse as an id, and the
        // segment after it is a distinct literal in every case.
        admin.MapGet("/{surveyId:guid}/distribution", GetDistributionAsync);
        admin.MapPut("/{surveyId:guid}/distribution", UpsertDistributionAsync);
        admin.MapPost("/{surveyId:guid}/distribution/link/regenerate", RegenerateLinkAsync);
        admin.MapPost("/{surveyId:guid}/distribution/link/revoke", RevokeLinkAsync);

        admin.MapGet("/{surveyId:guid}/invitations", ListInvitationsAsync);
        admin.MapPost("/{surveyId:guid}/invitations", CreateInvitationsAsync);
        admin.MapPost("/{surveyId:guid}/invitations/reminders", SendRemindersAsync);
        admin.MapPost("/{surveyId:guid}/invitations/{invitationId:guid}/resend", ResendInvitationAsync);
        admin.MapPost("/{surveyId:guid}/invitations/{invitationId:guid}/revoke", RevokeInvitationAsync);

        // Token-addressed and unauthenticated -- see the class remarks. The three state
        // routes mirror the legacy shape (#130) but share one handler, so the monotonic rule
        // and the anonymity ceiling cannot be applied to two of them and forgotten on the third.
        //
        // Rate limited per token (#146). On these four routes the token IS one invitee's
        // credential, so the bucket has to be the token, not the caller -- otherwise one
        // invitation can be replayed from as many addresses as an attacker has. The share
        // link below is the opposite case; see the class remarks.
        var byToken = app.MapGroup("/survey-invitations")
            .RequireRateLimiting(RateLimitPolicies.PublicToken);
        byToken.MapGet("/{token}", ValidateInvitationTokenAsync);
        byToken.MapPost("/{token}/opened", (string token, string? lang, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Opened, lang, db, ct));
        byToken.MapPost("/{token}/started", (string token, string? lang, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Started, lang, db, ct));
        byToken.MapPost("/{token}/completed", (string token, string? lang, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Completed, lang, db, ct));

        // Keyed by caller, NOT by the token in the path (#146). One survey has one share link
        // and every respondent uses it, so a token-keyed bucket would be a bucket shared by a
        // whole company -- and a one-line way for anyone holding the public URL to close the
        // survey for all of them. See RateLimitPolicies.PartitionPublicLink.
        app.MapGet("/survey-links/{token}", ResolvePublicLinkAsync)
            .RequireRateLimiting(RateLimitPolicies.PublicLink);
    }

    // ------------------------------------------------------------------
    // Distribution
    // ------------------------------------------------------------------

    private static async Task<IResult> GetDistributionAsync(
        Guid surveyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var distribution = await db.SurveyDistributions
            .FirstOrDefaultAsync(d => d.SurveyId == surveyId, cancellationToken);
        if (distribution is null)
        {
            return Results.Json(new { message = "This survey has no distribution configured yet." }, statusCode: 404);
        }

        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language), db, cancellationToken));
    }

    /// <summary>
    /// Create or update the distribution. One row per survey (the unique index on
    /// <c>survey_id</c> enforces it), so this is an upsert rather than a POST/PUT pair.
    /// </summary>
    private static async Task<IResult> UpsertDistributionAsync(
        Guid surveyId,
        string? lang,
        UpsertSurveyDistributionRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        if (request.AccessType is not null && !SurveyAccessTypes.IsValid(request.AccessType))
        {
            return Results.Json(
                new { message = $"Invalid accessType: {request.AccessType}. Expected one of: {string.Join(", ", SurveyAccessTypes.All)}" },
                statusCode: 400);
        }

        if (ValidateQrCustomization(request.QrCustomization) is { } qrError)
        {
            return Results.Json(new { message = qrError }, statusCode: 400);
        }

        var now = UtcNow();
        var distribution = await db.SurveyDistributions.FirstOrDefaultAsync(d => d.SurveyId == surveyId, cancellationToken);
        var isNew = distribution is null;
        if (distribution is null)
        {
            distribution = new SurveyDistribution
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,

                // QrCodeUrl is NOT NULL, and there is no QR renderer in this repository yet.
                // Storing the URL the QR code *encodes* is the honest value: it is what any
                // renderer would need, it is correct today, and it does not fabricate the
                // path of an image nobody generates. The three qr_code_{svg,png,pdf}_url
                // columns stay NULL until something actually produces those files.
                QrCodeUrl = string.Empty,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.SurveyDistributions.Add(distribution);
        }

        var accessType = request.AccessType ?? distribution.AccessType;

        ApplyAccessRules(distribution.AccessRules, request.AccessRules);
        ApplyQrCustomization(distribution.QrCustomization, request.QrCustomization);

        if (accessType == SurveyAccessTypes.Public)
        {
            if (distribution.PublicUrl is null)
            {
                distribution.PublicUrl = SurveyAccessTokens.PublicLinkPath(SurveyAccessTokens.Mint());
                distribution.TokenizedLinksGenerated += 1;
            }
        }
        else if (distribution.PublicUrl is not null)
        {
            // Switching away from `public` revokes the link rather than leaving it live
            // under an access type that says it does not exist. A share link that keeps
            // working after the setting saying it exists was turned off is the leak the
            // access type was supposed to describe.
            RevokeLink(distribution, actingUserId: null, now);
        }

        distribution.AccessType = accessType;
        distribution.QrCodeUrl = distribution.PublicUrl ?? SurveyPath(surveyId);
        distribution.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        var detail = await ToDistributionDetailAsync(distribution, survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language), db, cancellationToken);
        return isNew ? Results.Json(detail, statusCode: 201) : Results.Ok(detail);
    }

    private static async Task<IResult> RegenerateLinkAsync(
        Guid surveyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var distribution = await db.SurveyDistributions.FirstOrDefaultAsync(d => d.SurveyId == surveyId, cancellationToken);
        if (distribution is null)
        {
            return Results.Json(new { message = "This survey has no distribution configured yet." }, statusCode: 404);
        }

        var now = UtcNow();
        var actingUserId = await ResolveActingUserIdAsync(principal.GetCurrentUser(), db, cancellationToken);

        // Regenerating is the revocation of the old link and the minting of a new one in one
        // step. The old token stops resolving the instant this saves -- that is the point of
        // the operation, and why the two are not separable.
        distribution.PublicUrl = SurveyAccessTokens.PublicLinkPath(SurveyAccessTokens.Mint());
        distribution.AccessType = SurveyAccessTypes.Public;
        distribution.QrCodeUrl = distribution.PublicUrl;
        distribution.TokenizedLinksGenerated += 1;
        distribution.RegeneratedCount += 1;
        distribution.LastRegeneratedAt = now;
        distribution.LastRegeneratedBy = actingUserId;
        distribution.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language), db, cancellationToken));
    }

    private static async Task<IResult> RevokeLinkAsync(
        Guid surveyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var distribution = await db.SurveyDistributions.FirstOrDefaultAsync(d => d.SurveyId == surveyId, cancellationToken);
        if (distribution is null)
        {
            return Results.Json(new { message = "This survey has no distribution configured yet." }, statusCode: 404);
        }

        var now = UtcNow();
        var actingUserId = await ResolveActingUserIdAsync(principal.GetCurrentUser(), db, cancellationToken);

        // Idempotent: revoking an already-revoked link is a no-op, not a 409. A retried
        // "kill this link" must never look like a failure to kill it.
        if (distribution.PublicUrl is not null)
        {
            RevokeLink(distribution, actingUserId, now);
            distribution.AccessType = SurveyAccessTypes.Tokenized;
            distribution.QrCodeUrl = SurveyPath(surveyId);
            distribution.UpdatedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language), db, cancellationToken));
    }

    private static void RevokeLink(SurveyDistribution distribution, Guid? actingUserId, DateTimeOffset now)
    {
        distribution.PublicUrl = null;
        distribution.RegeneratedCount += 1;
        distribution.LastRegeneratedAt = now;
        distribution.LastRegeneratedBy = actingUserId;
    }

    // ------------------------------------------------------------------
    // Invitations -- admin
    // ------------------------------------------------------------------

    private static async Task<IResult> ListInvitationsAsync(
        Guid surveyId,
        string? status,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        if (status is not null && !SurveyInvitationStatuses.IsValid(status))
        {
            return Results.Json(
                new { message = $"Invalid status: {status}. Expected one of: {string.Join(", ", SurveyInvitationStatuses.All)}" },
                statusCode: 400);
        }

        var query = db.SurveyInvitations.AsNoTracking().Where(i => i.SurveyId == surveyId);
        if (status is not null)
        {
            query = query.Where(i => i.Status == status);
        }

        var rows = await query
            .OrderBy(i => i.CreatedAt)
            .Take(MaxInvitationPageSize)
            .ToListAsync(cancellationToken);

        var now = UtcNow();
        var invitations = rows.Select(i => ToInvitationDetail(i, now)).ToList();

        return Results.Ok(new SurveyInvitationListResponse(
            invitations,
            await SummariseAsync(db, surveyId, now, cancellationToken),
            AnonymityOf(survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language))));
    }

    private static async Task<IResult> CreateInvitationsAsync(
        Guid surveyId,
        CreateSurveyInvitationsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        // Inviting people to a draft is inviting them to something whose questions can still
        // be rewritten -- and the invitation carries the survey's title, which is exactly why
        // SurveyStatuses.RespondentVisible is the set that runs the translation gate.
        if (!SurveyStatuses.RespondentVisible.Contains(survey!.Status, StringComparer.Ordinal))
        {
            return Results.Json(
                new
                {
                    message = $"A survey in status '{survey.Status}' cannot be distributed. "
                              + $"Publish it first via PUT /surveys/{{id}}/status ({string.Join(" or ", SurveyStatuses.RespondentVisible)}).",
                },
                statusCode: 409);
        }

        var now = UtcNow();
        if (survey.EndDate <= now)
        {
            return Results.Json(
                new { message = "This survey's response window has already closed; there is nothing to invite anyone to." },
                statusCode: 409);
        }

        var (userIds, audienceError) = await ResolveAudienceAsync(db, survey, request, cancellationToken);
        if (audienceError is not null)
        {
            return audienceError;
        }

        if (userIds!.Count > MaxInvitationBatch)
        {
            return Results.Json(
                new { message = $"This request resolves to {userIds.Count} recipients; the maximum per request is {MaxInvitationBatch}." },
                statusCode: 400);
        }

        // An invitation never outlives its survey. ExpiresInDays can bring the deadline
        // forward and never push it past EndDate: a token that still opens a closed survey is
        // a token with nothing to protect and everything to leak.
        var expiresAt = survey.EndDate;
        if (request.ExpiresInDays is int days)
        {
            if (days < 1)
            {
                return Results.Json(new { message = "ExpiresInDays must be at least 1." }, statusCode: 400);
            }

            var requested = now.AddDays(days);
            if (requested < expiresAt)
            {
                expiresAt = requested;
            }
        }

        var alreadyInvited = await db.SurveyInvitations
            .Where(i => i.SurveyId == surveyId && userIds.Contains(i.UserId))
            .Select(i => i.UserId)
            .ToListAsync(cancellationToken);
        var alreadyInvitedSet = alreadyInvited.ToHashSet();

        var recipients = await db.Users
            .Where(u => userIds.Contains(u.Id))
            .ToListAsync(cancellationToken);

        var created = new List<SurveyInvitation>();
        // Always zero, and a constant rather than a counter. The survey invitation email was
        // DELETED on 2026-10-19 -- there is no longer any code that can compose one, so there
        // is nothing to count. The field stays on the response because callers assert on it:
        // `silence-activate-invite.sh` refuses to continue unless it reads 0, and that
        // assertion is now a tautology instead of a setting that could drift back.
        const int notificationsQueued = 0;
        var undeliverable = 0;

        foreach (var recipient in recipients.Where(u => !alreadyInvitedSet.Contains(u.Id)))
        {
            var invitation = new SurveyInvitation
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                UserId = recipient.Id,
                CompanyId = survey.CompanyId,
                Email = recipient.Email,
                InvitationToken = SurveyAccessTokens.Mint(),
                Status = SurveyInvitationStatuses.Pending,
                ExpiresAt = expiresAt,
                CreatedAt = now,
                UpdatedAt = now,
            };
            created.Add(invitation);
            db.SurveyInvitations.Add(invitation);

            // Counted, not refused. The address cannot receive mail -- .test, .invalid and
            // example.com are reserved by RFC so that no mailbox exists behind them -- and the
            // send path refuses it for that reason. Minting the invitation anyway is
            // deliberate: the row IS the artefact, its link is distributable by hand, and this
            // endpoint already supports a tenant with notificationSendInvitations off that
            // never mails anything. Rejecting the batch would make the seeded demo tenant
            // undistributable by any route.
            //
            // But an admin who queues 500 rows and gets 40 silent permanent failures minutes
            // later has been told nothing, so the count comes back with the response.
            if (UndeliverableAddresses.IsUndeliverable(invitation.Email))
            {
                undeliverable++;
            }

            // No notification is composed here any more, so the invitation stays `pending`
            // with a null `SentAt` -- which is exactly the state ESPH's rehearsal already ran
            // in and answered from. `pending` does not block completion tracking:
            // `AdvanceInvitationAsync` marks the row completed on an identified survey
            // whatever status it started from.
        }

        await db.SaveChangesAsync(cancellationToken);

        var note = "Invitations were minted and no mail was queued. This platform does not send "
            + "survey invitation email: the only message a respondent ever receives is their "
            + "credentials. Share the survey's link, or ask them to sign in with the credentials "
            + "they already have.";

        if (undeliverable > 0)
        {
            var warning = $"{undeliverable} of the {created.Count} invitations just created are addressed to a reserved "
                + "domain (.test, .invalid, .example, .localhost, example.com/.net/.org) that can never receive mail. "
                + "No mail will be sent to those addresses and they will show as failed; fix the addresses on those "
                + "accounts and use the resend route.";
            note = note is null ? warning : $"{note} {warning}";
        }

        return Results.Json(
            new SurveyInvitationBatchResult(
                userIds.Count,
                created.Count,
                created.Select(i => i.Id).ToList(),
                alreadyInvited,
                notificationsQueued,
                undeliverable,
                note),
            statusCode: 201);
    }

    /// <summary>
    /// Queue a reminder for every outstanding invitation whose cadence has elapsed.
    ///
    /// <para><b>Idempotency lives in the data, not in a lock.</b> An invitation reminded less
    /// than <c>NotificationReminderFrequencyDays</c> ago is skipped, so calling this twice in
    /// a row queues nothing the second time -- which is the property #101's worker needs from
    /// a job that may tick while a previous tick is still in flight, and it is a property of
    /// the row rather than of who called.</para>
    ///
    /// <para><b>On anonymous surveys.</b> Outstanding means "has not reached a state we
    /// recorded", and for an anonymous survey we deliberately never record that anyone
    /// answered. So its reminders go to every invitee who has not been reminded recently,
    /// including people who have already responded. That is the cost of the guarantee and it
    /// is the right way round: the alternative is recording who answered, which is the one
    /// thing an anonymous survey promises not to do. The reminder copy should therefore read
    /// as "if you have not yet responded", and that is a template concern (#100).</para>
    /// </summary>
    private static async Task<IResult> SendRemindersAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        if (!survey!.Settings.NotificationSendReminders)
        {
            // 409 rather than a 200 with a zero count: an admin who explicitly asked for
            // reminders and silently got none would conclude the feature is broken.
            return Results.Json(
                new { message = "This survey has notificationSendReminders turned off. Turn it on before sending reminders." },
                statusCode: 409);
        }

        if (!SurveyStatuses.AcceptsResponses(survey.Status))
        {
            return Results.Json(
                new { message = $"A survey in status '{survey.Status}' is not collecting responses; there is nothing to remind anyone about." },
                statusCode: 409);
        }

        // THE REMINDER EMAIL NO LONGER EXISTS either. It was the second of the two messages
        // ruled out on 2026-10-19 -- "the other ones that we received, like as a reminder ...
        // we never want to send that."
        //
        // Answered 200 with zeroes rather than 410, because this route is polled by the
        // Distribucion screen to show how many reminders are owed, and the honest answer to
        // that question is now permanently none. Nothing is loaded and nothing is written.
        //
        // Belt as well as braces: even if this body came back, it only ever reminded
        // invitations whose status was sent/opened/started, and no invitation can reach
        // `sent` any more -- the one producer of that status was the invitation mail.
        return await Task.FromResult(Results.Ok(new SurveyReminderResult(0, 0, 0, null)));
    }

    /// <summary>
    /// Rotate one invitation's token and queue it again -- the survey equivalent of
    /// <c>InvitationEndpoints.ResendAsync</c>, and the supported way to revive an expired or
    /// revoked invitation. The old token dies with the rotation, which is what makes this
    /// safe to offer for a revoked one.
    /// </summary>
    private static async Task<IResult> ResendInvitationAsync(
        Guid surveyId,
        Guid invitationId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var invitation = await db.SurveyInvitations
            .FirstOrDefaultAsync(i => i.Id == invitationId && i.SurveyId == surveyId, cancellationToken);
        if (invitation is null)
        {
            return InvitationNotFound();
        }

        if (invitation.Status == SurveyInvitationStatuses.Completed)
        {
            return Results.Json(new { message = "This invitation has already been completed." }, statusCode: 409);
        }

        var now = UtcNow();
        if (survey!.EndDate <= now || !SurveyStatuses.RespondentVisible.Contains(survey.Status, StringComparer.Ordinal))
        {
            return Results.Json(
                new { message = "This survey is no longer distributable; its window has closed or it is not published." },
                statusCode: 409);
        }

        var recipient = await db.Users.FirstOrDefaultAsync(u => u.Id == invitation.UserId, cancellationToken);
        if (recipient is null)
        {
            return Results.Json(new { message = "The invited user no longer exists." }, statusCode: 409);
        }

        // THE SURVEY INVITATION EMAIL NO LONGER EXISTS. Ruled 2026-10-19: "delete this email
        // completely, as if it never existed ... the one with the username and password is the
        // ONLY one the application will be sending out."
        //
        // 410 and not 409. A 409 said "turn the setting on and try again", and there is no
        // setting to turn on any more -- the composer is gone. Refused BEFORE the token is
        // re-minted, because rotating it would kill the live link and deliver nothing in its
        // place, which is the worst of both.
        //
        // The checks above still run first, so an administrator pressing "Reenviar" on a
        // completed invitation or a closed survey still gets the specific answer rather than
        // this one.
        return await Task.FromResult(Results.Json(
            new
            {
                message = "This platform does not send survey invitation email. The only message a "
                    + "respondent is ever sent is their credentials. Share the survey's link, or ask "
                    + "them to sign in with the credentials they already have.",
            },
            statusCode: 410));
    }

    /// <summary>
    /// Revoke one invitation -- and with it the mail that has not gone out yet.
    ///
    /// <para><b>Why the notification is cancelled here rather than skipped by the sweep.</b>
    /// Both would stop the mail. Cancelling here was chosen for four reasons.</para>
    /// <list type="number">
    /// <item>It is one decision at one moment. The revoke is the event; "and therefore this
    /// queued message must not go" is its consequence, recorded in the same transaction as
    /// the status flip. A sweep-side skip re-derives that consequence on every tick from state
    /// that has to be re-read each time, and leaves the row <c>pending</c> in the meantime --
    /// so <c>GET /notifications?status=pending</c> keeps listing a message nobody will ever
    /// receive.</item>
    /// <item>It keeps the cost where it belongs. <c>NotificationDelivery.ProcessDueAsync</c>
    /// documents that it issues no per-notification query; teaching it revocation would mean
    /// either a join onto <c>survey_invitations</c> for every sweep of every type, or a
    /// per-row lookup, to catch a condition that arises when an administrator clicks revoke.
    /// One query per revoke is strictly cheaper than one per swept row forever.</item>
    /// <item>The sender <i>cannot</i> express it without widening a seam that exists to stay
    /// narrow. <c>ISurveyInvitationTokens.LiveTokenAsync</c> returns null for four different
    /// facts -- revoked, deleted, not this recipient's, no token -- deliberately collapsed
    /// because from the recipient's side they are one fact. Only one of the four should
    /// suppress the message; separating them again means either a second lookup or a
    /// survey-shaped result type on the channel-agnostic <c>INotificationSender</c> contract.</item>
    /// <item><c>cancelled</c> is already the vocabulary for exactly this. The dispatch path
    /// uses it for "nothing broke, this must not go" when a recipient has opted out, and it
    /// is not in <see cref="NotificationStatuses.Retryable"/>, so no sweep -- this tick, the
    /// next one, or another instance -- picks the row up again.</item>
    /// </list>
    ///
    /// <para><b>The cancellation runs even when the invitation was already revoked.</b> The
    /// status flip is idempotent and skipping the sweep on a repeat call would be free, but a
    /// row revoked before this behaviour existed still has its live <c>pending</c>
    /// notification, and a second revoke is the only thing an administrator can do about it.
    /// Idempotent in effect, not merely in status.</para>
    ///
    /// <para><b>What this does not close, stated rather than implied.</b> Cancelling at the
    /// revoke stops every message queued before it and can, by construction, do nothing about one
    /// queued after -- and both reminder producers read their candidates well before they insert.
    /// <c>InvitationReminderJob.RunAsync</c> reads the survey sweep's candidates, then runs the
    /// microclimate sweep, then saves; <c>SendRemindersAsync</c> reads and then saves inside one
    /// request. Neither read sees a revoke that commits afterwards, and <c>survey_invitations</c>
    /// carries no concurrency token, so the insert is not aborted by one either. A revoke landing
    /// inside that window therefore leaves a <c>survey_reminder</c> queued for an invitation that
    /// is already revoked, and the next delivery sweep mails it without a link. The window is one
    /// sweep wide and needs the revoke to land inside it; the remedy is the paragraph above --
    /// revoke again, which is why the cancellation runs on an already-revoked invitation. Closing
    /// it outright means re-deriving the decision at send time, which is the design rejected for
    /// the four reasons above; this is the price of that trade, named here so that "cancelled in
    /// the same transaction" is not read as "no queued message can outlive a revoke".</para>
    ///
    /// <para><b>The distribution link's own revoke is deliberately untouched.</b>
    /// <see cref="RevokeLinkAsync"/> kills <c>survey_distributions.public_url</c>, which this
    /// product never mails: the only URL any notification carries is
    /// <c>/survey-invitations/{token}</c>, built by <c>EmailNotificationSender</c> from a
    /// <c>survey_invitations</c> row named by <see cref="SurveyNotificationData"/>. There is no
    /// queued message that becomes wrong when the share link dies, so there is nothing to
    /// cancel -- and cancelling a whole survey's invitation mail because its public link was
    /// withdrawn would un-invite everybody over an unrelated decision.</para>
    /// </summary>
    private static async Task<IResult> RevokeInvitationAsync(
        Guid surveyId,
        Guid invitationId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (_, error) = await LoadAdministrableSurveyAsync(surveyId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var invitation = await db.SurveyInvitations
            .FirstOrDefaultAsync(i => i.Id == invitationId && i.SurveyId == surveyId, cancellationToken);
        if (invitation is null)
        {
            return InvitationNotFound();
        }

        var now = UtcNow();
        var wasLive = invitation.Status != SurveyInvitationStatuses.Revoked;
        if (wasLive)
        {
            invitation.Status = SurveyInvitationStatuses.Revoked;

            // Belt and braces. Status alone is enough -- every token lookup checks it first,
            // and checks it BEFORE expiry so the holder is told "revoked" and not "expired".
            // Expiring the row too means a future code path that forgets the status check
            // still fails closed rather than honouring a revoked token.
            invitation.ExpiresAt = now;
            invitation.UpdatedAt = now;
        }

        var cancelled = CancelUnsentMail(
            await UnsentMailForAsync(invitation, db, cancellationToken), now);

        if (wasLive || cancelled > 0)
        {
            // One SaveChanges, so one transaction: an invitation is never left revoked with
            // its mail still deliverable, and mail is never cancelled for an invitation whose
            // revoke did not land.
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToInvitationDetail(invitation, now));
    }

    /// <summary>
    /// Every notification queued about <paramref name="invitation"/> that a delivery sweep
    /// could still mail.
    ///
    /// <para><b>Which rows the database is asked for.</b> The recipient and the tenant are the
    /// same pair <c>ISurveyInvitationTokens.LiveTokenAsync</c> scopes on, and for the same
    /// reason -- a notification about this invitation is by construction addressed to its
    /// invitee inside its own company, so anything else is not this invitation's mail whatever
    /// its payload claims. The type filter is
    /// <see cref="SurveyNotificationData.LinkCarryingTypes"/> rather than a pair of literals,
    /// so it cannot drift from the set the sender resolves a link for.</para>
    ///
    /// <para><b>Which rows are excluded, and why each is deliberate.</b> <c>sent</c>,
    /// <c>delivered</c> and <c>opened</c> have gone -- the message is in somebody's mailbox and
    /// no status written afterwards recalls it, so rewriting the row would only make the record
    /// disagree with what happened. <c>cancelled</c> is already the target state. A
    /// <c>failed</c> row that has exhausted its retries is a dead letter: it will never be
    /// attempted again, so cancelling it stops nothing and would quietly drop it out of
    /// <c>GET /notifications?status=failed</c>, erasing the fact that delivery was tried and
    /// did not work. A <c>failed</c> row with budget left is the one that matters and is
    /// included: the sweep WILL come back for it.</para>
    ///
    /// <para><b>Why the payload is matched in memory.</b> <c>data</c> is jsonb holding a string
    /// id, and the question this has to answer is not "does this blob contain these bytes" but
    /// "would the sender resolve this row to this invitation" --
    /// <see cref="SurveyNotificationData.InvitationIdOrNull"/> is the function that decides
    /// that, and a hand-written containment predicate would be a second, differently-behaved
    /// answer to it (a <c>Guid</c> written in braces or upper case parses there and would not
    /// match there). The candidate set is one invitee's undelivered survey mail, and a revoke
    /// is an administrator's click rather than a hot path -- and it is not a scan either: the
    /// <c>(user_id, status, created_at)</c> index on <c>notifications</c> covers the two
    /// columns this narrows on hardest.</para>
    /// </summary>
    private static async Task<List<Notification>> UnsentMailForAsync(
        SurveyInvitation invitation,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var candidates = await db.Notifications
            .Where(n => n.UserId == invitation.UserId
                        && n.CompanyId == invitation.CompanyId
                        && SurveyNotificationData.LinkCarryingTypes.Contains(n.Type)
                        && (n.Status == NotificationStatuses.Pending
                            || (n.Status == NotificationStatuses.Failed && n.RetryCount < n.MaxRetries)))
            .ToListAsync(cancellationToken);

        return [.. candidates.Where(n => SurveyNotificationData.InvitationIdOrNull(n.Data) == invitation.Id)];
    }

    /// <summary>
    /// Mark queued mail as deliberately not going. Tracked entities, mutated but not saved:
    /// the caller owns the transaction.
    /// </summary>
    private static int CancelUnsentMail(List<Notification> unsent, DateTimeOffset now)
    {
        foreach (var notification in unsent)
        {
            // "cancelled", never "failed" -- the same distinction NotificationDelivery draws
            // when a recipient has opted out. Nothing broke; a decision was taken. FailedAt is
            // deliberately left alone: a row that failed once on its way here keeps the
            // timestamp of that failure, and a row that never failed does not acquire one.
            notification.Status = NotificationStatuses.Cancelled;
            notification.FailureReason = RevokedSuppressionReason;
            notification.UpdatedAt = now;
        }

        return unsent.Count;
    }

    /// <summary>
    /// What <c>failure_reason</c> says on a message cancelled by a revoke. Read by a human
    /// through <c>GET /notifications</c>, so it explains rather than names a code -- and it is
    /// well inside the column's width, so nothing here truncates.
    /// </summary>
    private const string RevokedSuppressionReason =
        "The survey invitation this message was about was revoked before it was sent.";

    // ------------------------------------------------------------------
    // Invitations -- by token, unauthenticated
    // ------------------------------------------------------------------

    private static async Task<IResult> ValidateInvitationTokenAsync(
        string token,
        string? lang,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (invitation, survey, error) = await LoadByTokenAsync(token, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        // Distinct from expired and from revoked, and deliberately not a 200: the client has
        // to render "you already answered this" rather than an answerable survey.
        if (invitation!.Status == SurveyInvitationStatuses.Completed)
        {
            return Results.Json(
                new { message = "This invitation has already been used.", reason = "already_completed" },
                statusCode: 409);
        }

        var locale = SurveyContent.ResolveRequestLocale(lang, survey!.Language);
        var fallbackFields = new List<string>();
        var title = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "surveyTitle", fallbackFields);
        var description = SurveyContent.Resolve(survey.DescriptionEn, survey.DescriptionEs, locale, survey.Language, "surveyDescription", fallbackFields);

        return Results.Ok(new SurveyInvitationTokenDetail(
            invitation.Id,
            survey.Id,
            title,
            description,
            survey.Language,
            ResolvedLocaleOf(survey, locale),
            fallbackFields,
            invitation.Status,
            survey.StartDate,
            survey.EndDate,
            invitation.ExpiresAt,
            AnonymityOf(survey, locale)));
    }

    /// <summary>
    /// Record one forward step on the invitation ladder.
    ///
    /// The single implementation behind <c>/opened</c>, <c>/started</c> and
    /// <c>/completed</c>. Two rules apply and both return 200 with an explanation rather than
    /// an error, because neither is the caller's fault:
    /// <list type="number">
    /// <item>The step is not forward progress (a replayed ping, or an out-of-order one).
    /// Nothing is written and the recorded timestamp does not move.</item>
    /// <item>The survey is anonymous and the step is past
    /// <see cref="SurveyInvitationStatuses.AnonymityCeiling"/>. Nothing is written, and the
    /// response says so -- a suppressed write reported as a successful one would be the lie
    /// the whole guarantee is built to avoid.</item>
    /// </list>
    /// </summary>
    private static async Task<IResult> RecordStateAsync(
        string token,
        string targetState,
        string? lang,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (invitation, survey, error) = await LoadByTokenAsync(token, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var anonymity = AnonymityOf(survey!, SurveyContent.ResolveRequestLocale(lang, survey!.Language));
        var anonymous = survey!.Settings.Anonymous;

        if (!SurveyInvitationStatuses.IsRecordable(targetState, anonymous))
        {
            return Results.Ok(new SurveyInvitationStateResult(
                invitation!.Id,
                invitation.Status,
                Recorded: false,
                SuppressedForAnonymity: true,
                $"This survey is anonymous, so '{targetState}' is not recorded against an individual invitation. "
                + $"Tracking stops at '{SurveyInvitationStatuses.AnonymityCeiling}'; completion is only ever counted in aggregate.",
                anonymity));
        }

        if (!SurveyInvitationStatuses.Advances(invitation!.Status, targetState))
        {
            return Results.Ok(new SurveyInvitationStateResult(
                invitation.Id,
                invitation.Status,
                Recorded: false,
                SuppressedForAnonymity: false,
                $"This invitation is already at '{invitation.Status}'; '{targetState}' is not forward progress.",
                anonymity));
        }

        var now = UtcNow();
        switch (targetState)
        {
            case SurveyInvitationStatuses.Opened:
                invitation.OpenedAt ??= now;
                invitation.UpdatedAt = now;
                break;

            // Ruled 2026-10-12: a named invitee's tracking keeps only the DAY they finished.
            // `started` advances the status and records no time at all; `completed` records
            // the company-local day. Neither stamps UpdatedAt, which on these two transitions
            // would be the same instant under another name.
            case SurveyInvitationStatuses.Started:
                break;
            case SurveyInvitationStatuses.Completed:
                invitation.CompletedOn ??= await CompanyLocalDay.OfAsync(db, survey.CompanyId, now, cancellationToken);
                break;
            default:
                invitation.UpdatedAt = now;
                break;
        }

        invitation.Status = targetState;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new SurveyInvitationStateResult(
            invitation.Id,
            invitation.Status,
            Recorded: true,
            SuppressedForAnonymity: false,
            null,
            anonymity));
    }

    // ------------------------------------------------------------------
    // Public share link -- unauthenticated
    // ------------------------------------------------------------------

    private static async Task<IResult> ResolvePublicLinkAsync(
        string token,
        string? lang,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        // Unknown, revoked and out-of-window all return the same 404, deliberately -- the
        // opposite of the invitation rule above. An invitation token identifies one named
        // person who is entitled to know why their link stopped working; a share link is held
        // by anyone at all, and telling them "this link existed but was revoked" confirms the
        // survey exists to someone who should learn nothing from a dead URL. Same rule #91
        // sets for report public links.
        if (!SurveyAccessTokens.HasExpectedShape(token))
        {
            return LinkNotFound();
        }

        var path = SurveyAccessTokens.PublicLinkPath(token);
        var distribution = await db.SurveyDistributions.AsNoTracking()
            .FirstOrDefaultAsync(d => d.PublicUrl == path, cancellationToken);
        if (distribution is null)
        {
            return LinkNotFound();
        }

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == distribution.SurveyId, cancellationToken);
        if (survey is null)
        {
            return LinkNotFound();
        }

        var now = UtcNow();
        var withinWindow = survey.StartDate <= now && now < survey.EndDate;
        if (!SurveyStatuses.AcceptsResponses(survey.Status)
            || (!withinWindow && !distribution.AccessRules.ActiveOutsideSchedule))
        {
            return LinkNotFound();
        }

        // Atomic in SQL rather than read-modify-write. A share link is by definition hit
        // concurrently, and a read-modify-write counter under concurrency simply loses counts.
        // UniqueVisitors is deliberately left alone: counting distinct visitors of an
        // anonymous link means fingerprinting them, which is not a trade this surface makes.
        await db.SurveyDistributions
            .Where(d => d.Id == distribution.Id)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(d => d.TotalAccesses, d => d.TotalAccesses + 1)
                    .SetProperty(d => d.LastAccessedAt, now),
                cancellationToken);

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();
        var title = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "surveyTitle", fallbackFields);
        var description = SurveyContent.Resolve(survey.DescriptionEn, survey.DescriptionEs, locale, survey.Language, "surveyDescription", fallbackFields);

        // Whose survey it is. One projection of two columns, not the Company entity: this
        // response is served to anyone holding the URL, so what it can carry is chosen here
        // rather than trimmed later.
        var brand = await db.Companies.AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new { c.Name, c.Branding.LogoUrl })
            .FirstOrDefaultAsync(cancellationToken);

        return Results.Ok(new SurveyPublicLinkDetail(
            survey.Id,
            title,
            description,
            survey.Language,
            ResolvedLocaleOf(survey, locale),
            fallbackFields,
            survey.StartDate,
            survey.EndDate,
            distribution.AccessRules.RequireLogin,
            distribution.AccessRules.AllowAnonymous,
            distribution.AccessRules.SingleResponse,
            brand?.Name,
            brand?.LogoUrl));
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    private static async Task<(Survey? Survey, IResult? Error)> LoadAdministrableSurveyAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return (null, Results.Json(new { message = "Survey not found" }, statusCode: 404));
        }

        return SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId)
            ? (survey, null)
            : (null, Results.Forbid());
    }

    /// <summary>
    /// Resolve an invitation token to its invitation and survey, distinguishing the three
    /// dead-token cases the issue asks be kept distinct.
    ///
    /// Order matters: <b>revoked is checked before expiry</b>, because revocation also
    /// expires the row (see <see cref="RevokeInvitationAsync"/>) and checking expiry first
    /// would report every revoked invitation as merely expired -- collapsing an admin's
    /// deliberate act into the passage of time.
    /// </summary>
    private static async Task<(SurveyInvitation? Invitation, Survey? Survey, IResult? Error)> LoadByTokenAsync(
        string token,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!SurveyAccessTokens.HasExpectedShape(token))
        {
            return (null, null, InvitationNotFound());
        }

        var invitation = await db.SurveyInvitations.FirstOrDefaultAsync(i => i.InvitationToken == token, cancellationToken);
        if (invitation is null)
        {
            return (null, null, InvitationNotFound());
        }

        if (invitation.Status == SurveyInvitationStatuses.Revoked)
        {
            return (null, null, Results.Json(
                new { message = "This invitation has been revoked.", reason = "revoked" },
                statusCode: 410));
        }

        if (invitation.ExpiresAt <= UtcNow())
        {
            return (null, null, Results.Json(
                new { message = "This invitation has expired.", reason = "expired" },
                statusCode: 410));
        }

        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == invitation.SurveyId, cancellationToken);
        if (survey is null)
        {
            return (null, null, InvitationNotFound());
        }

        return (invitation, survey, null);
    }

    private static async Task<Guid?> ResolveActingUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        // Same three-step resolution SurveyEndpoints uses: `sub` is
        // `PersonaExternalId ?? Id`, so both shapes have to be tried before falling back to
        // the (unique, stable) email. Returns null rather than Guid.Empty -- last_regenerated_by
        // is a nullable FK with SET NULL, so null is a legal and honest "we do not know".
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

    /// <summary>
    /// Who this batch is for. Exactly one selector; an empty request is a 400 rather than a
    /// silent "everyone".
    /// </summary>
    private static async Task<(List<Guid>? UserIds, IResult? Error)> ResolveAudienceAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CreateSurveyInvitationsRequest request,
        CancellationToken cancellationToken)
    {
        var selectors = 0;
        if (request.UserIds is { Count: > 0 }) selectors++;
        if (request.DepartmentIds is { Count: > 0 }) selectors++;
        if (request.AllTargeted) selectors++;

        if (selectors != 1)
        {
            return (null, Results.Json(
                new { message = "Supply exactly one of userIds, departmentIds or allTargeted." },
                statusCode: 400));
        }

        if (request.UserIds is { Count: > 0 } requestedUsers)
        {
            var distinct = requestedUsers.Distinct().ToList();

            // Scoped to the SURVEY's company, not the caller's: a super_admin acting on
            // tenant A must not be able to invite tenant B's employees into tenant A's survey.
            var found = await db.Users
                .Where(u => distinct.Contains(u.Id) && u.CompanyId == survey.CompanyId && u.IsActive)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);

            var unknown = distinct.Except(found).ToList();
            if (unknown.Count > 0)
            {
                return (null, Results.Json(
                    new { message = $"Unknown or inactive user(s) for this company: {string.Join(", ", unknown)}" },
                    statusCode: 400));
            }

            return (found, null);
        }

        if (request.DepartmentIds is { Count: > 0 } requestedDepartments)
        {
            var distinct = requestedDepartments.Distinct().ToList();
            var knownDepartments = await db.Departments
                .Where(d => distinct.Contains(d.Id) && d.CompanyId == survey.CompanyId)
                .Select(d => d.Id)
                .ToListAsync(cancellationToken);

            var unknown = distinct.Except(knownDepartments).ToList();
            if (unknown.Count > 0)
            {
                return (null, Results.Json(
                    new { message = $"Unknown department(s) for this company: {string.Join(", ", unknown)}" },
                    statusCode: 400));
            }

            return (await UsersInDepartmentsAsync(db, survey.CompanyId, distinct, cancellationToken), null);
        }

        // allTargeted: the survey's own audience, which is `SurveyQueries.Audience` and
        // nothing written out again here. The union of "my department is targeted" and "I am
        // targeted", company-wide only when it targets neither -- the same rule
        // SurveyQueries.AssignedTo applies to /surveys/my, so "who gets invited", "who sees it
        // in their inbox", "who may answer it" and "who the roster lists" cannot drift apart.
        // They did: the browser's copy read zero DEPARTMENT targets as no targets at all and
        // showed a 240-person survey as aimed at the whole company.
        var audience = await SurveyQueries
            .Audience(db.Users, db.SurveyDepartmentTargets, db.SurveyUserTargets, survey.Id, survey.CompanyId)
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
        return (audience, null);
    }

    private static async Task<List<Guid>> UsersInDepartmentsAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        List<Guid> departmentIds,
        CancellationToken cancellationToken)
        => await db.Users
            .Where(u => u.CompanyId == companyId
                        && u.IsActive
                        && u.DepartmentId != null
                        && departmentIds.Contains(u.DepartmentId.Value))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// The most recent moment this invitee was contacted about this survey -- the invitation
    /// itself, or the latest reminder, whichever is later. Null when they have never been
    /// contacted, which is the only honest answer for an invitation that was minted but never
    /// queued.
    /// </summary>
    private static DateTimeOffset? LastContact(SurveyInvitation invitation)
    {
        if (invitation.SentAt is not { } sentAt)
        {
            return invitation.LastReminderSent;
        }

        return invitation.LastReminderSent is { } reminded && reminded > sentAt ? reminded : sentAt;
    }

    private static string SurveyPath(Guid surveyId) => $"/surveys/{surveyId}";

    /// <param name="locale">
    /// The locale the guarantee sentence is written in -- the request's <c>?lang</c> resolved
    /// against the survey's own content language, like every other string in the payload.
    /// The machine-readable half (<c>Anonymous</c>, the recordable state, the suppressed
    /// states) is locale-free; only the sentence a person reads changes.
    /// </param>
    private static SurveyAnonymityGuaranteeDto AnonymityOf(Survey survey, string locale)
    {
        var anonymous = survey.Settings.Anonymous;
        return new SurveyAnonymityGuaranteeDto(
            anonymous,
            SurveyInvitationStatuses.HighestRecordableState(anonymous),
            anonymous ? SurveyInvitationStatuses.SuppressedWhenAnonymous : [],
            // Completion from signed-in accounts is recorded separately from invitation events.
            InvitationGuaranteeCopy.Survey(anonymous, locale));
    }

    /// <summary>
    /// The locale the payload is ACTUALLY in, not the one asked for. A Spanish-only survey
    /// fetched with <c>?lang=en</c> comes back in Spanish and must say so -- reporting 'en'
    /// there is the silent substitution #195 forbids. Keyed on the title for the same reason
    /// <c>SurveyEndpoints.ToDetailAsync</c> keys on it: the title is the survey's identifying
    /// content, and FallbackFields still carries the per-field detail.
    /// </summary>
    private static string ResolvedLocaleOf(Survey survey, string locale)
        => LocalizedContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language).ResolvedLocale ?? locale;

    private static SurveyInvitationDetail ToInvitationDetail(SurveyInvitation invitation, DateTimeOffset now)
        => new(
            invitation.Id,
            invitation.SurveyId,
            invitation.UserId,
            invitation.Email,
            invitation.Status,
            invitation.Status != SurveyInvitationStatuses.Revoked && invitation.ExpiresAt <= now,
            invitation.SentAt,
            invitation.OpenedAt,
            // No longer written (ruled 2026-10-12); always null, kept in the contract for one
            // release so an older client reading them does not break. CompletedOn replaces them.
            StartedAt: null,
            CompletedAt: null,
            invitation.CompletedOn,
            invitation.ReminderCount,
            invitation.LastReminderSent,
            invitation.ExpiresAt,
            invitation.CreatedAt);

    private static async Task<SurveyInvitationSummaryDto> SummariseAsync(
        ClimateProjectDbContext db,
        Guid surveyId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var rows = await db.SurveyInvitations.AsNoTracking()
            .Where(i => i.SurveyId == surveyId)
            .Select(i => new { i.Status, i.ExpiresAt })
            .ToListAsync(cancellationToken);

        int CountOf(string status) => rows.Count(r => r.Status == status);

        return new SurveyInvitationSummaryDto(
            rows.Count,
            CountOf(SurveyInvitationStatuses.Pending),
            CountOf(SurveyInvitationStatuses.Sent),
            CountOf(SurveyInvitationStatuses.Opened),
            CountOf(SurveyInvitationStatuses.Started),
            CountOf(SurveyInvitationStatuses.Completed),
            CountOf(SurveyInvitationStatuses.Revoked),

            // Expired is derived, and overlaps the status buckets on purpose: an invitation
            // is both 'sent' and expired. Counting it as its own status would need a sweep to
            // keep true, which is the dependency this design does not take.
            rows.Count(r => r.Status != SurveyInvitationStatuses.Revoked && r.ExpiresAt <= now));
    }

    private static async Task<SurveyDistributionDetail> ToDistributionDetailAsync(
        SurveyDistribution distribution,
        Survey survey,
        string locale,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => new(
            distribution.Id,
            distribution.SurveyId,
            distribution.AccessType,
            distribution.PublicUrl,
            distribution.QrCodeUrl,
            new SurveyAccessRulesDto(
                distribution.AccessRules.RequireLogin,
                distribution.AccessRules.AllowAnonymous,
                distribution.AccessRules.SingleResponse,
                distribution.AccessRules.ActiveOutsideSchedule,
                distribution.AccessRules.AllowedDomains,
                distribution.AccessRules.BlockedIps,
                distribution.AccessRules.MaxResponses),
            new SurveyQrCustomizationDto(
                distribution.QrCustomization.ForegroundColor,
                distribution.QrCustomization.BackgroundColor,
                distribution.QrCustomization.LogoUrl,
                distribution.QrCustomization.Size),
            distribution.TokenizedLinksGenerated,
            distribution.RegeneratedCount,
            distribution.LastRegeneratedAt,
            distribution.TotalAccesses,
            distribution.UniqueVisitors,
            distribution.LastAccessedAt,
            await SummariseAsync(db, distribution.SurveyId, UtcNow(), cancellationToken),
            AnonymityOf(survey, locale),
            distribution.CreatedAt,
            distribution.UpdatedAt);

    private static void ApplyAccessRules(AccessRules rules, SurveyAccessRulesInput? input)
    {
        if (input is null)
        {
            return;
        }

        if (input.RequireLogin.HasValue) rules.RequireLogin = input.RequireLogin.Value;
        if (input.AllowAnonymous.HasValue) rules.AllowAnonymous = input.AllowAnonymous.Value;
        if (input.SingleResponse.HasValue) rules.SingleResponse = input.SingleResponse.Value;
        if (input.ActiveOutsideSchedule.HasValue) rules.ActiveOutsideSchedule = input.ActiveOutsideSchedule.Value;
        if (input.AllowedDomains is not null) rules.AllowedDomains = [.. input.AllowedDomains];
        if (input.BlockedIps is not null) rules.BlockedIps = [.. input.BlockedIps];
        if (input.MaxResponses.HasValue) rules.MaxResponses = input.MaxResponses.Value;
    }

    private static void ApplyQrCustomization(QrCustomization customization, SurveyQrCustomizationInput? input)
    {
        if (input is null)
        {
            return;
        }

        if (input.ForegroundColor is not null) customization.ForegroundColor = input.ForegroundColor.Trim();
        if (input.BackgroundColor is not null) customization.BackgroundColor = input.BackgroundColor.Trim();
        if (input.LogoUrl is not null) customization.LogoUrl = input.LogoUrl.Trim();
        if (input.Size.HasValue) customization.Size = input.Size.Value;
    }

    /// <summary>
    /// Pre-checks the two columns with a length cap, so an over-long colour is a 400 naming
    /// the field rather than an opaque 500 out of the global DbUpdateException handler.
    /// </summary>
    private static string? ValidateQrCustomization(SurveyQrCustomizationInput? input)
    {
        if (input is null)
        {
            return null;
        }

        if (input.ForegroundColor is { Length: > 20 } || input.BackgroundColor is { Length: > 20 })
        {
            return "QR colours must be 20 characters or fewer.";
        }

        if (input.LogoUrl is { Length: > 500 })
        {
            return "QR logoUrl must be 500 characters or fewer.";
        }

        if (input.Size is < 64 or > 2000)
        {
            return "QR size must be between 64 and 2000.";
        }

        return null;
    }

    private static IResult InvitationNotFound()
        => Results.Json(new { message = "Invitation not found", reason = "not_found" }, statusCode: 404);

    private static IResult LinkNotFound()
        => Results.Json(new { message = "This link is not valid." }, statusCode: 404);

    /// <summary>
    /// UTC now truncated to microseconds -- the precision Postgres <c>timestamptz</c> stores.
    /// Same reasoning as <c>NotificationEndpoints.UtcNow</c>: an untruncated .NET tick makes a
    /// response that does not equal what was persisted, which shows up as an endpoint looking
    /// non-idempotent when it is not.
    /// </summary>
    private static DateTimeOffset UtcNow()
    {
        var now = DateTimeOffset.UtcNow;
        return now.AddTicks(-(now.Ticks % TimeSpan.TicksPerMicrosecond));
    }
}
