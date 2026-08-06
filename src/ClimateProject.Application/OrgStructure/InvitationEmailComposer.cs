using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// The invitation email.
///
/// <para>
/// **Why this one is bilingual in a single message, when notification mail is not.** A
/// notification has a recipient with a row, and that row carries
/// <c>Preferences.Language</c> -- so it can be sent in the language the person chose.
/// An invitation, by definition, precedes the account: there is no user row, no preference,
/// and <c>UserInvitation</c> has no language column of its own. The available options were
/// to guess (send Spanish-speaking employees an English-only invitation, which is exactly
/// the failure #78 was raised about), to add a language column (a migration, and one that
/// still needs the inviting admin to know the answer), or to send both languages in one
/// message. Both languages, English first, is the only one of the three that is right for
/// every recipient without asking anyone to know something they do not.
/// </para>
/// <para>
/// Revisit this when an invitation gains a language -- either from the inviting admin's
/// choice or from the company's own <c>Settings.Language</c>. At that point this composer
/// takes a locale like the notification one does and the doubled body goes away.
/// </para>
/// </summary>
public static class InvitationEmailComposer
{
    /// <summary>
    /// The web route that redeems a token. Must stay equal to the route registered in
    /// <c>web/src/app/router.tsx</c> (<c>/accept-invitation/:token</c>) -- a link that 404s
    /// is indistinguishable, to the recipient, from an invitation that was never sent.
    /// </summary>
    public const string AcceptPathTemplate = "accept-invitation/{0}";

    /// <summary>
    /// Composes the invitation, or returns null when the invitation has no address to send
    /// to.
    ///
    /// A null return is not a failure: <c>UserInvitation.Email</c> is deliberately nullable
    /// because a shareable self-signup link is an invitation with no recipient, and the
    /// admin distributes it themselves. Sending nothing is the correct behaviour there, and
    /// the caller reports it as a no-op rather than an error.
    /// </summary>
    public static EmailMessage? Compose(UserInvitation invitation, string acceptUrl)
    {
        ArgumentNullException.ThrowIfNull(invitation);
        ArgumentNullException.ThrowIfNull(acceptUrl);

        if (string.IsNullOrWhiteSpace(invitation.Email))
        {
            return null;
        }

        // Both languages in the subject, separated so a client that truncates still shows a
        // complete sentence in at least the first.
        var subject = $"{English.Subject} / {Spanish.Subject}";
        var expires = invitation.ExpiresAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'", System.Globalization.CultureInfo.InvariantCulture);

        var html = new StringBuilder();
        html.Append(EmailBranding.Heading(English.Subject));
        html.Append(EmailBranding.Paragraphs(English.Body));
        html.Append(EmailBranding.Button(acceptUrl, English.Cta));
        html.Append(EmailBranding.Paragraphs(string.Format(System.Globalization.CultureInfo.InvariantCulture, English.Expiry, expires)));
        html.Append("""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;">""");
        html.Append(EmailBranding.Heading(Spanish.Subject));
        html.Append(EmailBranding.Paragraphs(Spanish.Body));
        html.Append(EmailBranding.Button(acceptUrl, Spanish.Cta));
        html.Append(EmailBranding.Paragraphs(string.Format(System.Globalization.CultureInfo.InvariantCulture, Spanish.Expiry, expires)));
        html.Append(EmailBranding.Footer(EmailBranding.Escape($"{English.Ignore} / {Spanish.Ignore}")));

        var text = new StringBuilder();
        AppendText(text, English, acceptUrl, expires);
        text.Append("\n--\n\n");
        AppendText(text, Spanish, acceptUrl, expires);

        return new EmailMessage(
            invitation.Email!,
            ToName: null,
            EmailMessage.ToHeaderValue(subject),
            text.ToString(),
            // The document language is the fallback locale because the body is genuinely
            // both; there is no correct single value, and 'en' is what the platform falls
            // back to everywhere else.
            EmailBranding.Document(ContentLanguages.FallbackLocale, html.ToString()));
    }

    private static void AppendText(StringBuilder builder, InvitationCopy copy, string acceptUrl, string expires)
    {
        builder.Append(copy.Subject).Append("\n\n");
        builder.Append(copy.Body).Append("\n\n");
        builder.Append(copy.Cta).Append(": ").Append(acceptUrl).Append("\n\n");
        builder.Append(string.Format(System.Globalization.CultureInfo.InvariantCulture, copy.Expiry, expires)).Append('\n');
        builder.Append(copy.Ignore).Append('\n');
    }

    private static readonly InvitationCopy English = new(
        Subject: $"You have been invited to {EmailBranding.ProductName}",
        Body: $"An administrator has invited you to join {EmailBranding.ProductName}. Use the link below to set up your account.",
        Cta: "Accept the invitation",
        Expiry: "This invitation expires on {0}.",
        Ignore: "If you were not expecting this invitation you can ignore this message.");

    private static readonly InvitationCopy Spanish = new(
        Subject: $"Te han invitado a {EmailBranding.ProductName}",
        Body: $"Un administrador te ha invitado a unirte a {EmailBranding.ProductName}. Usa el enlace de abajo para crear tu cuenta.",
        Cta: "Aceptar la invitación",
        Expiry: "Esta invitación caduca el {0}.",
        Ignore: "Si no esperabas esta invitación, puedes ignorar este mensaje.");

    private sealed record InvitationCopy(string Subject, string Body, string Cta, string Expiry, string Ignore);
}
