using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Why a reissue was refused, as a stable code beside the English <c>message</c>, so a screen
/// can say it in the reader's language without parsing a sentence.
/// </summary>
public static class SurveyCredentialReissueRefusals
{
    /// <summary>The survey hands out one account per person (<c>shared</c>); there is no per-survey key to reissue.</summary>
    public const string NotPerSurvey = "not_per_survey";

    /// <summary>The survey is a draft, closed, archived, or past its end date: a key to it would open nothing.</summary>
    public const string SurveyNotOpen = "survey_not_open";

    /// <summary>No such account in this survey's company.</summary>
    public const string UserNotFound = "user_not_found";

    /// <summary>The account is deactivated: sign-in refuses it whatever key it holds.</summary>
    public const string UserInactive = "user_inactive";

    /// <summary>The account is not in the survey's audience, so a key would open nothing either.</summary>
    public const string NotInAudience = "not_in_audience";

    /// <summary>Nobody minted a key for this person on this survey yet: the invite step does that, not this one.</summary>
    public const string NoCredential = "no_credential";

    /// <summary>The key has already been used to sign in; replacing it would lock out somebody who has it.</summary>
    public const string AlreadySignedIn = "already_signed_in";

    /// <summary>
    /// Handing a password over in person, or replacing a key that has been used, was asked for by
    /// somebody who is not a super_admin. See <see cref="SurveyCredentialReissueRequest"/>.
    /// </summary>
    public const string SuperAdminOnly = "super_admin_only";

    /// <summary><c>delivery</c> named something other than <c>email</c> or <c>handover</c>.</summary>
    public const string UnknownDelivery = "unknown_delivery";
}

/// <summary>How a reissued password reaches its holder.</summary>
public static class SurveyCredentialDeliveries
{
    /// <summary>Mailed to the person's own address. The default, and the only way before November 2026.</summary>
    public const string Email = "email";

    /// <summary>
    /// Returned ONCE, in the response, to a super_admin who passes it on in person. Nothing is mailed.
    /// </summary>
    public const string Handover = "handover";
}

/// <summary>
/// The optional body of <c>POST /surveys/{surveyId}/credentials/{userId}/reissue</c>. No body at
/// all is the October behaviour exactly: mail the new password, refuse a key that has been used.
/// </summary>
/// <param name="Delivery">
/// <c>email</c> (default) or <c>handover</c>. <b>Handover is super_admin only.</b> It exists
/// because, between 26 Oct and 3 Nov 2026, about twenty ESPH people -- paper questionnaires, an
/// address the client's own gateway rejects, a client contact who asked to pass the key on
/// herself -- each had their account's email re-pointed by SQL to a TIMS inbox, only so TIMS
/// could read the one email the product would send. The plaintext reached TIMS either way; this
/// gets it there without editing anybody's address. A company_admin may not do it: a company that
/// can read an employee's password can sign in as that employee to a survey promised to be
/// anonymous to the company.
/// </param>
/// <param name="ReplaceUsedKey">
/// Replace a key even though it has been used to sign in. <b>super_admin only.</b> The default
/// refusal protects somebody who HOLDS their key from being locked out part-way through; this is
/// for the opposite case, somebody who signed in once and has since lost it -- Mario Freer,
/// Teletrabajo, 3 Nov 2026, whose half-finished answers are kept and who now needs a new password.
/// The used-on day is kept, because it is still true. A session already open with the old
/// password is not ended (see <see cref="SurveyCredential"/>): it belongs to the person this is for.
/// </param>
public sealed record SurveyCredentialReissueRequest(string? Delivery = null, bool ReplaceUsedKey = false);

/// <summary>
/// Why a revoke was refused, as a stable code beside the English <c>message</c>. Separate from
/// <see cref="SurveyCredentialReissueRefusals"/> although some values coincide: the two routes
/// are different contracts and a screen reads each one's own list. Notably there is no
/// <c>already_signed_in</c> here -- see <see cref="SurveyCredentialEndpoints"/>.
/// </summary>
public static class SurveyCredentialRevokeRefusals
{
    /// <summary>The survey hands out one account per person (<c>shared</c>); there is no per-survey key to withdraw.</summary>
    public const string NotPerSurvey = "not_per_survey";

