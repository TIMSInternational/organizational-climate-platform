using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// What a survey is the moment it is created, before its author has said anything about it.
///
/// ONE function, called by every path that creates a survey from nothing: <c>POST /surveys</c>
/// (<c>SurveyEndpoints.CreateAsync</c>) and <c>POST /survey-templates/{id}/use</c> (through
/// <see cref="SurveyTemplateInstantiation"/>). Until 2026-10-22 the second path built its survey
/// on the entity's own defaults -- not anonymous, no frozen credential mode, invitation and
/// reminder mail on -- so a template-built survey's public link refused every signed-out
/// respondent (audit gap G15). Two copies of these four lines is how that happened; one copy
/// is how it stays fixed.
///
/// Duplication (<see cref="SurveyDuplication"/>) deliberately does NOT call this: a duplicate
/// copies its source's settings, which are a decision somebody already made.
///
/// The entity defaults themselves (<see cref="SurveySettings"/>) stay as they are. They are
/// the legacy shape, and changing them would silently re-read every row materialised without
/// the flag.
/// </summary>
public static class NewSurveyDefaults
{
    /// <summary>
    /// Writes the new-survey defaults onto <paramref name="settings"/>. Call it BEFORE applying
    /// anything the caller asked for, so an explicit request still wins.
    /// </summary>
    /// <param name="settings">The new survey's settings.</param>
    /// <param name="requestedCredentialMode">The survey's own choice, if the caller made one.</param>
    /// <param name="companyCredentialMode">The owning company's mode.</param>
    public static void Apply(SurveySettings settings, string? requestedCredentialMode, string? companyCredentialMode)
    {
        ArgumentNullException.ThrowIfNull(settings);

        // Anonymous unless the caller says otherwise. Respondents never log in (ruled
        // 2026-10-12), and an unauthenticated respondent can answer ONLY an anonymous survey
        // (`ResolveRespondentAsync`), so a survey created without a word about it must be one
        // they can answer.
        settings.Anonymous = true;

        // Survey's own choice, else the company's, else `shared` -- resolved HERE and frozen
        // onto the row, exactly as `language` is. Null would have meant "inherit", and
        // resolving at read time would let a company settings change re-shape a survey whose
        // credentials have already been mailed, and credentials are mailed exactly once.
        settings.CredentialMode = CredentialModes.Resolve(requestedCredentialMode, companyCredentialMode);

        // Who answered is NOT asked. The 2026-10-12 ruling that put a name and email step on
        // every new survey was superseded on 2026-10-13: there are three ways to answer -- a
        // mass invite with a generated username and password, a climate QR that asks
        // demographics and nothing else, and a microclimate link that asks nothing -- and
        // "name and email are NEVER collected directly" holds in all three. So nothing is set
        // here: the entity default (false) is now also the product's answer, and
        // SurveyResponseEndpoints.AsksParticipantIdentity refuses the step for the surveys
        // already carrying the column true.

        // NO INVITATION EMAIL. Ruled 2026-10-19 by Federico, from the rehearsal's own mail:
        // "we ONLY WANT THE ONE WITH THE CODE... it opens up the survey without them needing
        // to log in. This should never happen."
        //
        // Three measurements make it the right default rather than a preference.
        //
        // It is a SECOND DOOR. The invitation mail's button is `/survey-invitations/{token}`,
        // and `SurveyInvitationPage` renders the respond form with `publicEntry` set "even
        // though this visitor is named" -- so the holder answers as that person without
        // signing in. On a mass invite, where the platform generated a username and a
        // password for everyone (ruled 2026-10-13), that is a third way in that nobody
        // designed, and it travels with a forwarded email.
        //
        // It is a DUPLICATE. `CredentialsEmailComposer` already says "Tu organizacion te
        // invita a responder una encuesta. Inicia sesion con el usuario y la contrasena de
        // abajo" over a sign-in button. The same rehearsal's FIRST finding (2026-10-17) was
        // that duplicated access instructions read as two different accounts: "Ingreso con
        // los accesos de arriba o los de abajo?".
        //
        // And it COSTS NO TRACKING, which is the part that looks like it should block this.
        // `SurveyInvitationStatuses.AnonymityCeiling` is `opened`, so on an anonymous survey
        // -- every climate survey this product sends -- `started` and `completed` are never
        // persisted and `AdvanceInvitationAsync` returns before it writes. The only state an
        // invitation could record is `opened`, which happens when somebody opens the mail
        // this removes. Participation is `surveys.response_count` against
        // `target_audience_count`, an aggregate, which is the only shape of that number that
        // names nobody.
        //
        // A tenant that wants the mail turns it on per survey -- `ApplySettings` still honours
        // it, and `POST /invitations/{id}/resend` is still a deliberate act.
        settings.NotificationSendInvitations = false;

        // And no reminder mail, for the same sentence: "just one email, with the credentials
        // to login". A reminder is a SECOND message to the same person, and on an ANONYMOUS
        // survey it is one that cannot even be correct -- `InvitationReminderJob` selects on
        // `completed_on IS NULL`, and `SurveyInvitationStatuses.AnonymityCeiling` forbids
        // ever writing that column there, so every invitee stays a reminder candidate for the
        // whole window however many of them have answered.
        //
        // Still a per-survey setting, not a removal: a three-week window with a nudge at day
        // three is a reasonable thing for a tenant to ask for, and `ApplySettings` honours it.
        // What changes is that nobody gets one by default.
        settings.NotificationSendReminders = false;
    }
}
