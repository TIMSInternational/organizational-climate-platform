using System.Net;
using System.Text;

namespace ClimateProject.Application.Email;

/// <summary>
/// The shared chrome every outbound email on this platform wears, and the two helpers that
/// keep untrusted text from becoming markup.
///
/// Kept as one small class rather than a template engine on purpose: there are two email
/// shapes in this repo (a notification and an invitation), both are a heading, a paragraph
/// and one call to action, and a templating dependency to render that would be more
/// machinery than content.
/// </summary>
public static class EmailBranding
{
    /// <summary>
    /// The product name. Matches <c>web/src/i18n/noHardcodedStrings.test.ts</c>'s single
    /// allowed untranslated literal -- it is a name, so it is identical in both languages.
    /// </summary>
    public const string ProductName = "Organizational Climate Platform";

    /// <summary>
    /// Wraps a rendered body fragment in the document shell.
    /// </summary>
    /// <param name="language">Written into <c>&lt;html lang&gt;</c> so assistive tech announces the mail in the right voice.</param>
    /// <param name="bodyHtml">Already-escaped HTML. Callers escape per value, never per document.</param>
    public static string Document(string language, string bodyHtml)
    {
        ArgumentNullException.ThrowIfNull(bodyHtml);

        // Inline styles only: every mail client of consequence strips <style> blocks, and
        // several strip class attributes outright.
        return $"""
            <!doctype html>
            <html lang="{Escape(language)}">
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;color:#1f2933;">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
            {bodyHtml}
            </div>
            </body>
            </html>
            """;
    }

    /// <summary>An anchor styled as a button, with both the href and the label escaped.</summary>
    public static string Button(string url, string label)
        => $"""<p style="margin:24px 0;"><a href="{Escape(url)}" style="display:inline-block;padding:12px 20px;background:#1f6feb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">{Escape(label)}</a></p>""";

    /// <summary>
    /// User- or admin-authored text turned into HTML: escaped first, then line breaks
    /// restored as <c>&lt;br&gt;</c>.
    ///
    /// Order matters and is the whole point. Escaping after inserting the breaks would escape
    /// the breaks; inserting the breaks without escaping would let a notification message
    /// authored by a company admin inject arbitrary markup -- including a link -- into mail
    /// sent under this platform's verified sending domain.
    /// </summary>
    public static string Paragraphs(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');

        builder.Append("""<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">""");
        for (var i = 0; i < lines.Length; i++)
        {
            if (i > 0) builder.Append("<br>");
            builder.Append(Escape(lines[i]));
        }

        builder.Append("</p>");
        return builder.ToString();
    }

    /// <summary>A heading carrying authored text.</summary>
    public static string Heading(string text)
        => $"""<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0b1524;">{Escape(text)}</h1>""";

    /// <summary>Small print at the foot of the message.</summary>
    public static string Footer(string html)
        => $"""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0 16px;"><div style="font-size:12px;line-height:1.5;color:#616e7c;">{html}</div>""";

    public static string Escape(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);
}
