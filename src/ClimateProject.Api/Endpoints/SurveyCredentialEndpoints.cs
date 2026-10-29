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
public static class SurveyCredentialEndpoints
{
    public static void MapSurveyCredentialEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapGroup("/surveys")
            .RequireAuthorization()
            .MapPost("/{surveyId:guid}/credentials/{userId:guid}/reissue", ReissueAsync);
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
                Mail = new SurveyCredentialCompany(
                    c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor, c.Settings.Timezone),
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

    private static IResult AlreadySignedIn() => Refuse(
        409, SurveyCredentialReissueRefusals.AlreadySignedIn,
        "This person has already signed in with this key, so they have it. A new one would lock them out of a survey they may be part-way through.");

    private static IResult Refuse(int status, string code, string message)
        => Results.Json(new { message, code }, statusCode: status);
}
