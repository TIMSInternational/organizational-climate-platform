namespace ClimateProject.Application.Email;

/// <summary>
/// One outbound email, already rendered. Composing is the caller's job; the transport's
/// job is only to hand this to a provider.
///
/// Both bodies are always present rather than one-or-the-other: a text/plain alternative
/// costs one string and is what keeps the mail out of spam filters that penalise HTML-only
/// messages, and it is the only thing a screen reader in a text-mode client will read.
/// </summary>
/// <param name="ToAddress">The recipient's address. Validated by the transport, not here.</param>
/// <param name="ToName">Display name, or null to send to the bare address.</param>
/// <param name="Subject">Single-line subject. Callers must not put newlines in it -- see <see cref="HasHeaderInjection"/>.</param>
public sealed record EmailMessage(
    string ToAddress,
    string? ToName,
    string Subject,
    string TextBody,
    string HtmlBody)
{
    /// <summary>
    /// True when a field that becomes a MIME *header* contains a line break.
    ///
    /// Subjects and display names on this platform are built from admin-authored
    /// <c>Notification.Title</c> and from user display names, both of which are free text
    /// that reaches this code without ever having been constrained to a single line. A CR
    /// or LF in a header value is the classic SMTP header-injection primitive: it lets the
    /// authored text append its own <c>Bcc:</c>. .NET's <c>MailMessage</c> does throw on
    /// some of these, but not consistently across every field and framework version, so the
    /// check is made here where it can be reasoned about and unit-tested rather than left to
    /// the BCL.
    /// </summary>
    public static bool HasHeaderInjection(string? value)
        => value is not null && (value.Contains('\r', StringComparison.Ordinal) || value.Contains('\n', StringComparison.Ordinal));

    /// <summary>Collapses any line break to a space, so a multi-line title becomes a legal subject.</summary>
    public static string ToHeaderValue(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return HasHeaderInjection(value)
            ? value.Replace('\r', ' ').Replace('\n', ' ').Trim()
            : value;
    }
}