    /// <summary>No such account in this survey's company.</summary>
    public const string UserNotFound = "user_not_found";

    /// <summary>This person holds no key for this survey, so there is nothing to withdraw.</summary>
    public const string NoCredential = "no_credential";

    /// <summary>
    /// They have already answered -- wholly or in part. Withdrawing the key would not withdraw
    /// the response, and what to do with a response that should never have existed is a
    /// results decision, not an access one.
    /// </summary>
    public const string HasResponses = "has_responses";
}

/// <param name="HadSignedIn">
/// Whether the withdrawn key had ever been used. True is not a refusal, it is a WARNING the
/// screen must pass on: sessions are stamped per USER, not per credential, so a person who
/// already signed in with this key may keep the survey open until that session expires. See
/// the remarks on <see cref="SurveyCredentialEndpoints"/> for why it is not ended here.
/// </param>
/// <param name="IssuedOn">The day the withdrawn key had been issued, in the company's zone.</param>
public sealed record SurveyCredentialRevokeResult(
    Guid SurveyId,
    Guid UserId,
    string Username,
    bool HadSignedIn,
    DateOnly IssuedOn);

/// <param name="Delivered">
/// Whether the new key reached somebody: its email left, or -- for a handover -- it is in this
/// response. When false (email only), the OLD key was put back and still works.
/// </param>
/// <param name="FailureReason">The transport's own reason when the send failed; null when it went.</param>
/// <param name="IssuedOn">
/// The day the key now in force was issued, in the company's zone -- a DAY, never an instant,
/// for the reason <see cref="SurveyRosterRow"/> gives. Today on success; the original day when
/// the send failed and the old key was restored.
/// </param>
/// <param name="Delivery">Which of <see cref="SurveyCredentialDeliveries"/> was used.</param>
/// <param name="Password">
/// The new password, for a handover ONLY, and only in this one response: nothing stores the
/// plaintext and nothing can read it back. Null for an email delivery.
/// </param>
/// <param name="HadSignedIn">
/// The replaced key had been used to sign in (only possible with <c>replaceUsedKey</c>). A WARNING
/// for the screen: a session opened with the old password stays open until it expires.
/// </param>
public sealed record SurveyCredentialReissueResult(
    Guid SurveyId,
    Guid UserId,
    string Username,
    bool Delivered,
    string? FailureReason,
    DateOnly IssuedOn,
    string Delivery = SurveyCredentialDeliveries.Email,
    string? Password = null,
    bool HadSignedIn = false);

/// <summary>
/// <c>POST /surveys/{surveyId}/credentials/{userId}/reissue</c>: send ONE person a new
/// password for ONE survey's key -- the route the October launches did not have.
/// </summary>
/// <remarks>
/// <para>
/// In a <c>per_survey</c> survey the plaintext of a key exists only until it is mailed, so a
/// person who lost the email has nothing anyone can read back. The invite step skips anyone
/// who already holds a key (re-minting would silently invalidate a password somebody is
/// using), and the account resend refuses an account with no username, which is every
/// per-survey person. On 21 Oct 2026 this was done twice by hand: a guarded
/// <c>DELETE FROM survey_credentials … WHERE last_sign_in_at IS NULL</c>, then re-inviting the
/// one address.
/// </para>
/// <para>
/// This keeps that recipe's guard and drops its gap. It refuses a key that has been used
/// (<see cref="SurveyCredential.LastSignInAt"/> set) -- the person has it, and replacing it
/// would lock them out of a survey they may be halfway through -- and it rotates the password
/// in place instead of deleting the row, so the username the admin reads out on the phone does
/// not change and there is never a moment when the person holds no key at all.
/// </para>
/// <para>
/// <b>Save, then send, then restore on failure.</b> The new hash is written first because a
/// mailed password that no row backs would sign nobody in. If the mail does not leave, the old
/// hash goes back: the person is exactly as they were, the response says so, and the admin can
/// try again. The write is conditional on the key still being unused, so a sign-in that lands
/// between the read and the write wins and the reissue is refused.
/// </para>
/// <para>
/// Sessions are not a concern here precisely because of that guard: a key that has never
/// signed in has opened no session to end (see the warning on <see cref="SurveyCredential"/>).
/// </para>
/// <para>
/// Administrators only, by <see cref="SurveyEndpoints.CanAdminister"/>: a super_admin, or the
/// company_admin of the survey's own company. Every call -- refused or not -- is written to
/// <c>audit_logs</c> by the audit middleware; the handler adds the person and the outcome.
/// </para>
/// </remarks>

