using System.Globalization;
using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// The mass-invite email: the sign-in link, the username and the password a mass invite
/// generated for one person (ruled 2026-10-13).
///
/// <para>
/// **One language when the company has declared one; both only when it has not.** Both
/// languages in one message was right while the only fact available was that the account had
/// been created from a spreadsheet row a moment ago and its holder had chosen no language. It
/// is wrong once the COMPANY has said which language it speaks, and ESPH's rehearsal returned
/// the duplication as its very first finding (2026-10-17): "toda la poblacion habla espanol y
/// que los accesos y link de ingreso venga doble puede generar confusion", with the two
/// questions it actually produced -- "Ingreso con los accesos de arriba o los de abajo?" and
/// "Ingreso primero con el link de arriba y luego realizo la encuesta de abajo?". One username,
/// one password and one button, rendered twice, read as two of each. The subject line carried
/// the same duplication: "Tu acceso a ... / Your access to ...".
/// </para>
/// <para>
/// So a company whose <c>Settings.Language</c> is a single locale gets that locale alone --
/// body, subject and footer. <c>both</c>, or no company language at all, still gets both with
/// the company's language first, because there the original reasoning is untouched: nothing has
/// said which language this reader wants, and a message they cannot read is worse than one that
/// repeats itself. <see cref="InvitationEmailComposer"/> is unchanged; it is reached from the
/// one-by-one admin invite, which has no company language to consult.
/// </para>
/// <para>
/// The password is in the body because that is the ruling: nobody chooses one. It is never
/// logged, never returned by the API, and the only way to see it again is a resend, which
/// replaces it.
/// </para>
/// </summary>
public static class CredentialsEmailComposer
{
    /// <summary>The web route the sign-in button opens. Must match <c>/login</c> in <c>web/src/app/router.tsx</c>.</summary>
    public const string LoginPath = "login";

    /// <param name="recipientName">
    /// **Accepted and deliberately never rendered, ruled 2026-10-16 by Federico.** This message
    /// carries no name: not in the greeting, which is gone, and not as the <c>To:</c> header's
    /// display name, which is now null so the mail goes to the bare address.
    ///
    /// <para>
    /// It used to open "Hola, {name}:" on a recorded client request for "un correo
    /// personalizado: Muy buenas tardes, gracias por participar" -- whose own quoted example
    /// contains no name, which is why dropping it restores the literal ask rather than
    /// reversing it. The reason it had to go is the copy that shipped the day before
    /// (§6 of <c>docs/decisions/who-may-see-an-individual-answer.md</c>): every one of ESPH's
    /// 640 respondents is now told their company will never see their name beside their
    /// answers, and the first mail the platform sends them should not be the counter-example.
    /// </para>
    /// <para>
    /// The parameter stays because <see cref="ICredentialsEmailSender"/> and both its
    /// implementations already thread it, and because the one thing that could legitimately
    /// bring it back -- a display name on the <c>To:</c> header, for deliverability -- would
    /// need it here and nowhere else. What stops it coming back by accident is
    /// <c>CredentialsEmailComposerTests.No_part_of_the_message_carries_the_recipients_name</c>,
    /// which reads every rendered field.
    /// </para>
    /// </param>
    /// <param name="brand">
    /// The company's own logo and accent. Optional, and null means the unbranded shell -- which
    /// is what the composer's own tests exercise. The decision is forced one layer up:
    /// <see cref="ICredentialsEmailSender.SendAsync"/> takes it as a REQUIRED argument, so an
    /// endpoint that has a company in hand cannot send its people an unbranded message by
    /// forgetting a parameter.
    /// </param>
    /// <param name="surveyName">
    /// Which survey these details open, when they open exactly one -- null in `shared` mode,
    /// where the account opens every survey its holder is targeted by and naming one would
    /// be a lie.
    ///
    /// <para>ESPH asked for it on 2026-10-19: a person in Clima and Teletrabajo receives two
    /// of these, and the only thing distinguishing them in an inbox is the subject. "Tu
    /// acceso a OCC" twice over is two identical-looking messages carrying two different
    /// passwords, which is how somebody signs in to the wrong survey with the right
    /// password and is told their details are invalid.</para>
    /// </param>
    /// <param name="surveyClosesOn">
    /// The day the survey closes, already converted to the COMPANY's zone by the caller
    /// (<see cref="ClimateProject.Application.Surveys.SurveyCredentialIssuance.MailFor"/>) --
    /// a day, not an instant, because the composer has no zone and a UTC date is the R2 defect
    /// (a close at or after 18:00 in Costa Rica is the next day in UTC). Printed only beside a
    /// <paramref name="surveyName"/>: "the survey closes" with no survey named says nothing.
    /// </param>
    public static EmailMessage Compose(
        string toEmail, string? recipientName, string username, string password, string loginUrl,
        string? companyLanguage, CredentialsEmailPurpose purpose, EmailBrand? brand = null,
        string? surveyName = null, DateOnly? surveyClosesOn = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toEmail);
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
        ArgumentException.ThrowIfNullOrWhiteSpace(loginUrl);

