using System.Text.RegularExpressions;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// What a company's branding may be set to, checked before anything is written.
///
/// ## Why this exists
///
/// <c>PUT /companies/{id}/settings</c> assigned all five branding fields raw -- no length
/// cap, no hex check, no sanitiser -- on a *company* administrator's authority. Nothing
/// rendered the colours or the CSS, so it was latent rather than live; the logo URL was the
/// exception, because <c>CompanySettingsNextView</c> has always put it straight into an
/// <c>&lt;img src&gt;</c>.
///
/// Audited 2026-10-16, and validated here before the logo began rendering on the
/// respondent's own portal. A value a respondent's browser will fetch is a different kind of
/// value from one only an administrator sees.
///
/// ## The logo has to be same-origin, and that is a policy, not a preference
///
/// <c>web/vercel.json</c> sets <c>img-src 'self' data:</c>. An absolute
/// <c>https://cdn.example.com/logo.png</c> is therefore out of policy, and the consequence
/// is not only a broken image: every respondent's browser would announce its IP address, its
/// user agent and the referring page to whoever hosts that file, which on this product means
/// handing a third party the fact that a named company is running a climate survey today.
/// The header is <c>Content-Security-Policy-Report-Only</c> at the moment, so the browser
/// would report the violation and load the image anyway -- which is exactly why the refusal
/// belongs here and not in the browser.
///
/// So a logo is either a root-relative path -- a file committed under
/// <c>web/public/brand/</c>, served from the web origin, the way the product's own
/// <c>occ-logo.svg</c> already is -- or a <c>data:</c> URI, which the same policy allows.
///
/// ## Every refusal names the field and what would be accepted
///
/// These messages reach a company administrator who is looking at a form, not a developer
/// reading a log. "Invalid branding" would send them to us to ask which of five fields.
/// </summary>
public static class BrandingValidation
{
    /// <summary>Matches the <c>branding_logo_url</c> column width.</summary>
    public const int LogoUrlMaxLength = 500;

    /// <summary>
    /// A font family reaches CSS as a token, so the alphabet is the whole defence: no quotes,
    /// no semicolon, no braces, no parentheses, no comma. 64 is past the longest real family
    /// name and short enough that the field cannot carry a payload.
    /// </summary>
    public const int FontFamilyMaxLength = 64;

    /// <summary>
    /// Six hex digits with a leading hash, and nothing else -- not <c>#RGB</c>, not
    /// <c>rgb()</c>, not a named colour.
    ///
    /// <para>
    /// **The web side holds this same rule** as <c>HEX_COLOUR</c> in
    /// <c>web/src/features/org-structure/next/settings/derive.ts</c>, and
    /// <c>brandingValidationParity.test.ts</c> reads this file to prove the two agree. Two
    /// copies of one rule that drift mean a form that accepts what the API refuses, which
    /// reads to the administrator as the save button not working.
    /// </para>
    /// </summary>
    public const string HexColourPattern = "^#[0-9a-fA-F]{6}$";

    /// <summary>The image types an <c>&lt;img&gt;</c> on these screens may point at.</summary>
    private static readonly string[] ImageExtensions = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"];

    private static readonly Regex HexColour = new(HexColourPattern, RegexOptions.Compiled);

    /// <summary>
    /// Letters, digits, spaces and hyphens. Deliberately a character class and not an
    /// allowlist of family names: a tenant may legitimately ship a font this product has
    /// never heard of, and it is the alphabet rather than the name that makes the value safe
    /// to put in a stylesheet.
    /// </summary>
    private static readonly Regex FontFamily = new(@"^[A-Za-z0-9][A-Za-z0-9 \-]*$", RegexOptions.Compiled);

    /// <summary>
    /// A root-relative path, then an optional query for cache-busting. The query is allowed
    /// because a client's logo gets replaced in place and a browser that cached the old one
    /// for a year is a support call; its alphabet is as narrow as the path's.
    /// </summary>
    private static readonly Regex RelativePath = new(@"^/[A-Za-z0-9._/-]+(\?[A-Za-z0-9._=-]*)?$", RegexOptions.Compiled);

    private static readonly Regex DataImage = new(@"^data:image/(svg\+xml|png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/]+={0,2}$", RegexOptions.Compiled);

    /// <summary>
    /// The refusal message, or null when every field present on the request is acceptable.
    /// A field the request leaves null is not being changed and is not checked.
    /// </summary>
    public static string? Validate(UpdateCompanySettingsRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.LogoUrl is { } logo && logo.Trim().Length > 0)
        {
            var refusal = ValidateLogoUrl(logo.Trim());
            if (refusal is not null)
            {
                return refusal;
            }
        }

