using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// The mass-invite email: the sign-in link, the username and the password a mass invite
/// generated for one person (ruled 2026-10-13).
///
/// <para>
/// Both languages in one message, like <see cref="InvitationEmailComposer"/> and for its reason:
/// the account was created a moment ago from a spreadsheet row and its holder has chosen no
/// language. The company's own language goes first, so a Costa Rican workforce reads Spanish
/// before anything else.
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
    public static EmailMessage Compose(
        string toEmail, string? recipientName, string username, string password, string loginUrl,
        string? companyLanguage, CredentialsEmailPurpose purpose)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toEmail);
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
        ArgumentException.ThrowIfNullOrWhiteSpace(loginUrl);

        var spanishFirst = string.Equals(companyLanguage, "es", StringComparison.OrdinalIgnoreCase);
        var (first, second) = spanishFirst
            ? (CopyFor(purpose, spanish: true), CopyFor(purpose, spanish: false))
            : (CopyFor(purpose, spanish: false), CopyFor(purpose, spanish: true));

        var html = new StringBuilder();
        AppendHtml(html, first, username, password, loginUrl);
        html.Append("""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;">""");
        AppendHtml(html, second, username, password, loginUrl);
        html.Append(EmailBranding.Footer(EmailBranding.Escape($"{first.Ignore} / {second.Ignore}")));

        var text = new StringBuilder();
        AppendText(text, first, username, password, loginUrl);
        text.Append("\n--\n\n");
        AppendText(text, second, username, password, loginUrl);

        return new EmailMessage(
            toEmail,
            // Null, so the mail is addressed to the bare address. See `recipientName`.
            ToName: null,
            EmailMessage.ToHeaderValue($"{first.Subject} / {second.Subject}"),
            text.ToString(),
            EmailBranding.Document(spanishFirst ? "es" : ContentLanguages.FallbackLocale, html.ToString()));
    }

    private static void AppendHtml(
        StringBuilder html, CredentialsCopy copy, string username, string password, string loginUrl)
    {
        html.Append(EmailBranding.Heading(copy.Subject));
        html.Append(EmailBranding.Paragraphs(copy.Body));
        html.Append("""<p style="margin:0 0 16px;font-size:15px;line-height:1.8;">""");
        html.Append(EmailBranding.Escape(copy.UsernameLabel)).Append(": ")
            .Append("""<strong style="font-family:Menlo,Consolas,monospace;font-size:16px;">""").Append(EmailBranding.Escape(username)).Append("</strong><br>");
        html.Append(EmailBranding.Escape(copy.PasswordLabel)).Append(": ")
            .Append("""<strong style="font-family:Menlo,Consolas,monospace;font-size:16px;">""").Append(EmailBranding.Escape(password)).Append("</strong>");
        html.Append("</p>");
        html.Append(EmailBranding.Button(loginUrl, copy.Cta));
        html.Append(EmailBranding.Paragraphs(copy.Keep));
    }

    private static void AppendText(
        StringBuilder text, CredentialsCopy copy, string username, string password, string loginUrl)
    {
        text.Append(copy.Subject).Append("\n\n");
        text.Append(copy.Body).Append("\n\n");
        text.Append(copy.UsernameLabel).Append(": ").Append(username).Append('\n');
        text.Append(copy.PasswordLabel).Append(": ").Append(password).Append("\n\n");
        text.Append(copy.Cta).Append(": ").Append(loginUrl).Append("\n\n");
        text.Append(copy.Keep).Append('\n');
        text.Append(copy.Ignore).Append('\n');
    }

    private static readonly CredentialsCopy InvitationEnglish = new(
        Subject: $"Your access to {EmailBranding.ProductName}",
        Body: "Your organisation has invited you to answer a survey. Sign in with the username and password below; your organisational details are already on your account. Thank you for taking part.",
        UsernameLabel: "Username",
        PasswordLabel: "Password",
        Cta: "Sign in",
        Keep: "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.",
        Ignore: "If you were not expecting this message you can ignore it.");

    private static readonly CredentialsCopy InvitationSpanish = new(
        Subject: $"Tu acceso a {EmailBranding.ProductName}",
        Body: "Tu organización te invita a responder una encuesta. Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta. Gracias por participar.",
        UsernameLabel: "Usuario",
        PasswordLabel: "Contraseña",
        Cta: "Iniciar sesión",
        Keep: "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.",
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

    /// <summary>
    /// The reminder, for the people the roster shows as unfinished. It asks for the one thing
    /// the invitation did not have to ask for -- that they go in and finish -- and it warns that
    /// the password below replaces the one they may still be holding, because
    /// <c>ResendManyAsync</c> regenerates it for everyone it mails.
    /// </summary>
    private static readonly CredentialsCopy ReminderEnglish = new(
        Subject: $"Reminder: answer your survey on {EmailBranding.ProductName}",
        Body: "Please sign in and answer the survey. Your username and a new password are below; the previous password stops working, so sign in with these details. If you had already started, you can carry on where you left off.",
        UsernameLabel: "Username",
        PasswordLabel: "Password",
        Cta: "Sign in",
        Keep: "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.",
        Ignore: "If you were not expecting this message you can ignore it.");

    private static readonly CredentialsCopy ReminderSpanish = new(
        Subject: $"Recordatorio: responde la encuesta en {EmailBranding.ProductName}",
        Body: "Te pedimos que por favor ingreses y respondas la encuesta. Abajo están de nuevo tu usuario y una contraseña nueva: la anterior deja de funcionar, así que entra con estos datos. Si ya la habías empezado, puedes continuar donde la dejaste.",
        UsernameLabel: "Usuario",
        PasswordLabel: "Contraseña",
        Cta: "Iniciar sesión",
        Keep: "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.",
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

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

    private sealed record CredentialsCopy(
        string Subject, string Body, string UsernameLabel, string PasswordLabel,
        string Cta, string Keep, string Ignore);
}
