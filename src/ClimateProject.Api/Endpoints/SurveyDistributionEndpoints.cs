using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
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
/// CompanyAdmin can call -- handing them the ability to open any employee's survey as that
/// employee. It also makes revocation real: a token revoked between queueing and sending is
/// gone by the time the sender looks it up.</item>
/// </list></para>
/// </summary>
public static class SurveyDistributionEndpoints
{
    /// <summary>Users one invitation batch will mint for. Bounded because the batch is built in memory and saved in one transaction, matching <c>NotificationEndpoints</c>' bulk cap.</summary>
    private const int MaxInvitationBatch = 500;

    /// <summary>Invitations one listing returns. Same bound and same reason as the notification listings.</summary>
    private const int MaxInvitationPageSize = 500;

    private const int NotificationTitleMaxLength = 500;

    /// <summary>
    /// Fallback invitation copy, per locale, used when the survey carries no custom subject
    /// or message. Backend-owned strings rather than i18n keys -- these are the body of an
    /// email composed server-side, not chrome the web app renders, and the web app never sees
    /// them. Both locales are present because #195's whole point is that a Spanish-speaking
    /// recipient is not served English by default.
    /// </summary>
    private static readonly Dictionary<string, string> DefaultSubject = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = "You have been invited to a survey",
        [ContentLanguages.Spanish] = "Has sido invitado a una encuesta",
    };

    private static readonly Dictionary<string, string> DefaultMessage = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = "Your feedback has been requested. Follow the link in this message to take part.",
        [ContentLanguages.Spanish] = "Se ha solicitado tu opinión. Sigue el enlace de este mensaje para participar.",
    };

    private static readonly Dictionary<string, string> DefaultReminderSubject = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = "Reminder: a survey is waiting for you",
        [ContentLanguages.Spanish] = "Recordatorio: una encuesta te está esperando",
    };

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
        byToken.MapPost("/{token}/opened", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Opened, db, ct));
        byToken.MapPost("/{token}/started", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Started, db, ct));
        byToken.MapPost("/{token}/completed", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, SurveyInvitationStatuses.Completed, db, ct));

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

        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, db, cancellationToken));
    }

    /// <summary>
    /// Create or update the distribution. One row per survey (the unique index on
    /// <c>survey_id</c> enforces it), so this is an upsert rather than a POST/PUT pair.
    /// </summary>
    private static async Task<IResult> UpsertDistributionAsync(
        Guid surveyId,
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

        var detail = await ToDistributionDetailAsync(distribution, survey!, db, cancellationToken);
        return isNew ? Results.Json(detail, statusCode: 201) : Results.Ok(detail);
    }

    private static async Task<IResult> RegenerateLinkAsync(
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
        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, db, cancellationToken));
    }

    private static async Task<IResult> RevokeLinkAsync(
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

        return Results.Ok(await ToDistributionDetailAsync(distribution, survey!, db, cancellationToken));
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
            AnonymityOf(survey!)));
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
        var notificationsQueued = 0;
        var queueInvitations = survey.Settings.NotificationSendInvitations;

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

            if (queueInvitations)
            {
                db.Notifications.Add(BuildInvitationNotification(survey, invitation, recipient, now));
                invitation.Status = SurveyInvitationStatuses.Sent;

                // SentAt is the moment the invitation actually goes out, NOT the moment it was
                // queued. Those differ whenever InvitationSendImmediately is off and the survey
                // has not opened yet, and the difference matters: SentAt is the anchor the
                // reminder cadence measures from, so stamping "now" on an invitation the sweep
                // will not deliver for three weeks would make it remindable before it was ever
                // delivered.
                invitation.SentAt = InvitationSendsAt(survey, now);
                notificationsQueued++;
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        var note = queueInvitations
            ? null
            : "This survey has notificationSendInvitations turned off, so invitations were minted but no notification was queued. Turn it on and use the resend route, or distribute the links another way.";

        return Results.Json(
            new SurveyInvitationBatchResult(
                userIds.Count,
                created.Count,
                created.Select(i => i.Id).ToList(),
                alreadyInvited,
                notificationsQueued,
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

        var now = UtcNow();

        // 'pending' is deliberately absent: it means the invitation was minted but never
        // queued for delivery, so a "reminder" would be the first thing that recipient ever
        // heard. The resend route is what turns a pending invitation into a sent one.
        var outstanding = new[]
        {
            SurveyInvitationStatuses.Sent,
            SurveyInvitationStatuses.Opened,
            SurveyInvitationStatuses.Started,
        };

        var candidates = await db.SurveyInvitations
            .Where(i => i.SurveyId == surveyId
                        && outstanding.Contains(i.Status)
                        && i.ExpiresAt > now)
            .ToListAsync(cancellationToken);

        // The cadence measures from the LAST TIME WE CONTACTED THIS PERSON, whichever contact
        // that was -- the invitation itself or the most recent reminder. Measuring from
        // LastReminderSent alone would let the first reminder go out the same minute as the
        // invitation, which is not a reminder, and would let a resend be followed instantly by
        // a reminder about the thing just resent. An invitation with no SentAt was never
        // delivered at all and is skipped: see the 'pending' note above.
        var cadence = TimeSpan.FromDays(Math.Max(1, survey.Settings.NotificationReminderFrequencyDays));
        var due = candidates.Where(i => LastContact(i) is { } contacted && contacted.Add(cadence) <= now).ToList();
        var skippedTooSoon = candidates.Count - due.Count;

        if (due.Count == 0)
        {
            return Results.Ok(new SurveyReminderResult(0, 0, skippedTooSoon, null));
        }

        var recipientIds = due.Select(i => i.UserId).Distinct().ToList();
        var recipients = await db.Users
            .Where(u => recipientIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var queued = 0;
        foreach (var invitation in due)
        {
            if (!recipients.TryGetValue(invitation.UserId, out var recipient))
            {
                // Unreachable while the user_id FK holds. Skipped rather than assumed,
                // because the alternative is composing mail for an address we cannot read.
                continue;
            }

            db.Notifications.Add(BuildReminderNotification(survey, invitation, recipient, now));
            invitation.ReminderCount += 1;
            invitation.LastReminderSent = now;
            invitation.UpdatedAt = now;
            queued++;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new SurveyReminderResult(due.Count, queued, skippedTooSoon, null));
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

        invitation.InvitationToken = SurveyAccessTokens.Mint();
        invitation.ExpiresAt = survey.EndDate;
        invitation.Status = SurveyInvitationStatuses.Sent;
        invitation.SentAt = InvitationSendsAt(survey, now);
        invitation.UpdatedAt = now;

        // Progress timestamps are NOT cleared. Whether this person opened the previous
        // invitation is a fact about them, and erasing it to make the new send look pristine
        // would corrupt the only engagement history the survey has.
        db.Notifications.Add(BuildInvitationNotification(survey, invitation, recipient, now));

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToInvitationDetail(invitation, now));
    }

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
        if (invitation.Status != SurveyInvitationStatuses.Revoked)
        {
            invitation.Status = SurveyInvitationStatuses.Revoked;

            // Belt and braces. Status alone is enough -- every token lookup checks it first,
            // and checks it BEFORE expiry so the holder is told "revoked" and not "expired".
            // Expiring the row too means a future code path that forgets the status check
            // still fails closed rather than honouring a revoked token.
            invitation.ExpiresAt = now;
            invitation.UpdatedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToInvitationDetail(invitation, now));
    }

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
            AnonymityOf(survey)));
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
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (invitation, survey, error) = await LoadByTokenAsync(token, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var anonymity = AnonymityOf(survey!);
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
                break;
            case SurveyInvitationStatuses.Started:
                invitation.StartedAt ??= now;
                break;
            case SurveyInvitationStatuses.Completed:
                invitation.CompletedAt ??= now;
                break;
        }

        invitation.Status = targetState;
        invitation.UpdatedAt = now;
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
            distribution.AccessRules.SingleResponse));
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

        // allTargeted: the survey's own audience. No department targets means company-wide --
        // the same rule SurveyQueries.AssignedTo applies to /surveys/my, so "who gets invited"
        // and "who sees it in their inbox" cannot drift apart.
        var targets = await db.SurveyDepartmentTargets
            .Where(t => t.SurveyId == survey.Id)
            .Select(t => t.DepartmentId)
            .ToListAsync(cancellationToken);

        if (targets.Count == 0)
        {
            var everyone = await db.Users
                .Where(u => u.CompanyId == survey.CompanyId && u.IsActive)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);
            return (everyone, null);
        }

        return (await UsersInDepartmentsAsync(db, survey.CompanyId, targets, cancellationToken), null);
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

    private static Notification BuildInvitationNotification(
        Survey survey,
        SurveyInvitation invitation,
        User recipient,
        DateTimeOffset now)
    {
        var locale = RecipientLocale(recipient, survey);
        var subject = Compose(
            LocalizedContent.ResolveText(survey.Settings.InvitationCustomSubjectEn, survey.Settings.InvitationCustomSubjectEs, locale, survey.Language),
            DefaultSubject[locale],
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, locale, survey.Language));

        var message = LocalizedContent.ResolveText(
                          survey.Settings.InvitationCustomMessageEn,
                          survey.Settings.InvitationCustomMessageEs,
                          locale,
                          survey.Language)
                      ?? DefaultMessage[locale];

        return NewNotification(
            survey, invitation, recipient, NotificationTypes.SurveyInvitation,
            subject, message, InvitationSendsAt(survey, now), now);
    }

    /// <summary>
    /// When an invitation queued at <paramref name="now"/> will actually go out.
    ///
    /// <c>InvitationSendImmediately</c> false means "hold until the survey opens", expressed
    /// as the notification's <c>ScheduledFor</c> and left to the sweep -- which is exactly the
    /// seam that keeps this surface out of a scheduler of its own. The same value is stamped
    /// on the invitation's <c>SentAt</c>, so the two cannot disagree about when a person was
    /// contacted.
    /// </summary>
    private static DateTimeOffset InvitationSendsAt(Survey survey, DateTimeOffset now)
        => survey.Settings.InvitationSendImmediately || survey.StartDate <= now
            ? now
            : survey.StartDate;

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

    private static Notification BuildReminderNotification(
        Survey survey,
        SurveyInvitation invitation,
        User recipient,
        DateTimeOffset now)
    {
        var locale = RecipientLocale(recipient, survey);
        var subject = Compose(
            null,
            DefaultReminderSubject[locale],
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, locale, survey.Language));

        var message = LocalizedContent.ResolveText(
                          survey.Settings.InvitationCustomMessageEn,
                          survey.Settings.InvitationCustomMessageEs,
                          locale,
                          survey.Language)
                      ?? DefaultMessage[locale];

        return NewNotification(survey, invitation, recipient, NotificationTypes.SurveyReminder, subject, message, now, now);
    }

    private static Notification NewNotification(
        Survey survey,
        SurveyInvitation invitation,
        User recipient,
        string type,
        string title,
        string message,
        DateTimeOffset scheduledFor,
        DateTimeOffset now) => new()
        {
            Id = Guid.NewGuid(),
            UserId = recipient.Id,
            CompanyId = survey.CompanyId,
            Type = type,
            Channel = NotificationChannels.Email,
            Priority = NotificationPriorities.Default,
            Status = NotificationStatuses.Default,
            Title = title,
            Message = message,

            // `data` is jsonb -- serialised, never concatenated, and deliberately carrying
            // the invitation's ID rather than its token. See the seam note on this class.
            Data = JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["surveyId"] = survey.Id.ToString(),
                ["surveyInvitationId"] = invitation.Id.ToString(),
            }),
            ScheduledFor = scheduledFor,
            RetryCount = 0,
            MaxRetries = 3,
            CreatedAt = now,
            UpdatedAt = now,
        };

    /// <summary>
    /// The locale to compose a recipient's mail in: their own display-language preference
    /// when it is one we can render, otherwise the survey's own single language, otherwise
    /// English. Note this is <c>User.Preferences.Language</c> -- the display preference --
    /// not the survey's content language, which is a different setting by design (see
    /// <c>ContentLanguages</c>). <see cref="LocalizedContent.Resolve"/> still has the last
    /// word: asking for Spanish from an English-only survey yields English, because the
    /// alternative is mailing somebody a null.
    /// </summary>
    private static string RecipientLocale(User recipient, Survey survey)
        => ContentLanguages.NormaliseLocale(recipient.Preferences.Language)
           ?? ContentLanguages.SingleLocaleOf(survey.Language)
           ?? ContentLanguages.FallbackLocale;

    private static string Compose(string? custom, string fallback, string? surveyTitle)
    {
        var stem = string.IsNullOrWhiteSpace(custom) ? fallback : custom.Trim();
        var composed = string.IsNullOrWhiteSpace(surveyTitle) ? stem : $"{stem}: {surveyTitle.Trim()}";
        return composed.Length <= NotificationTitleMaxLength ? composed : composed[..NotificationTitleMaxLength];
    }

    private static string SurveyPath(Guid surveyId) => $"/surveys/{surveyId}";

    private static SurveyAnonymityGuaranteeDto AnonymityOf(Survey survey)
    {
        var anonymous = survey.Settings.Anonymous;
        return new SurveyAnonymityGuaranteeDto(
            anonymous,
            SurveyInvitationStatuses.HighestRecordableState(anonymous),
            anonymous ? SurveyInvitationStatuses.SuppressedWhenAnonymous : [],
            anonymous
                ? "This survey is anonymous. Invitation tracking records that a person was invited and opened "
                  + "the invitation, and stops there. Neither 'started' nor 'completed' is stored against an "
                  + "individual, because a per-person timestamp asserting a response exists can be joined on "
                  + "time against the responses themselves and re-identifies the respondent. Completion is "
                  + "only ever available as an aggregate count."
                : "This survey is not anonymous. The full invitation lifecycle is recorded per invitee.");
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
            invitation.StartedAt,
            invitation.CompletedAt,
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
            AnonymityOf(survey),
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