        foreach (var (name, value) in new[] { ("primary", request.PrimaryColor), ("secondary", request.SecondaryColor) })
        {
            if (!string.IsNullOrWhiteSpace(value) && !HexColour.IsMatch(value.Trim()))
            {
                return $"The {name} colour must be six hex digits with a leading hash, like #0D9488.";
            }
        }

        if (!string.IsNullOrWhiteSpace(request.FontFamily))
        {
            var font = request.FontFamily.Trim();
            if (font.Length > FontFamilyMaxLength)
            {
                return $"The font family must be {FontFamilyMaxLength} characters or fewer.";
            }

            if (!FontFamily.IsMatch(font))
            {
                return "The font family may contain only letters, digits, spaces and hyphens -- no quotes, semicolons, brackets or commas.";
            }
        }

        // Refused outright rather than capped. Nothing renders it, and the reason it is not
        // rendered is not that nobody got round to it: arbitrary CSS on these screens could
        // set `display:none` on the anonymity notice a respondent is shown before answering,
        // or on the hatching that marks a suppressed cell. Those two are privacy
        // guarantees that happen to be drawn, not styling -- so the field stays a field
        // nobody can load, and clearing it is the only write that succeeds.
        if (!string.IsNullOrWhiteSpace(request.CustomCss))
        {
            return "Custom CSS is not applied anywhere in this product and cannot be saved. "
                + "Arbitrary CSS could hide the anonymity notice a respondent reads before answering, "
                + "or the hatching that marks a suppressed result -- both are privacy guarantees rather than styling. "
                + "Send an empty value to clear a previously stored one.";
        }

        return null;
    }

    private static string? ValidateLogoUrl(string logo)
    {
        if (logo.Length > LogoUrlMaxLength)
        {
            return $"The logo address must be {LogoUrlMaxLength} characters or fewer.";
        }

        if (logo.Any(char.IsControl) || logo.Any(char.IsWhiteSpace))
        {
            return "The logo address cannot contain spaces or line breaks.";
        }

        if (logo.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            if (!DataImage.IsMatch(logo))
            {
                return "A data: logo must be base64 of an SVG, PNG, JPEG, WebP, AVIF or GIF, "
                    + $"like data:image/png;base64,… -- and the whole value must fit in {LogoUrlMaxLength} characters.";
            }

            // A value that matches the shape but is not decodable would reach the browser as
            // a broken image, which looks to an administrator like the upload having failed.
            var payload = logo[(logo.IndexOf(",", StringComparison.Ordinal) + 1)..];
            if (!Convert.TryFromBase64String(payload, new byte[payload.Length], out _))
            {
                return "That data: logo is not valid base64.";
            }

            return null;
        }

        // Caught before the relative-path check so the message can say what to do instead,
        // rather than "must start with /", which reads as a formatting nitpick.
        if (logo.Contains("://", StringComparison.Ordinal) || logo.StartsWith("//", StringComparison.Ordinal))
        {
            return "The logo must be served from this site, because the content security policy is "
                + "img-src 'self' data: -- and because an externally hosted logo would report every "
                + "respondent's address to whoever hosts it. Commit the file under web/public/brand/ "
                + "and set this to its path, like /brand/acme-logo.svg.";
        }

        if (logo.Contains("..", StringComparison.Ordinal) || logo.Contains('\\', StringComparison.Ordinal))
        {
            return "The logo path cannot contain \"..\" or backslashes.";
        }

        if (!RelativePath.IsMatch(logo))
        {
            return "The logo path must start with / and may contain only letters, digits, dots, hyphens and slashes, "
                + "like /brand/acme-logo.svg.";
        }

        var path = logo.Split('?', 2)[0];
        if (!ImageExtensions.Any(ext => path.EndsWith(ext, StringComparison.OrdinalIgnoreCase)))
        {
            return "The logo path must end in " + string.Join(", ", ImageExtensions) + ".";
        }

        return null;
    }

    /// <summary>
    /// Normalises a validated logo value for storage: a blank becomes null, so "no logo" is
    /// one value in the column rather than three that every reader has to know about.
    /// </summary>
    public static string? NormaliseLogoUrl(string? logo)
        => string.IsNullOrWhiteSpace(logo) ? null : logo.Trim();
}
