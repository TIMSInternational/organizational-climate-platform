using System.Globalization;
using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// A reminder that carries NO password: it asks one person to go in and finish, and tells them
/// the details they already hold still work.
///
/// <para>
/// **Why this exists beside <see cref="CredentialsEmailComposer"/>.** ESPH asked for it in these
/// words on 2026-10-30: *"hay forma de enviar recordatorio? no otro usuario o contraseña solo
/// recordatorio?"*. Every message the platform could send them until now minted a password:
/// <see cref="CredentialsEmailPurpose.Reminder"/>'s own copy says *"la anterior deja de
/// funcionar"*, because the only route behind it rotates the hash. For somebody who is MID-SURVEY
/// that is the wrong message and the wrong act -- they already signed in, the password in their
/// inbox works, and replacing it would lock them out of a questionnaire they are part-way through.
/// The reissue route refuses them for exactly that reason (<c>already_signed_in</c>), which left
/// the people the client most wants to chase as the only people the product could not write to.
/// </para>
/// <para>
/// **It is a separate composer rather than a third <see cref="CredentialsEmailPurpose"/>.** That
/// enum's contract is that *"both carry the same pair -- a username and a freshly generated
/// password"*, and a third value that carries no password would make a nullable password legal on
/// the invitation branch too. The invitation is live: 206 people received it on 2026-10-29. So
/// this message gets its own type and its own copy, and nothing on the credentials path changes.
/// </para>
/// <para>
/// **No password, by construction.** There is no parameter to pass one. The password cannot be
/// read back anyway -- only its hash is stored -- so a reminder is the only message the platform
/// can send that does not change somebody's access.
/// </para>
/// </summary>
public static class SurveyReminderEmailComposer
{
    /// <summary>The web route the sign-in button opens; the same one the credentials mail uses.</summary>
    public const string LoginPath = CredentialsEmailComposer.LoginPath;

    /// <param name="recipientName">
    /// **Accepted and deliberately never rendered**, for
    /// <see cref="CredentialsEmailComposer"/>'s reason, ruled 2026-10-16: every ESPH respondent
    /// has been told their company will never see their name beside their answers, and the mail
    /// chasing them for those answers must not be the counter-example. Guarded by
    /// <c>SurveyReminderEmailComposerTests.No_part_of_the_message_carries_the_recipients_name</c>.
    /// </param>
    /// <param name="username">
    /// Shown, and put on the link so the field arrives filled. It is not a secret -- the
    /// credentials mail prints it in plain text, and on its own it signs nobody in. The password
    /// is the secret, and this message does not have one to leak.
    /// </param>
    /// <param name="surveyName">
    /// Which survey is unfinished. Required in spirit for the reason the credentials mail states:
    /// somebody in Clima and Teletrabajo receives two of these and the subject is the only thing
    /// telling them apart. Null is accepted for `shared` mode, where naming one would be a lie.
    /// </param>
    public static EmailMessage Compose(
        string toEmail, string? recipientName, string username, string loginUrl,
        string? companyLanguage, EmailBrand? brand = null, string? surveyName = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toEmail);
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(loginUrl);

        // One language when the company has declared one; both only when it has not. Same rule,
        // and the same reason, as the credentials mail: ESPH's first rehearsal finding was that
        // a doubled message reads as two sets of details.
        var single = ContentLanguages.SingleLocaleOf(companyLanguage);
        var spanishFirst = single == ContentLanguages.Spanish;
        var first = CopyFor(spanish: spanishFirst);
        var second = single is null ? CopyFor(spanish: !spanishFirst) : null;

        var signInUrl = WithUsername(loginUrl, username);

        var html = new StringBuilder();
        AppendHtml(html, first, username, signInUrl, brand, surveyName);
        if (second is not null)
        {
            html.Append("""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;">""");
            AppendHtml(html, second, username, signInUrl, brand, surveyName);
        }

        html.Append(EmailBranding.Footer(EmailBranding.Escape(
            second is null ? first.Ignore : $"{first.Ignore} / {second.Ignore}")));

        var text = new StringBuilder();
        AppendText(text, first, username, signInUrl, surveyName);
        if (second is not null)
        {
            text.Append("\n--\n\n");
            AppendText(text, second, username, signInUrl, surveyName);
        }

