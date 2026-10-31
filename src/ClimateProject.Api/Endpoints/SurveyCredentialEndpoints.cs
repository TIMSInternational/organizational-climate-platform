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
}

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

/// <param name="Delivered">Whether the new key's email left. When false, the OLD key was put back and still works.</param>
/// <param name="FailureReason">The transport's own reason when the send failed; null when it went.</param>
/// <param name="IssuedOn">
/// The day the key now in force was issued, in the company's zone -- a DAY, never an instant,
/// for the reason <see cref="SurveyRosterRow"/> gives. Today on success; the original day when
/// the send failed and the old key was restored.
/// </param>
public sealed record SurveyCredentialReissueResult(
    Guid SurveyId,
    Guid UserId,
    string Username,
    bool Delivered,
    string? FailureReason,
    DateOnly IssuedOn);

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
public sealed record SurveyCredentialRemindResult(
    Guid SurveyId, Guid UserId, string Username, bool Delivered, string? FailureReason);

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
        var hasResponses = await db.Responses
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

        if (credential.LastSignInAt is not null)
        {
            return AlreadySignedIn();
        }

        var company = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new
            {
                Mail = new SurveyCredentialCompany(c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor),
                c.Settings.Timezone,
            })
            .FirstOrDefaultAsync(cancellationToken);
        var zone = SchedulingTimeZone.Resolve(company?.Timezone);

        var (password, newHash) = SurveyCredentialIssuance.NewPassword(passwordHasher);

        // Conditional on the key still being unused, in the statement that writes it: a sign-in
        // that lands after the read above wins, and this refuses rather than locking them out.
        var rotated = await db.SurveyCredentials
            .Where(c => c.SurveyId == surveyId && c.UserId == userId && c.LastSignInAt == null)
            .ExecuteUpdateAsync(
                set => set.SetProperty(c => c.PasswordHash, newHash).SetProperty(c => c.CreatedAt, now),
                cancellationToken);
        if (rotated != 1)
        {
            return AlreadySignedIn();
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

        audit.RecordChange("credential", null, outcome.Delivered ? "reissued" : "send_failed_restored");

        return Results.Ok(new SurveyCredentialReissueResult(
            surveyId,
            userId,
            credential.Username,
            outcome.Delivered,
            outcome.Delivered ? null : outcome.FailureReason,
            DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(outcome.Delivered ? now : credential.CreatedAt, zone))));
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
        var finished = await db.Responses
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
            .Select(c => new SurveyCredentialCompany(c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor))
            .FirstOrDefaultAsync(cancellationToken);
        var mail = SurveyCredentialIssuance.MailFor(survey, company);

        var outcome = await reminderSender.SendAsync(
            user.Email, user.Name, credential.Username, mail.CompanyLanguage,
            mail.Brand, mail.SurveyTitle, cancellationToken);

        audit.RecordChange("reminder", null, outcome.Delivered ? "sent" : "send_failed");

        return Results.Ok(new SurveyCredentialRemindResult(
            surveyId, userId, credential.Username, outcome.Delivered,
            outcome.Delivered ? null : outcome.FailureReason));
    }

    private static IResult AlreadySignedIn() => Refuse(
        409, SurveyCredentialReissueRefusals.AlreadySignedIn,
        "This person has already signed in with this key, so they have it. A new one would lock them out of a survey they may be part-way through.");

    private static IResult Refuse(int status, string code, string message)
        => Results.Json(new { message, code }, statusCode: status);
}
