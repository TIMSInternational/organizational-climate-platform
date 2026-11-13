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
    /// The product name, as it appears in every outbound message.
    ///
    /// It is a name, so it is identical in both languages and is not translated.
    ///
    /// This constant claimed to match <c>web/src/i18n/noHardcodedStrings.test.ts</c>'s single
    /// allowed untranslated literal for as long as it existed, and did not: the app, the
    /// brand assets and that guard all said "OCC -- Organizational Climate Check" while every
    /// invitation and every notification footer said "Organizational Climate Platform", a name
    /// the product uses nowhere else. Nothing caught it, because the two live in different
    /// languages and different test suites and no test compared them. The claim is now true,
    /// and <c>web/src/i18n/productName.test.ts</c> reads this file and fails if it drifts
    /// again -- a comment asserting agreement is not agreement.
    /// </summary>
    public const string ProductName = "OCC — Organizational Climate Check";

    /// <summary>
    /// Wraps a rendered body fragment in the document shell.
    /// </summary>
    /// <param name="language">Written into <c>&lt;html lang&gt;</c> so assistive tech announces the mail in the right voice.</param>
    /// <param name="bodyHtml">Already-escaped HTML. Callers escape per value, never per document.</param>
    /// <param name="brand">
    /// The tenant's own identity, or null for the unbranded shell. Optional so that every
    /// caller that has no company to hand -- and there are several -- keeps the look it had.
    /// </param>
    public static string Document(string language, string bodyHtml, EmailBrand? brand = null)
    {
        ArgumentNullException.ThrowIfNull(bodyHtml);

        // Inline styles only: every mail client of consequence strips <style> blocks, and
        // several strip class attributes outright.
        //
        // `color-scheme` + `supported-color-schemes` tell Apple Mail and Outlook not to
        // re-colour what is already explicit. They do not stop a client inverting the card,
        // which is why every colour below is stated rather than inherited: a shell that relies
        // on a default background is the one that turns black text on black in dark mode.
        return $"""
            <!doctype html>
            <html lang="{Escape(language)}">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <meta name="color-scheme" content="light">
            <meta name="supported-color-schemes" content="light">
            </head>
            <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;color:#1f2933;-webkit-text-size-adjust:100%;">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e7eb;border-radius:12px;padding:32px;">
            {Masthead(brand)}{bodyHtml}
            </div>
            <p style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;line-height:1.5;color:#616e7c;">{Escape(Credit(language))}</p>
            </body>
            </html>
            """;
    }

    /// <summary>
    /// The tenant's logo above the message, or nothing at all.
    ///
    /// <para>
    /// A one-cell table rather than a div, because Outlook on Windows renders mail through
    /// Word and gives a block element margins of its own. <c>height</c> is set as an ATTRIBUTE
    /// as well as a style for the same reason -- Word ignores the style and would otherwise
    /// draw the image at its intrinsic size, which for a 334px-wide lockup is most of the
    /// card. Width is left to follow the aspect ratio, so a tall logo and a wide one both
    /// land on the same 32px line.
    /// </para>
    /// <para>
    /// No logo means no rule and no gap: an unbranded message is exactly what it was before.
    /// </para>
    /// </summary>
    public static string Masthead(EmailBrand? brand)
    {
        if (brand is null || !brand.HasLogo)
        {
            return string.Empty;
        }

        return $"""
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;"><tr><td style="padding:0 0 20px;border-bottom:1px solid #e4e7eb;">
            <img src="{Escape(brand.LogoUrl)}" alt="{Escape(brand.CompanyName)}" height="32" style="height:32px;max-height:32px;width:auto;border:0;outline:none;text-decoration:none;display:block;">
            </td></tr></table>
            """;
    }

    /// <summary>
    /// An anchor styled as a button, with both the href and the label escaped, painted in the
    /// tenant's accent when there is one.
    ///
    /// <para>
    /// The foreground comes from <see cref="EmailBrand.AccentForeground"/> rather than being
    /// white: a tenant may legitimately choose a pale brand colour, and white on it is a
    /// button nobody can read in a message they only get once.
    /// </para>
    /// </summary>
    public static string Button(string url, string label, EmailBrand? brand = null)
    {
        var accent = brand?.Accent ?? EmailBrand.DefaultAccent;
        var foreground = brand?.AccentForeground ?? "#ffffff";
        return $"""<p style="margin:24px 0;"><a href="{Escape(url)}" style="display:inline-block;padding:12px 22px;background:{accent};color:{foreground};text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">{Escape(label)}</a></p>""";
    }

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

    /// <summary>
    /// Small print at the foot of the message, closing with the product's own name.
    ///
    /// <para>
    /// The product line is here rather than in the masthead on purpose. White-labelling puts
    /// the TENANT at the top, and a reader whose images are blocked -- Gmail's and Outlook's
    /// default -- would then see a message identifying nobody. The footer is text, so it
    /// always arrives, and it is where a reader looks to answer "who sent me this".
    /// </para>
    /// </summary>
    public static string Footer(string html)
        => $"""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0 16px;"><div style="font-size:12px;line-height:1.5;color:#616e7c;">{html}<div style="margin-top:10px;color:#9aa5b1;">{Escape(ProductName)}</div></div>""";

    /// <summary>
    /// Who built the platform, under the card of every message: "Desarrollado por Nexadev" in
    /// Spanish, "Powered by Nexadev" otherwise. Ruled 2026-10-21 by Federico, with the same line
    /// on every screen of the web app (<c>PoweredByNexadev.tsx</c>).
    /// </summary>
    /// <remarks>
    /// Text, not the mark: an image here needs an absolute URL, which is only known at send
    /// time (<see cref="EmailBrand.ResolvedAgainst"/>), and Gmail and Outlook block images by
    /// default -- the reason <see cref="Footer"/> already names the product in text. Under the
    /// card rather than inside <see cref="Footer"/> so it is on every message, including any
    /// that ends without one. <c>#616e7c</c> on the <c>#f4f5f7</c> ground is 4.8:1; the
    /// footer's lighter <c>#9aa5b1</c> would be 2.3:1 there.
    /// </remarks>
    public static string Credit(string? language) => Localization.NexadevCredit.For(language);

    public static string Escape(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);
}
