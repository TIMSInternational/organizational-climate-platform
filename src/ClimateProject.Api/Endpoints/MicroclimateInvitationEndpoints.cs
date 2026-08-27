using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Microclimate invitations and their state tracking (#130) -- replacing legacy
/// <c>api/microclimates/invitations/validate/[token]</c> and
/// <c>invitations/[id]/{opened,started,participated}</c>, and giving the microclimate
/// surface the distribution it did not have at all.
///
/// <para><b>What was actually missing.</b> <c>MicroclimateInvitation</c> has existed as an
/// entity and a table since <c>20260731125410_AddMicroclimateInvitations</c>, with a token
/// column, an expiry, a status ladder's worth of timestamps and a unique index on the token.
/// Nothing in the product wrote a row to it, read one, or mapped a route to it. So a
/// microclimate could be created, activated, answered and closed, and there was no way to
/// tell anyone it existed except by handing them its GUID.</para>
///
/// <para><b>This file is deliberately a twin of <c>SurveyDistributionEndpoints</c>, and
/// deliberately not a reuse of it.</b> The issue asks for a shape #116 can reuse, and #116
/// shipped first; matching it member for member is the point. But every row, key and payload
/// on this surface belongs to a different table. <c>SurveyNotificationData</c> names a
/// <c>survey_invitations</c> id, so queueing one of those for a microclimate invitee would
/// put a <c>microclimate_invitations</c> primary key into a field that is only ever looked up
/// in the other table -- which does not throw, does not fail a test, and quietly mails every
/// invitee a message with no link in it. Hence
/// <see cref="MicroclimateNotificationData"/> with its own key, and
/// <see cref="IMicroclimateInvitationTokens"/> with its own table.</para>
///
/// <para><b>Two authorization rules live in this file and the split is the point.</b></para>
/// <list type="bullet">
/// <item>The <c>/microclimates/{id}/invitations...</c> routes are administrative and use
/// <see cref="MicroclimateEndpoints.CanAccessCompany"/> unchanged -- SuperAdmin, or
/// CompanyAdmin whose claim matches the microclimate's company. Never a bare company match:
/// that would let any employee mail their whole company. (The issue's
/// <c>CompanyId == null</c> rule does not arise here -- <c>microclimates.company_id</c> is
/// NOT NULL, so there is no globally-visible row to protect.)</item>
/// <item>The <c>/microclimate-invitations/{token}</c> routes are <b>unauthenticated, and the
/// token is the credential</b>. That is not a shortcut, it is the requirement: the issue asks
/// for a page "routed outside <c>RequireAuth</c> -- an invitee may not have an account", and
/// a microclimate is answered anonymously by default. Requiring a login here would defeat the
/// reason the token column exists at all.</item>
/// </list>
///
/// <para><b>A third rule lives next door, and this file is why it changed.</b> An invitation
/// to a NON-anonymous microclimate ends at <c>POST /microclimates/{id}/responses</c>, which
/// requires a signed-in caller from the same company. That check used to run through
/// <c>MicroclimateEndpoints.CanAccessCompany</c> — the ADMIN helper, SuperAdmin or
/// CompanyAdmin only — so the invitee did everything the invitation card told them to, signed
/// in, and got a 403 for holding the employee role the invitation was minted for. Nothing
/// before this slice ever completed that journey, so nothing before this slice noticed. It
/// now runs through <c>CanRespondForCompany</c>: membership, not administration.</para>
///
/// <para><b>The recovery ladder for a link that went wrong, in one place.</b>
/// <c>resend</c> rotates a live invitee's token; <c>revoke</c> kills one; <c>reinstate</c>
/// issues a fresh token to somebody whose invitation was revoked. The third exists because
/// the first two were a closed loop: revoke refuses resend (deliberately), and
/// <see cref="CreateInvitationsAsync"/> counts the dead row as "already invited", so a
/// revoked employee had no live token and no route that could mint them one.</para>
///
/// <para><b>Addressed by token, not by id, and that is a change from legacy.</b> The legacy
/// routes were <c>invitations/[id]/opened</c> and friends -- an unauthenticated write keyed
/// by a primary key that every admin listing hands out. Anyone holding an id could advance
/// somebody else's ladder. Here the key IS the credential: 256 bits from
/// <c>RandomNumberGenerator</c>, never echoed by any read DTO, never persisted into
/// <c>notifications.data</c>. The legacy verb <c>participated</c> survives as a route alias
/// onto the same handler so a legacy link still lands somewhere; the stored status is
/// <c>completed</c>, because the column beside it is <c>completed_at</c>.</para>
///
/// <para><b>Rate limiting (#146).</b> The token routes take
/// <c>RateLimitPolicies.PublicToken</c>, which buckets by the token rather than the caller.
/// Every write below stamps a timestamp on <b>one already-existing row</b> and is strictly
/// monotonic, so there is no amplification and no row to flood with; the risk on a route
/// whose credential is in its URL is that <i>one</i> token is replayed or brute-forced from
/// many addresses, and one full bucket can only inconvenience the one invitee it names. Note
/// this is the opposite choice from <c>POST /microclimates/{id}/responses</c>, which
/// allocates against an aggregate and is therefore keyed by caller.</para>
///
/// <para><b>Where the notification seam is (#100).</b> Nothing in this file sends anything.
/// Inviting <b>persists <c>notifications</c> rows and stops</b>; delivery is
/// <c>POST /notifications/process</c> and the <c>ClimateProject.Workers</c> sweep. Recipient
/// consent (<c>NotificationDispatchPolicy</c>, which already maps
/// <c>microclimate_invitation</c> to <c>EmailMicroclimates</c>) is evaluated at delivery time,
/// so an invitee who opts out between being invited and the sweep running is honoured. And
/// the notification row does NOT carry the token -- see
/// <see cref="MicroclimateNotificationData"/>.</para>
///
/// <para><b>Reminders are somebody else's, they already existed, and they currently mail no
/// link. Written down here because this file is what made them reachable.</b>
/// <c>InvitationReminderJob.SweepMicroclimatesAsync</c> has swept
/// <c>microclimate_invitations</c> since #376 -- against a table nothing was writing rows to,
/// so it has never had a candidate. It does now. It queues a <c>deadline_reminder</c> with
/// <c>Data: null</c>, and its own comment says why: at the time, the only payload class in
/// the repository was <c>SurveyNotificationData</c>, which names a <c>survey_invitations</c>
/// id, and "writing one here would be a foreign key into the wrong table". That was exactly
/// right and it is the same trap this file was built around.
/// <para>
/// The consequence, stated plainly rather than left to be discovered: <b>a microclimate
/// invitee's reminder arrives without a way back to the pulse.</b> They have to find the
/// original invitation mail. That is a real defect and it is the microclimate twin of the one
/// #387 fixed for surveys.
/// </para>
/// <para>
/// It is NOT fixed here, deliberately, and the fix is now unblocked rather than unknown:
/// <see cref="MicroclimateNotificationData"/> is the payload class that did not exist when
/// that comment was written. What it needs is a decision this slice should not take alone --
/// <c>deadline_reminder</c> is a shared type (action plans raise it too), so either it joins
/// <see cref="MicroclimateNotificationData.LinkCarryingTypes"/> and every action-plan reminder
/// starts parsing a payload it does not have, or the sender grows a payload-driven branch,
/// which is the thing <c>EmailNotificationSender</c>'s type-check-first rule exists to avoid.
/// Both are defensible; picking one belongs with whoever owns the reminder cadence.
/// </para></para>
/// </summary>
public static class MicroclimateInvitationEndpoints
{
    /// <summary>Users one invitation batch will mint for. Bounded because the batch is built in memory and saved in one transaction, matching <c>SurveyDistributionEndpoints</c>.</summary>
    private const int MaxInvitationBatch = 500;

    /// <summary>Invitations one listing returns. Same bound and same reason.</summary>
    private const int MaxInvitationPageSize = 500;

    private const int NotificationTitleMaxLength = 500;

    /// <summary>
    /// Fallback invitation copy, per locale. Backend-owned strings rather than i18n keys --
    /// these are the body of an email composed server-side, not chrome the web app renders,
    /// and the web app never sees them. Both locales are present because #195's whole point
    /// is that a Spanish-speaking recipient is not served English by default.
    /// </summary>
    private static readonly Dictionary<string, string> DefaultSubject = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = "You have been invited to a quick pulse",
        [ContentLanguages.Spanish] = "Te han invitado a un pulso rápido",
    };

    private static readonly Dictionary<string, string> DefaultMessage = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = "Your feedback has been requested. Follow the link in this message to take part; it only takes a moment.",
        [ContentLanguages.Spanish] = "Se ha solicitado tu opinión. Sigue el enlace de este mensaje para participar; solo toma un momento.",
    };

    public static void MapMicroclimateInvitationEndpoints(this WebApplication app)
    {
        // A second group over the same "/microclimates" prefix MicroclimateEndpoints already
        // maps. Separate group, separate file, one prefix: "invitations" is a literal segment
        // after the guid constraint, so none of these can shadow "/{id:guid}" or its verbs.
        var admin = app.MapGroup("/microclimates").RequireAuthorization();

        admin.MapGet("/{microclimateId:guid}/invitations", ListInvitationsAsync);
        admin.MapPost("/{microclimateId:guid}/invitations", CreateInvitationsAsync);
        admin.MapPost("/{microclimateId:guid}/invitations/{invitationId:guid}/resend", ResendInvitationAsync);
        admin.MapPost("/{microclimateId:guid}/invitations/{invitationId:guid}/revoke", RevokeInvitationAsync);
        admin.MapPost("/{microclimateId:guid}/invitations/{invitationId:guid}/reinstate", ReinstateInvitationAsync);

        // Token-addressed and unauthenticated -- see the class remarks. The state routes
        // share ONE handler, so the monotonic rule and the anonymity ceiling cannot be
        // applied to two of them and forgotten on the third.
        var byToken = app.MapGroup("/microclimate-invitations")
            .RequireRateLimiting(RateLimitPolicies.PublicToken);

        byToken.MapGet("/{token}", ValidateInvitationTokenAsync);
        byToken.MapPost("/{token}/opened", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, MicroclimateInvitationStatuses.Opened, db, ct));
        byToken.MapPost("/{token}/started", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, MicroclimateInvitationStatuses.Started, db, ct));
        byToken.MapPost("/{token}/completed", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, MicroclimateInvitationStatuses.Completed, db, ct));

        // The legacy verb for the same rung, mapped onto the same handler and writing the
        // same `completed` status. Not an alias for its own sake: the legacy surface this
        // replaces named the route `invitations/[id]/participated`, so anything still
        // pointing at that word reaches the ladder instead of the 404 boundary. One handler
        // means the two cannot ever mean different things.
        byToken.MapPost("/{token}/participated", (string token, ClimateProjectDbContext db, CancellationToken ct)
            => RecordStateAsync(token, MicroclimateInvitationStatuses.Completed, db, ct));
    }

    // ------------------------------------------------------------------
    // Invitations -- admin
    // ------------------------------------------------------------------

    private static async Task<IResult> ListInvitationsAsync(
        Guid microclimateId,
        string? status,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadAdministrableAsync(microclimateId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        if (status is not null && !MicroclimateInvitationStatuses.IsValid(status))
        {
            return Results.Json(
                new { message = $"Invalid status: {status}. Expected one of: {string.Join(", ", MicroclimateInvitationStatuses.All)}" },
                statusCode: 400);
        }

        var query = db.MicroclimateInvitations.AsNoTracking().Where(i => i.MicroclimateId == microclimateId);
        if (status is not null)
        {
            query = query.Where(i => i.Status == status);
        }

        var rows = await query
            .OrderBy(i => i.CreatedAt)
            .Take(MaxInvitationPageSize)
            .ToListAsync(cancellationToken);

        var now = UtcNow();

        return Results.Ok(new MicroclimateInvitationListResponse(
            rows.Select(i => ToDetail(i, now)).ToList(),
            await SummariseAsync(db, microclimateId, now, cancellationToken),
            AnonymityOf(microclimate!)));
    }

    /// <summary>
    /// Mint invitations for an audience, and queue one notification each.
    ///
    /// <para><b>A draft microclimate cannot be distributed.</b> Inviting people to a draft is
    /// inviting them to something whose questions can still be rewritten -- and the invitation
    /// carries the session's title. <c>MicroclimateStatuses.AcceptsResponses</c> is the same
    /// predicate the respond path uses, so "who may be invited" and "who may answer" cannot
    /// drift apart.</para>
    /// </summary>
    private static async Task<IResult> CreateInvitationsAsync(
        Guid microclimateId,
        CreateMicroclimateInvitationsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (microclimate, error) = await LoadAdministrableAsync(microclimateId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        if (!MicroclimateStatuses.AcceptsResponses(microclimate!.Status))
        {
            return Results.Json(
                new
                {
                    message = $"A microclimate in status '{microclimate.Status}' cannot be distributed. "
                              + $"Activate it first via POST /microclimates/{{id}}/activate.",
                },
                statusCode: 409);
        }

        var now = UtcNow();
        if (microclimate.Scheduling.EndTime <= now)
        {
            return Results.Json(
                new { message = "This microclimate's response window has already closed; there is nothing to invite anyone to." },
                statusCode: 409);
        }

        var (userIds, audienceError) = await ResolveAudienceAsync(db, microclimate, request, cancellationToken);
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

        // An invitation never outlives its session. ExpiresInDays can bring the deadline
        // forward and never push it past EndTime: a token that still opens a closed pulse is
        // a token with nothing to protect and everything to leak.
        var expiresAt = microclimate.Scheduling.EndTime;
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

        // Scoped to THIS microclimate. Without that clause anyone invited to any pulse in the
        // tenant would be silently skipped for every later one -- an invitation that never
        // sends and never errors, reported only as a user id in `skippedUserIds`.
        var existing = await db.MicroclimateInvitations
            .Where(i => i.MicroclimateId == microclimateId && userIds.Contains(i.UserId))
            .Select(i => new { i.UserId, i.Status })
            .ToListAsync(cancellationToken);
        var alreadyInvited = existing.Select(i => i.UserId).ToList();
        var alreadyInvitedSet = alreadyInvited.ToHashSet();

        // A revoked row still occupies its invitee's slot, so this route skips them. That is
        // the right call -- reviving a revocation silently is not this route's decision to
        // take -- but leaving the admin to work out why "invite Bob" reported `created: 0` is
        // how a one-way door gets built. The route that opens it is named in the response.
        var revokedSkips = existing.Count(i => i.Status == MicroclimateInvitationStatuses.Revoked);

        var recipients = await db.Users
            .Where(u => userIds.Contains(u.Id))
            .ToListAsync(cancellationToken);

        var created = new List<MicroclimateInvitation>();
        var undeliverable = 0;

        foreach (var recipient in recipients.Where(u => !alreadyInvitedSet.Contains(u.Id)))
        {
            var invitation = new MicroclimateInvitation
            {
                Id = Guid.NewGuid(),
                MicroclimateId = microclimateId,
                UserId = recipient.Id,
                CompanyId = microclimate.CompanyId,
                Email = recipient.Email,
                InvitationToken = MicroclimateInvitationLinks.Mint(),
                Status = MicroclimateInvitationStatuses.Sent,
                ExpiresAt = expiresAt,

                // A microclimate has no "send later" setting -- there is no
                // InvitationSendImmediately equivalent on MicroclimateRealtimeSettings, and a
                // pulse whose whole window is measured in hours has nothing to schedule
                // against. So the notification is queued for now and SentAt is now, and the
                // two cannot disagree about when a person was contacted.
                SentAt = now,
                CreatedAt = now,
                UpdatedAt = now,
            };
            created.Add(invitation);
            db.MicroclimateInvitations.Add(invitation);
            db.Notifications.Add(BuildInvitationNotification(microclimate, invitation, recipient, now));

            // Counted, not refused. The address cannot receive mail -- .test, .invalid and
            // example.com are reserved by RFC so that no mailbox exists behind them -- and
            // the send path refuses it for that reason. Minting the invitation anyway is
            // deliberate: the row IS the artefact and its link is distributable by hand.
            // But an admin who queues rows and gets silent permanent failures minutes later
            // has been told nothing, so the count comes back with the response.
            if (UndeliverableAddresses.IsUndeliverable(invitation.Email))
            {
                undeliverable++;
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        var notes = new List<string>();
        if (undeliverable > 0)
        {
            notes.Add(
                $"{undeliverable} of the {created.Count} invitations just created are addressed to a reserved "
                + "domain (.test, .invalid, .example, .localhost, example.com/.net/.org) that can never receive mail. "
                + "No mail will be sent to those addresses and they will show as failed; fix the addresses on those "
                + "accounts and use the resend route.");
        }

        if (revokedSkips > 0)
        {
            notes.Add(
                $"{revokedSkips} of the users in this request were skipped because their invitation to this "
                + "microclimate is revoked. A revoked invitation is not replaced by a new one; issue that person a "
                + "fresh token with POST /microclimates/{id}/invitations/{invitationId}/reinstate.");
        }

        var note = notes.Count > 0 ? string.Join(" ", notes) : null;

        return Results.Json(
            new MicroclimateInvitationBatchResult(
                userIds.Count,
                created.Count,
                created.Select(i => i.Id).ToList(),
                alreadyInvited,
                created.Count,
                undeliverable,
                note),
            statusCode: 201);
    }

    /// <summary>
    /// Rotate this invitee's token and queue a fresh notification.
    ///
    /// <para>The token is re-minted rather than re-sent, so a link that has been forwarded,
    /// logged by a mail gateway or pasted into a chat stops working the moment a new one is
    /// issued. That is the only way an admin has to recover from a leaked invitation without
    /// deleting the row and losing its history.</para>
    ///
    /// <para>Refused for a revoked invitation: revocation is a decision, and a resend route
    /// that silently un-revokes is a revocation that does not mean anything. The route that
    /// undoes it on purpose is <see cref="ReinstateInvitationAsync"/> — without which this
    /// 409 was one half of a pair of recoveries that excluded each other.</para>
    /// </summary>
    private static async Task<IResult> ResendInvitationAsync(
        Guid microclimateId,
        Guid invitationId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadAdministrableAsync(microclimateId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var invitation = await db.MicroclimateInvitations
            .FirstOrDefaultAsync(i => i.Id == invitationId && i.MicroclimateId == microclimateId, cancellationToken);
        if (invitation is null)
        {
            return InvitationNotFound();
        }

        if (invitation.Status == MicroclimateInvitationStatuses.Revoked)
        {
            return Results.Json(
                new { message = "This invitation has been revoked. Revocation is not undone by a resend." },
                statusCode: 409);
        }

        if (invitation.Status == MicroclimateInvitationStatuses.Completed)
        {
            return Results.Json(new { message = "This invitation has already been completed." }, statusCode: 409);
        }

        var now = UtcNow();
        if (microclimate!.Scheduling.EndTime <= now || !MicroclimateStatuses.AcceptsResponses(microclimate.Status))
        {
            return Results.Json(
                new { message = "This microclimate is no longer distributable; its window has closed or it is not active." },
                statusCode: 409);
        }

        var recipient = await db.Users.FirstOrDefaultAsync(u => u.Id == invitation.UserId, cancellationToken);
        if (recipient is null)
        {
            return Results.Json(new { message = "The invited user no longer exists." }, statusCode: 409);
        }

        invitation.InvitationToken = MicroclimateInvitationLinks.Mint();

        // The REPLACEMENT token gets the same lifetime the original was minted with, not the
        // session's whole remaining window. An admin who asked for `ExpiresInDays: 1` on a
        // 30-day pulse and then resent used to get a 30-day token back on the first resend --
        // a route documented as "brings the token deadline forward" silently pushing it out,
        // on the one route whose entire purpose is replacing a link that may have leaked.
        invitation.ExpiresAt = ResendExpiryOf(invitation, microclimate, now);
        invitation.Status = MicroclimateInvitationStatuses.Sent;
        invitation.SentAt = now;
        invitation.UpdatedAt = now;

        // Progress timestamps are NOT cleared. Whether this person opened the previous
        // invitation is a fact about them, and erasing it to make the new send look pristine
        // would corrupt the only engagement history the session has.
        db.Notifications.Add(BuildInvitationNotification(microclimate, invitation, recipient, now));

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToDetail(invitation, now));
    }

    /// <summary>
    /// The lifetime a resent token gets: the one the invitation was originally minted with,
    /// re-measured from now, and never past the session's own close.
    ///
    /// <para>The row does not store <c>ExpiresInDays</c>, so the window is derived from the
    /// two timestamps that ARE stored -- the deadline the admin got and the moment it was
    /// measured from. <c>SentAt</c> is the moment the token started being useful; it falls
    /// back to <c>CreatedAt</c> for a row that was never sent, and the two are written
    /// together on this surface anyway.</para>
    ///
    /// <para>Deriving the DURATION rather than reusing the deadline is what keeps a resend
    /// from ever handing back a token that is already dead: an invitation minted for one day
    /// and resent on day three has a deadline in the past, and preserving it literally would
    /// mail somebody a link that fails on arrival.</para>
    /// </summary>
    private static DateTimeOffset ResendExpiryOf(
        MicroclimateInvitation invitation,
        Microclimate microclimate,
        DateTimeOffset now)
    {
        var measuredFrom = invitation.SentAt ?? invitation.CreatedAt;
        var originalWindow = invitation.ExpiresAt - measuredFrom;
        var endTime = microclimate.Scheduling.EndTime;

        if (originalWindow <= TimeSpan.Zero)
        {
            return endTime;
        }

        var renewed = now + originalWindow;
        return renewed < endTime ? renewed : endTime;
    }

    private static async Task<IResult> RevokeInvitationAsync(
        Guid microclimateId,
        Guid invitationId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (_, error) = await LoadAdministrableAsync(microclimateId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var invitation = await db.MicroclimateInvitations
            .FirstOrDefaultAsync(i => i.Id == invitationId && i.MicroclimateId == microclimateId, cancellationToken);
        if (invitation is null)
        {
            return InvitationNotFound();
        }

        var now = UtcNow();
        if (invitation.Status != MicroclimateInvitationStatuses.Revoked)
        {
            invitation.Status = MicroclimateInvitationStatuses.Revoked;

            // Belt and braces. Status alone is enough -- every token lookup checks it first,
            // and checks it BEFORE expiry so the holder is told "revoked" and not "expired".
            // Expiring the row too means a future code path that forgets the status check
            // still fails closed rather than honouring a revoked token.
            invitation.ExpiresAt = now;
            invitation.UpdatedAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToDetail(invitation, now));
    }

    /// <summary>
    /// Undo a revocation deliberately: mint a fresh token for an invitee whose link was
    /// killed, and queue the notification that carries it.
    ///
    /// <para><b>Why this route exists at all.</b> Without it, revocation was a one-way door.
    /// <c>revoke</c> is what an admin does to a leaked link; <c>resend</c> then answers 409
    /// ("revocation is not undone by a resend", which is correct), and
    /// <see cref="CreateInvitationsAsync"/> counts the dead row as "already invited" and skips
    /// the user forever. The two documented recoveries were mutually exclusive and the
    /// employee ended up with no live token and no route that could give them one.</para>
    ///
    /// <para><b>Why it is a separate route and not a relaxation of resend.</b> Resend is a
    /// mechanical act on a row an admin may have forgotten they revoked; reinstating is a new
    /// decision, and a decision should have to be spelled. It refuses anything that is not
    /// revoked with a 409 for the same reason -- so it can never be used as a quieter resend,
    /// and so "reinstate" in the audit log means exactly one thing.</para>
    ///
    /// <para><b>What the new token's deadline is, and why it is NOT
    /// <see cref="ResendExpiryOf"/>.</b> Revocation clobbers <c>ExpiresAt</c> to the moment of
    /// revocation on purpose (see <see cref="RevokeInvitationAsync"/>). That destroys the
    /// original window rather than merely shortening it: the derived lifetime
    /// <c>ExpiresAt - SentAt</c> becomes the few seconds between the send and the revocation,
    /// so reusing the resend rule here mints a token that is dead on arrival. It is the
    /// session's own close, plainly — the row no longer carries an admin's ask to honour.
    /// Somebody who wants a shorter one uses the batch route's <c>ExpiresInDays</c>.</para>
    /// </summary>
    private static async Task<IResult> ReinstateInvitationAsync(
        Guid microclimateId,
        Guid invitationId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (microclimate, error) = await LoadAdministrableAsync(microclimateId, principal, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var invitation = await db.MicroclimateInvitations
            .FirstOrDefaultAsync(i => i.Id == invitationId && i.MicroclimateId == microclimateId, cancellationToken);
        if (invitation is null)
        {
            return InvitationNotFound();
        }

        if (invitation.Status != MicroclimateInvitationStatuses.Revoked)
        {
            return Results.Json(
                new
                {
                    message = $"This invitation is '{invitation.Status}', not revoked. "
                              + "Reinstating only ever undoes a revocation; use the resend route to rotate a live token.",
                },
                statusCode: 409);
        }

        var now = UtcNow();
        if (microclimate!.Scheduling.EndTime <= now || !MicroclimateStatuses.AcceptsResponses(microclimate.Status))
        {
            return Results.Json(
                new { message = "This microclimate is no longer distributable; its window has closed or it is not active." },
                statusCode: 409);
        }

        var recipient = await db.Users.FirstOrDefaultAsync(u => u.Id == invitation.UserId, cancellationToken);
        if (recipient is null)
        {
            return Results.Json(new { message = "The invited user no longer exists." }, statusCode: 409);
        }

        // A NEW token, never the revoked one. The whole reason a link gets revoked is that
        // somebody else may be holding it, and handing the old string back would reinstate
        // them too.
        invitation.InvitationToken = MicroclimateInvitationLinks.Mint();
        invitation.ExpiresAt = microclimate.Scheduling.EndTime;
        invitation.Status = MicroclimateInvitationStatuses.Sent;
        invitation.SentAt = now;
        invitation.UpdatedAt = now;

        // Progress timestamps survive, exactly as they do across a resend: whether this person
        // opened the invitation that was later revoked is a fact about them, and erasing it to
        // make the reinstatement look pristine would corrupt the session's only engagement
        // history.
        db.Notifications.Add(BuildInvitationNotification(microclimate, invitation, recipient, now));

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToDetail(invitation, now));
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
        var (invitation, microclimate, error) = await LoadByTokenAsync(token, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        // Distinct from expired and from revoked, and deliberately not a 200: the client has
        // to render "you already answered this" rather than an answerable pulse.
        //
        // Only ever reachable on a NON-anonymous microclimate. An anonymous one never records
        // `completed` at all (see MicroclimateInvitationStatuses.AnonymityCeiling), so its
        // invitees can re-open their link -- which is correct and is the cost of the
        // guarantee: refusing them would require knowing they had answered.
        if (invitation!.Status == MicroclimateInvitationStatuses.Completed)
        {
            return Results.Json(
                new { message = "This invitation has already been used.", reason = "already_completed" },
                statusCode: 409);
        }

        var locale = MicroclimateContent.ResolveRequestLocale(lang, microclimate!.Language);
        var fallbackFields = new List<string>();
        var title = MicroclimateContent.Resolve(
            microclimate.TitleEn, microclimate.TitleEs, locale, microclimate.Language, "title", fallbackFields);
        var description = MicroclimateContent.Resolve(
            microclimate.DescriptionEn, microclimate.DescriptionEs, locale, microclimate.Language, "description", fallbackFields);

        return Results.Ok(new MicroclimateInvitationTokenDetail(
            invitation.Id,
            microclimate.Id,
            title,
            description,
            microclimate.Language,
            ResolvedLocaleOf(microclimate, locale),
            fallbackFields,
            invitation.Status,
            microclimate.Status,
            microclimate.Scheduling.StartTime,
            microclimate.Scheduling.EndTime,
            invitation.ExpiresAt,
            AnonymityOf(microclimate)));
    }

    /// <summary>
    /// Record one forward step on the invitation ladder.
    ///
    /// The single implementation behind <c>/opened</c>, <c>/started</c>, <c>/completed</c> and
    /// the legacy <c>/participated</c>. Two rules apply and both return 200 with an
    /// explanation rather than an error, because neither is the caller's fault:
    /// <list type="number">
    /// <item>The step is not forward progress (a replayed ping, or an out-of-order one).
    /// Nothing is written and the recorded timestamp does not move.</item>
    /// <item>The microclimate is anonymous and the step is past
    /// <see cref="MicroclimateInvitationStatuses.AnonymityCeiling"/>. Nothing is written, and
    /// the response says so -- a suppressed write reported as a successful one would be the
    /// lie the whole guarantee is built to avoid.</item>
    /// </list>
    ///
    /// <para><b>The anonymity check runs first, and — stated plainly, because an earlier
    /// version of this comment claimed otherwise — the order is NOT currently observable.</b>
    /// Swapping the two blocks changes no response today: for the order to matter, an
    /// anonymous invitation would have to already be sitting at <c>started</c> or
    /// <c>completed</c> so the progression check could claim it first, and the ceiling is
    /// exactly what makes that unreachable. The order is chosen because the anonymity refusal
    /// is the stronger statement — a policy, not a state — and a reader who meets the
    /// progression check first would reasonably conclude the ceiling was a special case of
    /// replay handling. It is a claim about the ladder's shape, not a guard, and calling it
    /// load-bearing was overstating a comment in a file whose value is its comments.</para>
    /// </summary>
    private static async Task<IResult> RecordStateAsync(
        string token,
        string targetState,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (invitation, microclimate, error) = await LoadByTokenAsync(token, db, cancellationToken);
        if (error is not null)
        {
            return error;
        }

        var anonymity = AnonymityOf(microclimate!);
        var anonymous = microclimate!.RealtimeSettings.AnonymousResponses;

        if (!MicroclimateInvitationStatuses.IsRecordable(targetState, anonymous))
        {
            return Results.Ok(new MicroclimateInvitationStateResult(
                invitation!.Id,
                invitation.Status,
                Recorded: false,
                SuppressedForAnonymity: true,
                $"This microclimate is anonymous, so '{targetState}' is not recorded against an individual invitation. "
                + $"Tracking stops at '{MicroclimateInvitationStatuses.AnonymityCeiling}'; participation is only ever counted in aggregate.",
                anonymity));
        }

        if (!MicroclimateInvitationStatuses.Advances(invitation!.Status, targetState))
        {
            return Results.Ok(new MicroclimateInvitationStateResult(
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
            case MicroclimateInvitationStatuses.Opened:
                invitation.OpenedAt ??= now;
                break;
            case MicroclimateInvitationStatuses.Started:
                invitation.StartedAt ??= now;
                break;
            case MicroclimateInvitationStatuses.Completed:
                invitation.CompletedAt ??= now;
                break;
        }

        invitation.Status = targetState;
        invitation.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new MicroclimateInvitationStateResult(
            invitation.Id,
            invitation.Status,
            Recorded: true,
            SuppressedForAnonymity: false,
            null,
            anonymity));
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    private static async Task<(Microclimate? Microclimate, IResult? Error)> LoadAdministrableAsync(
        Guid microclimateId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == microclimateId, cancellationToken);
        if (microclimate is null)
        {
            return (null, Results.Json(new { message = "Microclimate not found" }, statusCode: 404));
        }

        return MicroclimateEndpoints.CanAccessCompany(principal.GetCurrentUser(), microclimate.CompanyId)
            ? (microclimate, null)
            : (null, Results.Forbid());
    }

    /// <summary>
    /// Resolve an invitation token to its invitation and microclimate, distinguishing the
    /// three dead-token cases the issue asks be kept distinct.
    ///
    /// <para>Order matters: <b>revoked is checked before expiry</b>, because revocation also
    /// expires the row (see <see cref="RevokeInvitationAsync"/>) and checking expiry first
    /// would report every revoked invitation as merely expired -- collapsing an admin's
    /// deliberate act into the passage of time.</para>
    ///
    /// <para>An unknown token and a malformed one are the same 404 with the same
    /// <c>not_found</c> reason. They have to be: a different answer for "43 base64url
    /// characters that match nothing" than for "hello" is an oracle telling a guesser their
    /// shape is right.</para>
    /// </summary>
    private static async Task<(MicroclimateInvitation? Invitation, Microclimate? Microclimate, IResult? Error)> LoadByTokenAsync(
        string token,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!MicroclimateInvitationLinks.HasExpectedShape(token))
        {
            return (null, null, InvitationNotFound());
        }

        var invitation = await db.MicroclimateInvitations
            .FirstOrDefaultAsync(i => i.InvitationToken == token, cancellationToken);
        if (invitation is null)
        {
            return (null, null, InvitationNotFound());
        }

        if (invitation.Status == MicroclimateInvitationStatuses.Revoked)
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

        var microclimate = await db.Microclimates
            .FirstOrDefaultAsync(m => m.Id == invitation.MicroclimateId, cancellationToken);
        if (microclimate is null)
        {
            return (null, null, InvitationNotFound());
        }

        return (invitation, microclimate, null);
    }

    /// <summary>
    /// Who this batch is for. Exactly one selector; an empty request is a 400 rather than a
    /// silent "everyone".
    /// </summary>
    private static async Task<(List<Guid>? UserIds, IResult? Error)> ResolveAudienceAsync(
        ClimateProjectDbContext db,
        Microclimate microclimate,
        CreateMicroclimateInvitationsRequest request,
        CancellationToken cancellationToken)
    {
        var selectors = 0;
        if (request.UserIds is { Count: > 0 }) selectors++;
        if (request.DepartmentIds is { Count: > 0 }) selectors++;
        if (request.AllCompanyUsers) selectors++;

        if (selectors != 1)
        {
            return (null, Results.Json(
                new { message = "Supply exactly one of userIds, departmentIds or allCompanyUsers." },
                statusCode: 400));
        }

        if (request.UserIds is { Count: > 0 } requestedUsers)
        {
            var distinct = requestedUsers.Distinct().ToList();

            // Scoped to the MICROCLIMATE's company, not the caller's: a super_admin acting on
            // tenant A must not be able to invite tenant B's employees into tenant A's pulse.
            var found = await db.Users
                .Where(u => distinct.Contains(u.Id) && u.CompanyId == microclimate.CompanyId && u.IsActive)
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
                .Where(d => distinct.Contains(d.Id) && d.CompanyId == microclimate.CompanyId)
                .Select(d => d.Id)
                .ToListAsync(cancellationToken);

            var unknown = distinct.Except(knownDepartments).ToList();
            if (unknown.Count > 0)
            {
                return (null, Results.Json(
                    new { message = $"Unknown department(s) for this company: {string.Join(", ", unknown)}" },
                    statusCode: 400));
            }

            return (await db.Users
                .Where(u => u.CompanyId == microclimate.CompanyId
                            && u.IsActive
                            && u.DepartmentId != null
                            && distinct.Contains(u.DepartmentId.Value))
                .Select(u => u.Id)
                .ToListAsync(cancellationToken), null);
        }

        // allCompanyUsers. Deliberately NOT "the microclimate's own targeting": that is
        // stored as MicroclimateTargeting.RoleFilters/TenureFilters/CustomFilters, none of
        // which resolves to a user set anywhere in this product -- CustomFilters is an
        // unparsed string column. Inviting from it would mean inventing an interpretation
        // here that nothing else shares, and the first screen to disagree with it would be
        // right. Company-wide, or a named list, are the two audiences that are actually
        // computable today.
        var everyone = await db.Users
            .Where(u => u.CompanyId == microclimate.CompanyId && u.IsActive)
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);

        return (everyone, null);
    }

    private static Notification BuildInvitationNotification(
        Microclimate microclimate,
        MicroclimateInvitation invitation,
        User recipient,
        DateTimeOffset now)
    {
        var locale = RecipientLocale(recipient, microclimate);
        var title = LocalizedContent.ResolveText(
            microclimate.TitleEn, microclimate.TitleEs, locale, microclimate.Language);

        return new Notification
        {
            Id = Guid.NewGuid(),
            UserId = recipient.Id,
            CompanyId = microclimate.CompanyId,
            Type = NotificationTypes.MicroclimateInvitation,
            Channel = NotificationChannels.Email,
            Priority = NotificationPriorities.Default,
            Status = NotificationStatuses.Default,
            Title = Compose(DefaultSubject[locale], title),
            Message = DefaultMessage[locale],

            // `data` is jsonb -- serialised, never concatenated, and deliberately carrying
            // the invitation's ID rather than its token.
            //
            // MicroclimateNotificationData, NOT SurveyNotificationData. The two serialise to
            // the same shape and mean entirely different rows; the wrong one here compiles,
            // passes, and mails every invitee a linkless message. See that class.
            Data = MicroclimateNotificationData.Serialize(microclimate.Id, invitation.Id),
            ScheduledFor = now,
            RetryCount = 0,
            MaxRetries = 3,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    /// <summary>
    /// The locale to compose a recipient's mail in: their own display-language preference
    /// when it is one we can render, otherwise the microclimate's own single language,
    /// otherwise English. <see cref="LocalizedContent.Resolve"/> still has the last word:
    /// asking for Spanish from an English-only session yields English, because the
    /// alternative is mailing somebody a null.
    /// </summary>
    private static string RecipientLocale(User recipient, Microclimate microclimate)
        => ContentLanguages.NormaliseLocale(recipient.Preferences.Language)
           ?? ContentLanguages.SingleLocaleOf(microclimate.Language)
           ?? ContentLanguages.FallbackLocale;

    private static string Compose(string stem, string? title)
    {
        var composed = string.IsNullOrWhiteSpace(title) ? stem : $"{stem}: {title.Trim()}";
        return composed.Length <= NotificationTitleMaxLength ? composed : composed[..NotificationTitleMaxLength];
    }

    /// <summary>
    /// The locale the payload is ACTUALLY in, not the one asked for. A Spanish-only session
    /// fetched with <c>?lang=en</c> comes back in Spanish and must say so -- reporting 'en'
    /// there is the silent substitution #195 forbids.
    /// </summary>
    private static string ResolvedLocaleOf(Microclimate microclimate, string locale)
        => LocalizedContent.Resolve(microclimate.TitleEn, microclimate.TitleEs, locale, microclimate.Language).ResolvedLocale
           ?? locale;

    private static MicroclimateAnonymityGuaranteeDto AnonymityOf(Microclimate microclimate)
    {
        var anonymous = microclimate.RealtimeSettings.AnonymousResponses;
        return new MicroclimateAnonymityGuaranteeDto(
            anonymous,
            MicroclimateInvitationStatuses.HighestRecordableState(anonymous),
            anonymous ? MicroclimateInvitationStatuses.SuppressedWhenAnonymous : [],
            anonymous
                ? "This microclimate is anonymous. Invitation tracking records that a person was invited and "
                  + "opened the invitation, and stops there. Neither 'started' nor 'completed' is stored against "
                  + "an individual, because a per-person timestamp asserting a response exists can be lined up "
                  + "against the live response count -- which this product publishes while the session runs -- "
                  + "and re-identifies the respondent. Participation is only ever available as an aggregate count."
                : "This microclimate is not anonymous; it already requires respondents to sign in. The full "
                  + "invitation lifecycle is recorded per invitee.");
    }

    private static MicroclimateInvitationDetail ToDetail(MicroclimateInvitation invitation, DateTimeOffset now)
        => new(
            invitation.Id,
            invitation.MicroclimateId,
            invitation.UserId,
            invitation.Email,
            invitation.Status,
            invitation.Status != MicroclimateInvitationStatuses.Revoked && invitation.ExpiresAt <= now,
            invitation.SentAt,
            invitation.OpenedAt,
            invitation.StartedAt,
            invitation.CompletedAt,
            invitation.ReminderCount,
            invitation.LastReminderSent,
            invitation.ExpiresAt,
            invitation.CreatedAt);

    private static async Task<MicroclimateInvitationSummaryDto> SummariseAsync(
        ClimateProjectDbContext db,
        Guid microclimateId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var rows = await db.MicroclimateInvitations.AsNoTracking()
            .Where(i => i.MicroclimateId == microclimateId)
            .Select(i => new { i.Status, i.ExpiresAt })
            .ToListAsync(cancellationToken);

        int CountOf(string status) => rows.Count(r => r.Status == status);

        return new MicroclimateInvitationSummaryDto(
            rows.Count,
            CountOf(MicroclimateInvitationStatuses.Pending),
            CountOf(MicroclimateInvitationStatuses.Sent),
            CountOf(MicroclimateInvitationStatuses.Opened),
            CountOf(MicroclimateInvitationStatuses.Started),
            CountOf(MicroclimateInvitationStatuses.Completed),
            CountOf(MicroclimateInvitationStatuses.Revoked),

            // Expired is derived, and overlaps the status buckets on purpose: an invitation
            // is both 'sent' and expired. Counting it as its own status would need a sweep to
            // keep true, which is the dependency this design does not take.
            rows.Count(r => r.Status != MicroclimateInvitationStatuses.Revoked && r.ExpiresAt <= now));
    }

    /// <summary>
    /// One 404 with one reason for every "there is no such live invitation" case, so the
    /// route is not an oracle for token shape or for row existence.
    /// </summary>
    private static IResult InvitationNotFound()
        => Results.Json(
            new { message = "This invitation link is not valid.", reason = "not_found" },
            statusCode: 404);

    private static DateTimeOffset UtcNow() => DateTimeOffset.UtcNow;
}