        return new EmailMessage(
            toEmail,
            // Null, so the mail is addressed to the bare address. See `recipientName`.
            ToName: null,
            EmailMessage.ToHeaderValue(second is null
                ? Subject(first, surveyName, brand)
                : $"{Subject(first, surveyName, brand)} / {Subject(second, surveyName, brand)}"),
            text.Append("\n\n").Append(EmailBranding.Credit(single ?? ContentLanguages.FallbackLocale)).ToString(),
            EmailBranding.Document(single ?? ContentLanguages.FallbackLocale, html.ToString(), brand));
    }

    /// <summary>
    /// The survey and the employer, in that order, for the reason the credentials mail gives:
    /// the respondent is choosing between near-identical messages and the survey is what differs.
    /// </summary>
    private static string Subject(ReminderCopy copy, string? surveyName, EmailBrand? brand)
    {
        if (string.IsNullOrWhiteSpace(surveyName))
        {
            return copy.Subject;
        }

        var company = brand?.CompanyName;
        return string.IsNullOrWhiteSpace(company)
            ? $"{copy.SubjectPrefix} {surveyName.Trim()}"
            : $"{copy.SubjectPrefix} {surveyName.Trim()} — {company.Trim()}";
    }

    /// <summary>
    /// The sign-in link with the username on it, so the field arrives filled -- the fix for the
    /// respondent in ESPH's 2026-10-18 review who retyped <c>y</c> as <c>j</c> from a phone.
    /// Only the username goes on the query string; this message has no password to put there.
    /// </summary>
    private static string WithUsername(string loginUrl, string username)
    {
        var hash = loginUrl.IndexOf('#', StringComparison.Ordinal);
        var head = hash < 0 ? loginUrl : loginUrl[..hash];
        var fragment = hash < 0 ? string.Empty : loginUrl[hash..];
        var separator = head.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return $"{head}{separator}u={Uri.EscapeDataString(username)}{fragment}";
    }

    /// <summary>
    /// Which survey this is, as its own sentence, and ONLY when the name is known.
    ///
    /// <para>The subject already names it, but a subject truncates on a phone and is skimmed.
    /// The body is where it has to be said, because the confusion this message exists to cure is
    /// somebody believing they already answered: three ESPH respondents in October completed
    /// Clima and left Teletrabajo untouched for nine days apiece, each of them certain they were
    /// done. "La encuesta" to such a reader means the one they finished.</para>
    ///
    /// <para>Null in `shared` mode, where naming one survey would be a lie -- hence a separate
    /// sentence rather than a hole in the main paragraph needing a fallback.</para>
    /// </summary>
    private static string? WhichOne(ReminderCopy copy, string? surveyName)
        => string.IsNullOrWhiteSpace(surveyName)
            ? null
            : string.Format(CultureInfo.InvariantCulture, copy.WhichOne, surveyName.Trim());

    private static void AppendHtml(
        StringBuilder html, ReminderCopy copy, string username, string loginUrl, EmailBrand? brand,
        string? surveyName)
    {
        html.Append(EmailBranding.Heading(copy.Subject));
        html.Append(EmailBranding.Paragraphs(copy.Body));
        // Paragraphs escapes every line, so a client-authored survey title is safe here.
        html.Append(EmailBranding.Paragraphs(WhichOne(copy, surveyName)));
        html.Append("""<p style="margin:0 0 16px;font-size:15px;line-height:1.8;">""");
        html.Append(EmailBranding.Escape(copy.UsernameLabel)).Append(": ")
            .Append("""<strong style="font-family:Menlo,Consolas,monospace;font-size:16px;">""")
            .Append(EmailBranding.Escape(username)).Append("</strong>");
        html.Append("</p>");
        html.Append(EmailBranding.Button(loginUrl, copy.Cta, brand));
        html.Append(EmailBranding.Paragraphs(copy.Lost));
    }

    private static void AppendText(
        StringBuilder text, ReminderCopy copy, string username, string loginUrl, string? surveyName)
    {
        text.Append(copy.Subject).Append("\n\n");
        text.Append(copy.Body).Append("\n\n");
        if (WhichOne(copy, surveyName) is { } which) text.Append(which).Append("\n\n");
        text.Append(copy.UsernameLabel).Append(": ").Append(username).Append("\n\n");
        text.Append(copy.Cta).Append(": ").Append(loginUrl).Append("\n\n");
        text.Append(copy.Lost).Append('\n');
        text.Append(copy.Ignore).Append('\n');
    }

    /// <summary>
    /// Worded to be true for somebody who never opened it AND for somebody half-way through,
    /// because one route sends it to both and the platform cannot always tell which it is
    /// writing to -- on an anonymous survey it deliberately never records that anyone answered.
    /// It says in as many words that no new details are coming, which is the whole of the
    /// client's request.
    /// </summary>
    private static readonly ReminderCopy ReminderSpanish = new(
        Subject: "Recordatorio: te falta terminar la encuesta",
        SubjectPrefix: "Recordatorio: te falta terminar",
        Body: "Aún no hemos recibido tu respuesta. Tus datos de acceso son los mismos que te enviamos antes: no hay usuario ni contraseña nuevos. Entra con ellos y, si ya la habías empezado, continúa donde la dejaste.",
        UsernameLabel: "Usuario",
        WhichOne: "Es la encuesta «{0}». Si ya contestaste otra encuesta antes, esta es distinta.",
        Cta: "Entrar y terminar",
        Lost: "Si ya no encuentras el correo con tu contraseña, pídele a tu administrador que te envíe datos nuevos.",
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

    private static readonly ReminderCopy ReminderEnglish = new(
        Subject: "Reminder: your survey is unfinished",
        SubjectPrefix: "Reminder: unfinished survey",
        Body: "We have not received your response yet. Your sign-in details are the same ones we sent you before -- there is no new username or password. Sign in with those, and if you had already started, carry on where you left off.",
        UsernameLabel: "Username",
        WhichOne: "This is the “{0}” survey. If you have already answered a different one, this is not it.",
        Cta: "Sign in and finish",
        Lost: "If you can no longer find the message with your password, ask your administrator to send you new details.",
        Ignore: "If you were not expecting this message you can ignore it.");

    private static ReminderCopy CopyFor(bool spanish) => spanish ? ReminderSpanish : ReminderEnglish;

    /// <summary>
    /// Deliberately has no <c>PasswordLabel</c>. There is nowhere in this type to put a password,
    /// which is what stops one arriving here by a later edit.
    /// </summary>
    private sealed record ReminderCopy(
        string Subject, string Body, string UsernameLabel,
        /// <summary>Names the survey, with <c>{0}</c> for its title. Rendered only when known.</summary>
        string WhichOne,
        string Cta, string Lost, string Ignore,
        string SubjectPrefix = "");
}