/// <summary>
/// Why a reminder was refused. Separate from the reissue and revoke lists although some values
/// coincide: the three routes are different contracts. Notably there is NO
/// <c>already_signed_in</c> here -- somebody who has signed in is exactly who this route is for,
/// and they are the people the other two refuse.
/// </summary>
public static class SurveyCredentialRemindRefusals
{
    /// <summary>The survey hands out one account per person (<c>shared</c>); there is no per-survey key to remind anyone about.</summary>
    public const string NotPerSurvey = "not_per_survey";

    /// <summary>The survey is a draft, closed, archived, or past its end date: there is nothing left to finish.</summary>
    public const string SurveyNotOpen = "survey_not_open";

    /// <summary>No such account in this survey's company.</summary>
    public const string UserNotFound = "user_not_found";

    /// <summary>The account is deactivated: sign-in refuses it, so chasing its holder is pointless.</summary>
    public const string UserInactive = "user_inactive";

    /// <summary>The account is not in the survey's audience, so it has nothing to finish.</summary>
    public const string NotInAudience = "not_in_audience";

    /// <summary>Nobody minted a key for this person yet, so there is no access to remind them of; they need an invitation instead.</summary>
    public const string NoCredential = "no_credential";

    /// <summary>They already finished. Chasing somebody who has answered is how a survey loses the trust of the people who did what was asked.</summary>
    public const string AlreadyCompleted = "already_completed";
}

/// <param name="Delivered">
/// Whether the mail left. False is not a refusal: nothing was changed either way, because a
/// reminder writes nothing at all -- which is the difference between this route and a reissue.
/// </param>
/// <param name="RemindedOn">
/// The calendar day, in the company's zone, of the most recent DELIVERED reminder for this key
/// -- this one when it got through, the previous one when it did not, and null when none ever
/// has. A day rather than an instant, to match every other date the roster publishes.
/// </param>
/// <param name="ReminderCount">
/// How many reminders have now been delivered for this key, including this one. Unchanged from
/// what it was when the send failed.
/// </param>
public sealed record SurveyCredentialRemindResult(
    Guid SurveyId, Guid UserId, string Username, bool Delivered, string? FailureReason,
    DateOnly? RemindedOn = null, int ReminderCount = 0);