        // Null for `both`, for no language at all, and for anything unrecognised -- which is
        // exactly the set of cases where the reader's language is still unknown and both
        // blocks still earn their place. A single locale here means this message carries that
        // locale and nothing else.
        var single = ContentLanguages.SingleLocaleOf(companyLanguage);
        var spanishFirst = single == ContentLanguages.Spanish;
        var first = CopyFor(purpose, spanish: spanishFirst);
        var second = single is null ? CopyFor(purpose, spanish: !spanishFirst) : null;

        // Every link in the message carries the username; see `WithUsername`.
        var signInUrl = WithUsername(loginUrl, username);

        // One survey or every survey. Blank counts as none, so a title that resolved to an
        // empty string is sent the `shared` copy rather than "la encuesta «»".
        var survey = string.IsNullOrWhiteSpace(surveyName)
            ? null
            : new SurveyScope(surveyName.Trim(), surveyClosesOn);

        var html = new StringBuilder();
        AppendHtml(html, first, survey, username, password, signInUrl, brand);
        if (second is not null)
        {
            html.Append("""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;">""");
            AppendHtml(html, second, survey, username, password, signInUrl, brand);
        }

        html.Append(EmailBranding.Footer(EmailBranding.Escape(
            second is null ? first.Ignore : $"{first.Ignore} / {second.Ignore}")));

        var text = new StringBuilder();
        AppendText(text, first, survey, brand, username, password, signInUrl);
        if (second is not null)
        {
            text.Append("\n--\n\n");
            AppendText(text, second, survey, brand, username, password, signInUrl);
        }

