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

    public static EmailMessage Compose(string toEmail, string username, string password, string loginUrl, string? companyLanguage)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toEmail);
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
        ArgumentException.ThrowIfNullOrWhiteSpace(loginUrl);

        var spanishFirst = string.Equals(companyLanguage, "es", StringComparison.OrdinalIgnoreCase);
        var (first, second) = spanishFirst ? (Spanish, English) : (English, Spanish);

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
            ToName: null,
            EmailMessage.ToHeaderValue($"{first.Subject} / {second.Subject}"),
            text.ToString(),
            EmailBranding.Document(spanishFirst ? "es" : ContentLanguages.FallbackLocale, html.ToString()));
    }

    private static void AppendHtml(StringBuilder html, CredentialsCopy copy, string username, string password, string loginUrl)
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

    private static void AppendText(StringBuilder text, CredentialsCopy copy, string username, string password, string loginUrl)
    {
        text.Append(copy.Subject).Append("\n\n");
        text.Append(copy.Body).Append("\n\n");
        text.Append(copy.UsernameLabel).Append(": ").Append(username).Append('\n');
        text.Append(copy.PasswordLabel).Append(": ").Append(password).Append("\n\n");
        text.Append(copy.Cta).Append(": ").Append(loginUrl).Append("\n\n");
        text.Append(copy.Keep).Append('\n');
        text.Append(copy.Ignore).Append('\n');
    }

    private static readonly CredentialsCopy English = new(
        Subject: $"Your access to {EmailBranding.ProductName}",
        Body: "Your organisation has invited you to answer a survey. Sign in with the username and password below; your organisational details are already on your account.",
        UsernameLabel: "Username",
        PasswordLabel: "Password",
        Cta: "Sign in",
        Keep: "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.",
        Ignore: "If you were not expecting this message you can ignore it.");

    private static readonly CredentialsCopy Spanish = new(
        Subject: $"Tu acceso a {EmailBranding.ProductName}",
        Body: "Tu organización te invita a responder una encuesta. Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta.",
        UsernameLabel: "Usuario",
        PasswordLabel: "Contraseña",
        Cta: "Iniciar sesión",
        Keep: "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.",
        Ignore: "Si no esperabas este mensaje, puedes ignorarlo.");

    private sealed record CredentialsCopy(
        string Subject, string Body, string UsernameLabel, string PasswordLabel, string Cta, string Keep, string Ignore);
}
