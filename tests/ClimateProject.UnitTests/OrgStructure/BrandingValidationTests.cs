using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// <c>PUT /companies/{id}/settings</c> assigned all five branding fields raw. The logo is the
/// one a respondent's browser fetches, since <c>GET /profile</c> began carrying it, so these
/// are written from the respondent's side rather than the administrator's.
/// </summary>
public class BrandingValidationTests
{
    private static UpdateCompanySettingsRequest Branding(
        string? logo = null, string? primary = null, string? secondary = null,
        string? font = null, string? css = null)
        => new(null, null, null, null, null, null, null, logo, primary, secondary, font, css);

    [Theory]
    [InlineData("/brand/esph-logo.svg")]
    [InlineData("/brand/acme.png")]
    [InlineData("/brand/sub/dir/mark.webp")]
    [InlineData("/brand/logo.svg?v=2")]
    [InlineData("/brand/UPPER.PNG")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    [InlineData("")]
    [InlineData("   ")]
    public void A_same_origin_image_path_a_data_uri_and_a_blank_are_accepted(string logo)
        => Assert.Null(BrandingValidation.Validate(Branding(logo: logo)));

    /// <summary>
    /// The refusal that matters most, and the only one whose cost is not a broken image.
    /// `vercel.json` sets `img-src 'self' data:` as **report-only**, so the browser would
    /// log the violation and load the picture anyway -- handing whoever hosts it every
    /// respondent's IP address, user agent and referring page, which on this product is the
    /// fact that a named company is running a climate survey today.
    /// </summary>
    [Theory]
    [InlineData("https://cdn.example.com/logo.png")]
    [InlineData("http://example.com/logo.png")]
    [InlineData("//example.com/logo.png")]
    public void An_externally_hosted_logo_is_refused_and_the_message_says_what_to_do_instead(string logo)
    {
        var refusal = BrandingValidation.Validate(Branding(logo: logo));

        Assert.NotNull(refusal);
        // The administrator reading this is looking at a form, not a log. It has to name the
        // alternative, or the only move left is to ask us.
        Assert.Contains("web/public/brand/", refusal, StringComparison.Ordinal);
        Assert.Contains("img-src", refusal, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("/brand/../../etc/passwd", "..")]
    [InlineData("/brand/..%2fx.svg", "..")]
    [InlineData("\\brand\\logo.svg", "backslash")]
    public void Traversal_and_backslashes_are_refused(string logo, string _)
        => Assert.NotNull(BrandingValidation.Validate(Branding(logo: logo)));

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("/brand/logo.svg\nBcc: attacker@example.com")]
    [InlineData("/brand/logo with space.svg")]
    [InlineData("/brand/logo")]
    [InlineData("/brand/notes.txt")]
    [InlineData("/brand/script.js")]
    [InlineData("brand/logo.svg")]
    [InlineData("data:text/html;base64,PHNjcmlwdD4=")]
    [InlineData("data:image/png;base64,not valid base64!!")]
    public void A_non_image_a_relative_path_and_a_non_image_data_uri_are_all_refused(string logo)
        => Assert.NotNull(BrandingValidation.Validate(Branding(logo: logo)));

    [Fact]
    public void A_logo_longer_than_the_column_is_refused_rather_than_truncated_by_the_database()
    {
        var tooLong = "/brand/" + new string('a', BrandingValidation.LogoUrlMaxLength) + ".svg";

        var refusal = BrandingValidation.Validate(Branding(logo: tooLong));

        // Without this, Npgsql throws on the INSERT and the administrator gets a 500 for a
        // value a form could have refused.
        Assert.NotNull(refusal);
        Assert.Contains(BrandingValidation.LogoUrlMaxLength.ToString(System.Globalization.CultureInfo.InvariantCulture), refusal, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("#0d9488")]
    [InlineData("#FB1724")]
    [InlineData("#000000")]
    public void Six_hex_digits_are_accepted_for_either_colour(string colour)
    {
        Assert.Null(BrandingValidation.Validate(Branding(primary: colour)));
        Assert.Null(BrandingValidation.Validate(Branding(secondary: colour)));
    }

    [Theory]
    [InlineData("#fff")]
    [InlineData("0d9488")]
    [InlineData("rgb(13,148,136)")]
    [InlineData("teal")]
    [InlineData("#0d9488; background: url(http://x)")]
    [InlineData("var(--admin-accent-blue)")]
    public void Anything_that_is_not_six_hex_digits_is_refused(string colour)
    {
        Assert.NotNull(BrandingValidation.Validate(Branding(primary: colour)));
        Assert.NotNull(BrandingValidation.Validate(Branding(secondary: colour)));
    }

    [Theory]
    [InlineData("Poppins")]
    [InlineData("Inter")]
    [InlineData("Helvetica Neue")]
    [InlineData("IBM Plex Sans")]
    [InlineData("Avenir-Next")]
    public void A_plain_font_family_name_is_accepted(string font)
        => Assert.Null(BrandingValidation.Validate(Branding(font: font)));

    [Theory]
    [InlineData("Poppins; } body { display: none")]
    [InlineData("'Poppins'")]
    [InlineData("Poppins, sans-serif")]
    [InlineData("Poppins\")")]
    [InlineData("url(http://x/f.woff)")]
    public void A_font_family_carrying_CSS_syntax_is_refused(string font)
        => Assert.NotNull(BrandingValidation.Validate(Branding(font: font)));

    [Fact]
    public void A_font_family_longer_than_the_cap_is_refused()
        => Assert.NotNull(BrandingValidation.Validate(Branding(font: new string('a', BrandingValidation.FontFamilyMaxLength + 1))));

    /// <summary>
    /// Refused outright, not capped. The reason it is not rendered is not that nobody got
    /// round to it: `display:none` on the anonymity notice a respondent reads before
    /// answering, or on the hatching that marks a suppressed cell, turns a privacy guarantee
    /// off with styling. Those two are drawn guarantees, not decoration.
    /// </summary>
    [Theory]
    [InlineData(".anonymity-notice { display: none }")]
    [InlineData("body{}")]
    public void Custom_css_cannot_be_saved_at_all_and_the_message_says_why(string css)
    {
        var refusal = BrandingValidation.Validate(Branding(css: css));

        Assert.NotNull(refusal);
        Assert.Contains("anonymity notice", refusal, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Clearing_a_previously_stored_custom_css_is_the_one_write_that_succeeds(string css)
        => Assert.Null(BrandingValidation.Validate(Branding(css: css)));

    [Fact]
    public void A_field_the_request_omits_is_not_being_changed_and_is_not_checked()
    {
        // The endpoint assigns each branding field only when the request carries it, so a
        // request about the timezone must not be refused for a colour it never mentions.
        Assert.Null(BrandingValidation.Validate(Branding()));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("  /brand/logo.svg  ", "/brand/logo.svg")]
    public void Normalisation_makes_no_logo_exactly_one_stored_value(string? stored, string? expected)
    {
        // Three spellings of "no logo" would be three things every reader has to know about,
        // and the reader that matters decides whether to render an <img> at all.
        Assert.Equal(expected, BrandingValidation.NormaliseLogoUrl(stored));
    }
}