        return new EmailMessage(
            toEmail,
            // Null, so the mail is addressed to the bare address. See `recipientName`.
            ToName: null,
            EmailMessage.ToHeaderValue(second is null
                ? Subject(first, survey, brand)
                : $"{Subject(first, survey, brand)} / {Subject(second, survey, brand)}"),
            // The credit closes the text part too, in the language the HTML document is in.
            text.Append("\n\n").Append(EmailBranding.Credit(single ?? ContentLanguages.FallbackLocale)).ToString(),
            EmailBranding.Document(single ?? ContentLanguages.FallbackLocale, html.ToString(), brand));
    }

    /// <summary>
    /// What the inbox shows. The product name alone when these details open everything, and
    /// the SURVEY and the COMPANY when they open one survey.
    /// </summary>
    /// <remarks>
    /// Ruled 2026-10-19 from the call: "El correo es de encuesta de clima, de la empresa
    /// Servicio Publico de Heredia" -- the survey and the employer, in that order, because
    /// the respondent is deciding which of two near-identical messages to open and the
    /// survey is what differs. The company is appended rather than led with because every
    /// message this person receives carries the same employer, so it discriminates nothing.
    ///
    /// The company's own name, never the product's: `brand.CompanyName` is what the tenant
    /// is called, and `EmailBranding.ProductName` is what WE are called.
    /// </remarks>
    private static string Subject(CredentialsCopy copy, SurveyScope? survey, EmailBrand? brand)
    {
        if (survey is null)
        {
            return copy.Subject;
        }

        var prefix = copy.SubjectPrefix;
        var company = brand?.CompanyName;
        return string.IsNullOrWhiteSpace(company)
            ? $"{prefix} {survey.Name}"
            : $"{prefix} {survey.Name} \u2014 {company.Trim()}";
    }

    /// <summary>
    /// The body, naming the survey these details open when they open exactly one, and the day
    /// it closes when that is known.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The subject has named the survey since #607, and that is what tells two messages apart
    /// in an INBOX. It is not what tells them apart once opened: measured on 2026-10-20 by
    /// reading the mail the product actually composed, both messages to one person opened
    /// "Tu acceso a OCC — Organizational Climate Check" and said "te invita a responder una
    /// encuesta", so the only difference inside was the code itself (audit 2026-10-22, R3).
    /// Somebody holding two then has no way to tell which is which, and signing in to the
    /// wrong survey with the right password is answered "datos inválidos".
    /// </para>
    /// <para>
    /// `{0}` is the survey and `{1}` the closing sentence (or nothing). The format is per copy
    /// rather than appended generically because a sentence spliced onto the end of an existing
    /// paragraph reads as an afterthought in one language and as a grammatical error in the
    /// other. <c>Every_copy_names_the_survey_and_its_close</c> renders all four and fails if a
    /// placeholder is ever dropped.
    /// </para>
    /// </remarks>
    private static string Body(CredentialsCopy copy, SurveyScope? survey)
    {
        if (survey is null)
        {
            return copy.Body;
        }

        var closes = survey.ClosesOn is { } day
            ? " " + string.Format(CultureInfo.InvariantCulture, copy.ClosesOn, Day(day, copy.Spanish))
            : string.Empty;
        return string.Format(CultureInfo.InvariantCulture, copy.SurveyBody, survey.Name, closes);
    }

    /// <summary>
    /// The line under the button: what to do with this message. Per mode, because what an
    /// administrator can do about lost details differs by mode (audit 2026-10-22, R4).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>`shared`</b>: "ask your administrator to send new ones" is true at any time --
    /// <c>POST /admin/users/{id}/credentials</c> regenerates an account's password, and the
    /// people screen calls it (<c>ResendCredentials.tsx</c>).
    /// </para>
    /// <para>
    /// <b>`per_survey`</b>: the details are a key to ONE survey, not an account, and the only
    /// route that replaces one -- <c>POST /surveys/{id}/credentials/{userId}/reissue</c>
    /// (#620) -- refuses a key that has already signed in (<c>already_signed_in</c>), because
    /// replacing it would lock out somebody halfway through. So the promise is true only
    /// BEFORE the first sign-in, and the sentence says exactly that rather than promising a
    /// replacement the route will refuse.
    /// </para>
    /// </remarks>
    private static string Keep(CredentialsCopy copy, SurveyScope? survey)
        => survey is null ? copy.Keep : copy.SurveyKeep;

    /// <summary>
    /// A day the way the respondent screens print one inside a sentence -- what
    /// <c>Intl.DateTimeFormat(locale, { dateStyle: 'long' })</c> renders: "27 de octubre de
    /// 2026" and "October 27, 2026".
    /// </summary>
    /// <remarks>
    /// Spelled here rather than by <c>CultureInfo("es-CR")</c>, for the reason
    /// <c>SurveyExportCopy</c> gives: a culture's month names come from whatever ICU the host
    /// carries, and a container built with invariant globalization would silently print
    /// English. This is deterministic and testable.
    /// </remarks>
    private static string Day(DateOnly day, bool spanish)
        => spanish
            ? $"{day.Day} de {SpanishMonths[day.Month - 1]} de {day.Year}"
            : $"{EnglishMonths[day.Month - 1]} {day.Day}, {day.Year}";

    private static readonly string[] SpanishMonths =
    [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ];

    private static readonly string[] EnglishMonths =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    /// <summary>
    /// The sign-in link with the username on it, so the field arrives filled.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ESPH's 2026-10-18 review ends on a respondent who could not sign in from their
    /// phone. The screenshot says why without anyone having to guess: the mail read
    /// <c>esphensa-k85j9uyv</c> and the field read <c>esphensa-k85j9ujv</c> — one
    /// character, <c>y</c> retyped as <c>j</c>. A mass-invite username ends in nine random
    /// characters, and on a phone there is no second window to copy it from, so it is
    /// retyped by eye from a mail where <c>y</c> and <c>j</c> differ by a descender.
    /// </para>
    /// <para>
    /// The username is not a secret: it is printed in this same message in plain text, and
    /// on its own it signs nobody in. The PASSWORD is, and it stays in the body — a query
    /// string survives in browser history, in the <c>Referer</c> header, and in every proxy
    /// and access log between the phone and the API, none of which the body touches.
    /// </para>
    /// <para>
    /// Appended before any fragment, because <c>…/login#x?u=…</c> is not a query at all.
    /// </para>
    /// </remarks>
    private static string WithUsername(string loginUrl, string username)
    {
        var hash = loginUrl.IndexOf('#', StringComparison.Ordinal);
        var head = hash < 0 ? loginUrl : loginUrl[..hash];
        var fragment = hash < 0 ? string.Empty : loginUrl[hash..];
        var separator = head.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return $"{head}{separator}u={Uri.EscapeDataString(username)}{fragment}";
    }

    private static void AppendHtml(
        StringBuilder html, CredentialsCopy copy, SurveyScope? survey, string username, string password,
        string loginUrl, EmailBrand? brand)
    {
        // The SAME line the inbox showed, not a third variant of it: somebody who clicked
        // "Tu acceso a Teletrabajo ESPH 2026 — ESPH Ensayo" should find that sentence at the
        // top of what opens. One builder for both, so they cannot drift apart.
        html.Append(EmailBranding.Heading(Subject(copy, survey, brand)));
        html.Append(EmailBranding.Paragraphs(Body(copy, survey)));
        html.Append("""<p style="margin:0 0 16px;font-size:15px;line-height:1.8;">""");
        html.Append(EmailBranding.Escape(copy.UsernameLabel)).Append(": ")
            .Append("""<strong style="font-family:Menlo,Consolas,monospace;font-size:16px;">""").Append(EmailBranding.Escape(username)).Append("</strong><br>");
        html.Append(EmailBranding.Escape(copy.PasswordLabel)).Append(": ")
            .Append("""<strong style="font-family:Menlo,Consolas,monospace;font-size:16px;">""").Append(EmailBranding.Escape(password)).Append("</strong>");
        html.Append("</p>");
        html.Append(EmailBranding.Button(loginUrl, copy.Cta, brand));
        html.Append(EmailBranding.Paragraphs(Keep(copy, survey)));
    }

    private static void AppendText(
        StringBuilder text, CredentialsCopy copy, SurveyScope? survey, EmailBrand? brand,
        string username, string password, string loginUrl)
    {
        text.Append(Subject(copy, survey, brand)).Append("\n\n");
        text.Append(Body(copy, survey)).Append("\n\n");
        text.Append(copy.UsernameLabel).Append(": ").Append(username).Append('\n');
        text.Append(copy.PasswordLabel).Append(": ").Append(password).Append("\n\n");
        text.Append(copy.Cta).Append(": ").Append(loginUrl).Append("\n\n");
        text.Append(Keep(copy, survey)).Append('\n');
        text.Append(copy.Ignore).Append('\n');
    }

    // The `per_survey` sentences ("SurveyBody", "SurveyKeep") say what one key does: it opens
    // ONE survey, and it can be replaced only until it is first used. "Estos datos abren solo
    // esta encuesta" is what lets a person holding two of these tell them apart once opened;
    // the survey's name in the body says which one this is.

    private static readonly CredentialsCopy InvitationEnglish = new(
        Spanish: false,
        Subject: $"Your access to {EmailBranding.ProductName}",
        SubjectPrefix: "Your access to",
        Body: "Your organisation has invited you to answer a survey. Sign in with the username and password below; your organisational details are already on your account. Thank you for taking part.",
        SurveyBody: "Your organisation has invited you to answer the survey \u201c{0}\u201d. Sign in with the username and password below; your organisational details are already on your account.{1} Thank you for taking part.",
        ClosesOn: "The survey closes on {0}.",
        UsernameLabel: "Username",
        PasswordLabel: "Password",
        Cta: "Sign in",
        Keep: "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.",
        SurveyKeep: SurveyKeepEnglish,
        Ignore: "If you were not expecting this message you can ignore it.");

    private static readonly CredentialsCopy InvitationSpanish = new(
        Spanish: true,
        Subject: $"Tu acceso a {EmailBranding.ProductName}",
        SubjectPrefix: "Tu acceso a",
        Body: "Tu organización te invita a responder una encuesta. Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta. Gracias por participar.",
        SurveyBody: "Tu organización te invita a responder la encuesta \u00ab{0}\u00bb. Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta.{1} Gracias por participar.",
        ClosesOn: "La encuesta cierra el {0}.",
        UsernameLabel: "Usuario",
        PasswordLabel: "Contraseña",
        Cta: "Iniciar sesión",
        Keep: "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.",
        SurveyKeep: SurveyKeepSpanish,
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

    /// <summary>
    /// The reminder, for the people the roster shows as unfinished. It asks for the one thing
    /// the invitation did not have to ask for -- that they go in and finish -- and it warns that
    /// the password below replaces the one they may still be holding, because
    /// <c>ResendManyAsync</c> regenerates it for everyone it mails.
    /// </summary>
    private static readonly CredentialsCopy ReminderEnglish = new(
        Spanish: false,
        Subject: $"Reminder: answer your survey on {EmailBranding.ProductName}",
        SubjectPrefix: "Reminder: answer",
        Body: "Please sign in and answer the survey. Your username and a new password are below; the previous password stops working, so sign in with these details. If you had already started, you can carry on where you left off.",
        SurveyBody: "Please sign in and answer the survey \u201c{0}\u201d. Your username and a new password are below; the previous password stops working, so sign in with these details.{1} If you had already started, you can carry on where you left off.",
        ClosesOn: "The survey closes on {0}.",
        UsernameLabel: "Username",
        PasswordLabel: "Password",
        Cta: "Sign in",
        Keep: "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.",
        SurveyKeep: SurveyKeepEnglish,
        Ignore: "If you were not expecting this message you can ignore it.");

    private static readonly CredentialsCopy ReminderSpanish = new(
        Spanish: true,
        Subject: $"Recordatorio: responde la encuesta en {EmailBranding.ProductName}",
        SubjectPrefix: "Recordatorio: responde",
        Body: "Te pedimos que por favor ingreses y respondas la encuesta. Abajo están de nuevo tu usuario y una contraseña nueva: la anterior deja de funcionar, así que entra con estos datos. Si ya la habías empezado, puedes continuar donde la dejaste.",
        SurveyBody: "Te pedimos que por favor ingreses y respondas la encuesta \u00ab{0}\u00bb. Abajo están de nuevo tu usuario y una contraseña nueva: la anterior deja de funcionar, así que entra con estos datos.{1} Si ya la habías empezado, puedes continuar donde la dejaste.",
        ClosesOn: "La encuesta cierra el {0}.",
        UsernameLabel: "Usuario",
        PasswordLabel: "Contraseña",
        Cta: "Iniciar sesión",
        Keep: "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.",
        SurveyKeep: SurveyKeepSpanish,
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

    private const string SurveyKeepEnglish =
        "Keep this message: this username and password open this survey only. If you lose them before you first sign in, ask your administrator to send new ones.";

    private const string SurveyKeepSpanish =
        "Guarda este mensaje: este usuario y esta contraseña abren solo esta encuesta. Si los pierdes antes de ingresar por primera vez, pide a tu administrador que te envíe unos nuevos.";

    /// <summary>
    /// The copy one purpose reads in one language. A purpose this does not know throws rather
    /// than falling back to the invitation: a reminder silently sent as an invitation is the
    /// defect this type was changed to fix, and it would be invisible in a passing suite.
    /// </summary>
    private static CredentialsCopy CopyFor(CredentialsEmailPurpose purpose, bool spanish) => purpose switch
    {
        CredentialsEmailPurpose.Invitation => spanish ? InvitationSpanish : InvitationEnglish,
        CredentialsEmailPurpose.Reminder => spanish ? ReminderSpanish : ReminderEnglish,
        _ => throw new ArgumentOutOfRangeException(nameof(purpose), purpose, "Unknown credentials email purpose."),
    };

    /// <summary>The one survey a per-survey key opens, and the day (company zone) it closes.</summary>
    private sealed record SurveyScope(string Name, DateOnly? ClosesOn);

    /// <param name="Spanish">Which month names <see cref="Day"/> prints.</param>
    /// <param name="Subject">The whole subject when the details open every survey (`shared`).</param>
    /// <param name="SubjectPrefix">
    /// The subject up to, but not including, the survey these details open. Separate rather
    /// than derived, because trimming the product name out of `Subject` would break the moment
    /// either string is reworded.
    /// </param>
    /// <param name="Body">The paragraph for `shared` details, which open every survey.</param>
    /// <param name="SurveyBody">The paragraph for a `per_survey` key: <c>{0}</c> the survey, <c>{1}</c> the closing sentence or nothing.</param>
    /// <param name="ClosesOn">The closing sentence, <c>{0}</c> the day.</param>
    /// <param name="Keep">What to do with the message, `shared` -- see <see cref="Keep(CredentialsCopy, SurveyScope?)"/>.</param>
    /// <param name="SurveyKeep">The same for a `per_survey` key.</param>
    private sealed record CredentialsCopy(
        bool Spanish,
        string Subject,
        string SubjectPrefix,
        string Body,
        string SurveyBody,
        string ClosesOn,
        string UsernameLabel,
        string PasswordLabel,
        string Cta,
        string Keep,
        string SurveyKeep,
        string Ignore);
}