public static class SurveyCredentialEndpoints
{
    public static void MapSurveyCredentialEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        var group = app.MapGroup("/surveys").RequireAuthorization();
        group.MapPost("/{surveyId:guid}/credentials/{userId:guid}/reissue", ReissueAsync);
        group.MapPost("/{surveyId:guid}/credentials/{userId:guid}/remind", RemindAsync);
        group.MapDelete("/{surveyId:guid}/credentials/{userId:guid}", RevokeAsync);
    }

    /// <summary>
    /// <c>DELETE /surveys/{surveyId}/credentials/{userId}</c>: withdraw a key that should never
    /// have been sent, closing ONE survey to ONE person.
    /// </summary>
    /// <remarks>
    /// <para>
    /// On 2026-10-28 ten ESPH people were mailed a Clima key by mistake. The repair was
    /// <c>esph-quitar-clave-clima-mal-enviadas.sql</c>, and the product had no equivalent: the
    /// reissue route can REPLACE a key but nothing could take one away. Deactivating the
    /// account was the only in-product lever and it is the wrong one -- it removes the person
    /// from every survey, and those ten were legitimately mid-Teletrabajo.
    /// </para>
    /// <para>
    /// <b>Why this is the lever, rather than editing the audience.</b> Clima is targeted by
    /// DEPARTMENT, so there is no list of people to remove anybody from -- the audience is
    /// whoever is in those departments. For a department-targeted survey the key IS the access,
    /// so withdrawing it is the only way to close one survey to one person while leaving their
    /// other surveys alone.
    /// </para>
    /// <para>
    /// <b>What it deliberately does not touch</b>, each because the October recipe did not
    /// either and said why: the ACCOUNT (they keep signing in to their other surveys with those
    /// keys), the AUDIENCE (a department-targeted survey has no list to edit, and editing one
    /// would move the participation denominator), the INVITATION row (it moves the report's
    /// numbers, which is a separate decision), and the mail already sent, which cannot be
    /// unsent.
    /// </para>
    /// <para>
    /// <b>It refuses a person who has answered</b>, wholly or in part. Withdrawing the key does
    /// not withdraw the response, and a response that should never have existed is a results
    /// question -- which is exactly the decision ESPH was left with for one person on 28 Oct.
    /// Refusing here keeps the two apart instead of half-doing both.
    /// </para>
    /// <para>
    /// <b>It does NOT refuse a key that has been used</b>, and that is the one place it differs
    /// from reissue. Reissue refuses, because replacing a key somebody is holding locks them
    /// out of a survey they may be part-way through. Here being locked out is the POINT. The
    /// used case is reported rather than refused, as <c>hadSignedIn</c>.
    /// </para>
    /// <para>
    /// <b>The session is not ended, on purpose.</b> A JWT carries <c>user.SecurityStamp</c>, so
    /// as <see cref="SurveyCredential"/> warns, there is no way to end a session opened with
    /// ONE credential without ending that person's other sessions too. Signing somebody out of
    /// Teletrabajo to undo a Clima mistake is the wrong trade, and they would simply sign in
    /// again with the Teletrabajo key. So the row goes, future sign-ins with it are refused,
    /// and a live session is reported to the caller instead of being silently survived. The
    /// damaging case -- already answering -- is the one the response guard above refuses.
    /// </para>
    /// <para>
    /// Any survey status is allowed: a mis-send is often noticed after the window has closed,
    /// and withdrawing the key is how the roster stops showing it as outstanding.
    /// </para>
    /// </remarks>
    private static async Task<IResult> RevokeAsync(
        Guid surveyId,
        Guid userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        audit.SetResourceId($"{surveyId}/{userId}");

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId))
        {
            return Results.Forbid();
        }

        await AttributeToSurveyCompanyAsync(audit, principal.GetCurrentUser(), survey.CompanyId, db, cancellationToken);

        if ((survey.Settings.CredentialMode ?? CredentialModes.Shared) != CredentialModes.PerSurvey)
        {
            return Refuse(
                409, SurveyCredentialRevokeRefusals.NotPerSurvey,
                "This survey uses shared accounts, not per-survey keys; there is no key to withdraw. Deactivate the account, or take the person out of the audience.");
        }

        var userExists = await db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.CompanyId == survey.CompanyId, cancellationToken);
        if (!userExists)
        {
            return Refuse(404, SurveyCredentialRevokeRefusals.UserNotFound, "No such person in this survey's company.");
        }

        var credential = await db.SurveyCredentials
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.SurveyId == surveyId && c.UserId == userId, cancellationToken);
        if (credential is null)
        {
            return Refuse(
                409, SurveyCredentialRevokeRefusals.NoCredential,
                "This person holds no key for this survey, so there is nothing to withdraw.");
        }

        // ANY response, complete or not -- the October recipe's second guard, and its reason:
        // "si alguien contesto, hay que decidirlo a mano, no borrarle nada".
        var hasResponses = await db.Responses.IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .AsNoTracking()
            .AnyAsync(r => r.SurveyId == surveyId && r.UserId == userId, cancellationToken);
        if (hasResponses)
        {
            return Refuse(
                409, SurveyCredentialRevokeRefusals.HasResponses,
                "This person has already answered this survey. Withdrawing the key would not withdraw the response; decide what happens to the response first.");
        }

        // Conditional on the row still being the one that was read, so a reissue that lands
        // between the read and the write does not get silently deleted by this call: the
        // password hash is what a reissue rotates.
        var removed = await db.SurveyCredentials
            .Where(c => c.SurveyId == surveyId && c.UserId == userId && c.PasswordHash == credential.PasswordHash)
            .ExecuteDeleteAsync(cancellationToken);
        if (removed != 1)
        {
            return Refuse(
                409, SurveyCredentialRevokeRefusals.NoCredential,
                "This person's key changed while the request was in flight; read the roster again and retry.");
        }

        audit.RecordChange("credential", credential.Username, "revoked");

        var zone = SchedulingTimeZone.Resolve(await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => c.Settings.Timezone)
            .FirstOrDefaultAsync(cancellationToken));

        return Results.Ok(new SurveyCredentialRevokeResult(
            surveyId,
            userId,
            credential.Username,
            credential.LastSignInAt is not null,
            DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(credential.CreatedAt, zone))));
    }

    private static async Task<IResult> ReissueAsync(
        Guid surveyId,
        Guid userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        ICredentialsEmailSender credentialsSender,
        AuditEntry audit,
        HttpContext httpContext,
        CancellationToken cancellationToken,
        SurveyCredentialReissueRequest? request = null)
    {
        audit.SetResourceId($"{surveyId}/{userId}");

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        var currentUser = principal.GetCurrentUser();
        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        await AttributeToSurveyCompanyAsync(audit, currentUser, survey.CompanyId, db, cancellationToken);

        var delivery = request?.Delivery ?? SurveyCredentialDeliveries.Email;
        if (delivery is not (SurveyCredentialDeliveries.Email or SurveyCredentialDeliveries.Handover))
        {
            return Refuse(
                400, SurveyCredentialReissueRefusals.UnknownDelivery,
                $"delivery must be '{SurveyCredentialDeliveries.Email}' or '{SurveyCredentialDeliveries.Handover}'.");
        }

        var handover = delivery == SurveyCredentialDeliveries.Handover;
        var replaceUsedKey = request?.ReplaceUsedKey ?? false;

        // Both options put a working password somewhere other than its holder's own inbox, or take
        // one from somebody who has used it. A company that could do either could sign in as its
        // own employee to a survey promised to be anonymous to it -- see the request's remarks.
        if ((handover || replaceUsedKey) && currentUser.Role != Roles.SuperAdmin)
        {
            return Refuse(
                403, SurveyCredentialReissueRefusals.SuperAdminOnly,
                "Only a super admin may receive a password to hand over in person, or replace a key that has been used.");
        }

        if ((survey.Settings.CredentialMode ?? CredentialModes.Shared) != CredentialModes.PerSurvey)
        {
            return Refuse(
                409, SurveyCredentialReissueRefusals.NotPerSurvey,
                "This survey uses shared accounts, not per-survey keys; resend the person's account credentials instead.");
        }

        var now = DateTimeOffset.UtcNow;
        if (!SurveyStatuses.RespondentVisible.Contains(survey.Status, StringComparer.Ordinal) || survey.EndDate <= now)
        {
            return Refuse(
                409, SurveyCredentialReissueRefusals.SurveyNotOpen,
                $"A survey in status '{survey.Status}' that ends {survey.EndDate:O} is not open; a new key to it would open nothing.");
        }

        var user = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId && u.CompanyId == survey.CompanyId)
            .Select(u => new { u.Id, u.Email, u.Name, u.IsActive })
            .FirstOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return Refuse(404, SurveyCredentialReissueRefusals.UserNotFound, "No such person in this survey's company.");
        }

        if (!user.IsActive)
        {
            return Refuse(
                409, SurveyCredentialReissueRefusals.UserInactive,
                "This account is deactivated; sign-in refuses it whatever key it holds. Reactivate it first.");
        }

        var inAudience = await SurveyQueries
            .Audience(db.Users.AsNoTracking(), db.SurveyDepartmentTargets, db.SurveyUserTargets, surveyId, survey.CompanyId)
            .AnyAsync(u => u.Id == userId, cancellationToken);
        if (!inAudience)
        {
            return Refuse(
                409, SurveyCredentialReissueRefusals.NotInAudience,
                "This person is not in the survey's audience, so a key to it would open nothing.");
        }

        var credential = await db.SurveyCredentials
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.SurveyId == surveyId && c.UserId == userId, cancellationToken);
        if (credential is null)
        {
            return Refuse(
                409, SurveyCredentialReissueRefusals.NoCredential,
                "This person holds no key for this survey yet. Invite them (POST /surveys/{id}/invitations), which mints and mails one.");
        }

        var hadSignedIn = credential.LastSignInAt is not null;
        if (hadSignedIn && !replaceUsedKey)
        {
            return AlreadySignedIn();
        }

        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new
            {
                Mail = new SurveyCredentialCompany(
                    c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor, c.Settings.Timezone),
                c.Settings.Timezone,
            })
            .FirstOrDefaultAsync(cancellationToken);
        var zone = SchedulingTimeZone.Resolve(company?.Timezone);

        var (password, newHash) = SurveyCredentialIssuance.NewPassword(passwordHasher);

        // Conditional in the statement that writes it. Normally on the key still being unused: a
        // sign-in that lands after the read above wins, and this refuses rather than locking them
        // out. When a used key is being replaced on purpose, a sign-in is no reason to stop -- but
        // another rotation in flight is, so the condition becomes "still the key that was read".
        var rotated = replaceUsedKey
            ? await db.SurveyCredentials
                .Where(c => c.SurveyId == surveyId && c.UserId == userId && c.PasswordHash == credential.PasswordHash)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(c => c.PasswordHash, newHash).SetProperty(c => c.CreatedAt, now),
                    cancellationToken)
            : await db.SurveyCredentials
                .Where(c => c.SurveyId == surveyId && c.UserId == userId && c.LastSignInAt == null)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(c => c.PasswordHash, newHash).SetProperty(c => c.CreatedAt, now),
                    cancellationToken);
        if (rotated != 1)
        {
            return replaceUsedKey
                ? Refuse(
                    409, SurveyCredentialReissueRefusals.NoCredential,
                    "This person's key changed while the request was in flight; read the roster again and retry.")
                : AlreadySignedIn();
        }

        if (handover)
        {
            // Nothing is mailed, so there is nothing to fail and nothing to restore: the key now in
            // force is the one in this response. It must not be cached by anything in between.
            httpContext.Response.Headers.CacheControl = "no-store";
            httpContext.Response.Headers.Pragma = "no-cache";
            audit.RecordChange("credential", null, hadSignedIn ? "handed_over_replacing_used_key" : "handed_over");

            return Results.Ok(new SurveyCredentialReissueResult(
                surveyId,
                userId,
                credential.Username,
                Delivered: true,
                FailureReason: null,
                DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(now, zone)),
                SurveyCredentialDeliveries.Handover,
                password,
                hadSignedIn));
        }

        var outcome = await SurveyCredentialIssuance.SendAsync(
            credentialsSender,
            SurveyCredentialIssuance.MailFor(survey, company?.Mail),
            user.Email, user.Name, credential.Username, password, cancellationToken);

        if (!outcome.Delivered)
        {
            // The new password's only copy never left, so it is a key nobody holds. Put the old
            // one back -- conditional on the row still carrying the hash this call wrote -- so
            // the person is exactly as they were and the admin is told so. CancellationToken.None:
            // a caller who gives up mid-request must not leave the person holding nothing.
            await db.SurveyCredentials
                .Where(c => c.SurveyId == surveyId && c.UserId == userId && c.PasswordHash == newHash)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(c => c.PasswordHash, credential.PasswordHash)
                        .SetProperty(c => c.CreatedAt, credential.CreatedAt),
                    CancellationToken.None);
        }

        audit.RecordChange(
            "credential",
            null,
            !outcome.Delivered ? "send_failed_restored" : hadSignedIn ? "reissued_replacing_used_key" : "reissued");

        return Results.Ok(new SurveyCredentialReissueResult(
            surveyId,
            userId,
            credential.Username,
            outcome.Delivered,
            outcome.Delivered ? null : outcome.FailureReason,
            DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(outcome.Delivered ? now : credential.CreatedAt, zone)),
            SurveyCredentialDeliveries.Email,
            Password: null,
            HadSignedIn: outcome.Delivered && hadSignedIn));
    }

    /// <summary>
    /// <c>POST /surveys/{surveyId}/credentials/{userId}/remind</c>: ask ONE person to go in and
    /// finish, WITHOUT minting anything.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Asked for by ESPH on 2026-10-30, in these words: *"hay forma de enviar recordatorio? no
    /// otro usuario o contraseña solo recordatorio?"* -- with a list of seven people whose Clima
    /// survey was <c>Pendiente Finalizar</c>. Until this route there was no way to do it. The
    /// reminder behind <c>POST /invitations/reminders</c> returns zeroes (its mail was ruled out
    /// on 2026-10-19) and, even restored, reminds INVITATIONS, which a respondent signing in with
    /// a username never creates. The only live chase, <see cref="CredentialsEmailPurpose.Reminder"/>,
    /// states in its own copy that the previous password stops working. So the people most worth
    /// chasing -- the ones already part-way through -- were the only ones nothing could reach.
    /// </para>
    /// <para>
    /// <b>It writes nothing.</b> No hash, no timestamp, no row. That is the point: the person is
    /// holding working details and this must not disturb them. A failed send is therefore not a
    /// half-done state and needs no restore, unlike <see cref="ReissueAsync"/>.
    /// </para>
    /// <para>
    /// <b>One person per call, named by the caller.</b> There is deliberately no "remind everyone
    /// outstanding": a send list holds only the people the client asked for, and an endpoint that
    /// fans out over a roster is one mistaken click from mailing six hundred people.
    /// </para>
    /// </remarks>
    private static async Task<IResult> RemindAsync(
        Guid surveyId,
        Guid userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ISurveyReminderEmailSender reminderSender,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        audit.SetResourceId($"{surveyId}/{userId}");

        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId))
        {
            return Results.Forbid();
        }

        await AttributeToSurveyCompanyAsync(audit, principal.GetCurrentUser(), survey.CompanyId, db, cancellationToken);

        if ((survey.Settings.CredentialMode ?? CredentialModes.Shared) != CredentialModes.PerSurvey)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.NotPerSurvey,
                "This survey uses shared accounts, not per-survey keys.");
        }

        var now = DateTimeOffset.UtcNow;
        if (!SurveyStatuses.RespondentVisible.Contains(survey.Status, StringComparer.Ordinal) || survey.EndDate <= now)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.SurveyNotOpen,
                $"A survey in status '{survey.Status}' that ends {survey.EndDate:O} is not open; there is nothing left to finish.");
        }

        var user = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId && u.CompanyId == survey.CompanyId)
            .Select(u => new { u.Id, u.Email, u.Name, u.IsActive })
            .FirstOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return Refuse(404, SurveyCredentialRemindRefusals.UserNotFound, "No such person in this survey's company.");
        }

        if (!user.IsActive)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.UserInactive,
                "This account is deactivated; sign-in refuses it whatever key it holds. Reactivate it first.");
        }

        var inAudience = await SurveyQueries
            .Audience(db.Users.AsNoTracking(), db.SurveyDepartmentTargets, db.SurveyUserTargets, surveyId, survey.CompanyId)
            .AnyAsync(u => u.Id == userId, cancellationToken);
        if (!inAudience)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.NotInAudience,
                "This person is not in the survey's audience, so they have nothing to finish.");
        }

        var credential = await db.SurveyCredentials
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.SurveyId == surveyId && c.UserId == userId, cancellationToken);
        if (credential is null)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.NoCredential,
                "This person holds no key for this survey, so there is no access to remind them of. Invite them (POST /surveys/{id}/invitations), which mints and mails one.");
        }

        // Refused rather than silently skipped: an admin working from a roster that is minutes
        // old is exactly who calls this, and two of ESPH's seven had already finished by the
        // time their list was read. Telling them so is more useful than a quiet no-op.
        var finished = await db.Responses.IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .AsNoTracking()
            .AnyAsync(r => r.SurveyId == surveyId && r.UserId == userId && r.IsComplete, cancellationToken);
        if (finished)
        {
            return Refuse(
                409, SurveyCredentialRemindRefusals.AlreadyCompleted,
                "This person has already finished this survey; there is nothing to remind them about.");
        }

        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new
            {
                Mail = new SurveyCredentialCompany(
                    c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor, c.Settings.Timezone),
                c.Settings.Timezone,
            })
            .FirstOrDefaultAsync(cancellationToken);
        var zone = SchedulingTimeZone.Resolve(company?.Timezone);
        var mail = SurveyCredentialIssuance.MailFor(survey, company?.Mail);

        var outcome = await reminderSender.SendAsync(
            user.Email, user.Name, credential.Username, mail.CompanyLanguage,
            mail.Brand, mail.SurveyTitle, cancellationToken);

        // Stamped only on a DELIVERED reminder, and only after the send. Unlike reissue there is
        // no secret that has to exist before the mail leaves, so there is nothing to put back
        // when it fails -- a failed send leaves the row exactly as it was and the roster goes on
        // reading "never reminded", which is the truth. Writing the stamp first and rolling it
        // back would invent a state that briefly lies in both directions.
        var remindedAt = credential.LastRemindedAt;
        var reminderCount = credential.ReminderCount;
        if (outcome.Delivered)
        {
            // `reminder_count + 1` is computed IN the database rather than from the value read
            // above. Two operators working the same roster at once -- which is the normal case
            // when a client sends a list of names -- would otherwise both write the same number
            // and one of the two reminders would vanish from the count.
            await db.SurveyCredentials
                .Where(c => c.SurveyId == surveyId && c.UserId == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(c => c.LastRemindedAt, now)
                        .SetProperty(c => c.ReminderCount, c => c.ReminderCount + 1),
                    cancellationToken);
            remindedAt = now;
            reminderCount += 1;
        }

        audit.RecordChange("reminder", null, outcome.Delivered ? "sent" : "send_failed");

        return Results.Ok(new SurveyCredentialRemindResult(
            surveyId, userId, credential.Username, outcome.Delivered,
            outcome.Delivered ? null : outcome.FailureReason,
            remindedAt is { } stamp ? DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(stamp, zone)) : null,
            reminderCount));
    }

    /// <summary>
    /// File the audit row under the survey's company. Without this, a call by a company-less
    /// super_admin -- which is every TIMS operator -- resolves to no company, and the audit
    /// middleware writes NO row at all (<c>audit_logs.company_id</c> is NOT NULL; see
    /// <c>AuditWritingMiddleware.ResolveActorAsync</c>). Measured 3 Nov 2026 while adding the
    /// in-person handover: the test for its audit row found none. Every reissue, reminder and
    /// revoke TIMS did on a client's keys was therefore off the trail. A company_admin resolves
    /// to the same company either way, so their rows do not change.
    /// </summary>
    private static async Task AttributeToSurveyCompanyAsync(
        AuditEntry audit, CurrentUser currentUser, Guid companyId, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        if (await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, companyId);
        }
    }

    private static IResult AlreadySignedIn() => Refuse(
        409, SurveyCredentialReissueRefusals.AlreadySignedIn,
        "This person has already signed in with this key, so they have it. A new one would lock them out of a survey they may be part-way through.");

    private static IResult Refuse(int status, string code, string message)
        => Results.Json(new { message, code }, statusCode: status);
}
