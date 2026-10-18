namespace ClimateProject.Application.Email;

/// <summary>
/// One company's identity as an email can wear it: the logo, the name that labels it, and the
/// accent the call to action is painted in.
///
/// <para>
/// **An email's logo URL is absolute, and the web app's is not.** `branding_logo_url` holds a
/// root-relative path -- <c>/brand/esph-logo.png</c> -- because
/// <see cref="ClimateProject.Application.OrgStructure.BrandingValidation"/> refuses an
/// absolute one: a respondent's browser fetching a third-party image announces their IP, their
/// user agent and the referring page to whoever hosts it. That reasoning is about a THIRD
/// party. An email client has no origin to be relative to, so the sender resolves the stored
/// path against <c>Email:AppBaseUrl</c> and the image is served by this platform's own web
/// origin, which is the one host already entitled to know a message was opened.
/// </para>
/// <para>
/// Remote images are blocked by default in Gmail and Outlook, so nothing a reader needs may
/// live in the logo. It carries the company's name as its alt text and sits above a message
/// that names the company nowhere else only as decoration -- block the images and the mail
/// still reads, which is why the masthead is not where the product identifies itself.
/// </para>
/// </summary>
/// <param name="LogoUrl">Absolute, already resolved against the app's base URL. Null when the company has set none.</param>
/// <param name="CompanyName">The logo's alt text. Without it there is nothing truthful to label the image with, so no logo is drawn -- the same rule <c>CompanyLogo.tsx</c> applies on the respondent's own screen.</param>
/// <param name="AccentColor">The call to action's background, <c>#rrggbb</c>. Null falls back to the product's own blue.</param>
public sealed record EmailBrand(string? LogoUrl, string? CompanyName, string? AccentColor)
{
    /// <summary>No tenant branding: the shell every email wore before white-labelling.</summary>
    public static readonly EmailBrand None = new(null, null, null);

    /// <summary>The product's own accent, used whenever a company has not set one.</summary>
    public const string DefaultAccent = "#1f6feb";

    private const string OnDark = "#ffffff";
    private const string OnLight = "#0b1524";

    /// <summary>
    /// True only when there is both an image to draw and a name to label it with.
    /// </summary>
    public bool HasLogo => !string.IsNullOrWhiteSpace(LogoUrl) && !string.IsNullOrWhiteSpace(CompanyName);

    /// <summary>The accent to paint the button in, falling back to the product's own.</summary>
    public string Accent => IsHex(AccentColor) ? AccentColor!.Trim() : DefaultAccent;

    /// <summary>
    /// Black or white, whichever a reader can actually see on <see cref="Accent"/>.
    ///
    /// <para>
    /// The button used to be one hard-coded blue with white text, so its contrast was a fact.
    /// Letting a tenant choose the background makes it a question, and
    /// <c>BrandingValidation</c> cannot answer it -- it checks that a colour is six hex digits,
    /// not that it is dark. A company whose brand is amber would otherwise have shipped white
    /// text on amber to every one of its people, and nobody downstream would have been looking.
    /// </para>
    /// <para>
    /// WCAG relative luminance, with the threshold where contrast against white and against
    /// black are equal -- sqrt(1.05 x 0.05) - 0.05, about 0.179 -- rather than a midpoint
    /// guess. Both choices then clear 4.5:1 for every background this picks them for.
    /// </para>
    /// </summary>
    public string AccentForeground => RelativeLuminance(Accent) > 0.179 ? OnLight : OnDark;

    /// <summary>
    /// The same brand with a stored logo path turned into something a mail client can fetch.
    ///
    /// <para>
    /// The endpoints hand over what the column holds, which is a ROOT-RELATIVE path, and this
    /// is the one place that knows the host. Doing it here rather than at each call site keeps
    /// <see cref="EmailOptions"/> out of the endpoints and means a new caller cannot ship a
    /// <c>src="/brand/x.png"</c> that resolves against the reader's webmail provider -- which
    /// is a broken image at best and a request to Google at worst.
    /// </para>
    /// <para>
    /// A <c>data:</c> URI and an absolute URL are already sendable and pass through untouched.
    /// <c>BrandingValidation</c> accepts the first and refuses the second, so in practice only
    /// the relative case occurs; the guard is here so that a change to that validator cannot
    /// silently produce <c>https://app.example.com/https://cdn.other/logo.png</c>.
    /// </para>
    /// </summary>
    public EmailBrand ResolvedAgainst(EmailOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (string.IsNullOrWhiteSpace(LogoUrl))
        {
            return this;
        }

        var logo = LogoUrl.Trim();
        var alreadySendable = logo.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            || logo.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || logo.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

        return alreadySendable ? this : this with { LogoUrl = options.LinkTo(logo) };
    }

    private static bool IsHex(string? value)
    {
        if (value is null)
        {
            return false;
        }

        var trimmed = value.Trim();
        if (trimmed.Length != 7 || trimmed[0] != '#')
        {
            return false;
        }

        for (var i = 1; i < trimmed.Length; i++)
        {
            if (!Uri.IsHexDigit(trimmed[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static double RelativeLuminance(string hex)
    {
        var r = Linearise(Convert.ToInt32(hex.Substring(1, 2), 16) / 255.0);
        var g = Linearise(Convert.ToInt32(hex.Substring(3, 2), 16) / 255.0);
        var b = Linearise(Convert.ToInt32(hex.Substring(5, 2), 16) / 255.0);
        return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    }

    private static double Linearise(double channel)
        => channel <= 0.03928 ? channel / 12.92 : Math.Pow((channel + 0.055) / 1.055, 2.4);
}
