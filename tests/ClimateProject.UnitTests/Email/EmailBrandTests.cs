using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// White-labelling an email, and the two things that are easy to get wrong about it.
///
/// <para>
/// A tenant's logo is stored as a ROOT-RELATIVE path, because the respondent's browser must
/// not fetch a third-party image. An email client has no origin to resolve that against, so
/// an unresolved path is a broken image in every inbox -- and the failure is invisible from
/// the sending side, because the message composes, sends and is accepted exactly as it would
/// have been.
/// </para>
/// <para>
/// And a tenant chooses the button's colour, while <c>BrandingValidation</c> only checks that
/// the value is six hex digits. Nothing else in the path asks whether a reader can see white
/// text on it.
/// </para>
/// </summary>
public class EmailBrandTests
{
    private static EmailOptions OptionsAt(string baseUrl) => new() { AppBaseUrl = baseUrl };

    [Theory]
    [InlineData("/brand/esph-logo.png", "https://climate.example.com/brand/esph-logo.png")]
    [InlineData("brand/esph-logo.png", "https://climate.example.com/brand/esph-logo.png")]
    public void A_stored_path_is_resolved_against_the_app_origin(string stored, string expected)
    {
        var resolved = new EmailBrand(stored, "ESPH", null).ResolvedAgainst(OptionsAt("https://climate.example.com"));

        Assert.Equal(expected, resolved.LogoUrl);
    }

    [Theory]
    [InlineData("https://cdn.example.com/logo.png")]
    [InlineData("data:image/png;base64,iVBORw0KGgo=")]
    public void Something_already_sendable_is_left_exactly_as_it_is(string stored)
    {
        // BrandingValidation refuses an absolute URL and accepts a data: URI, so only the
        // second occurs today. The guard is here so a change to that validator cannot produce
        // https://app.example.com/https://cdn.other/logo.png without a test going red.
        var resolved = new EmailBrand(stored, "ESPH", null).ResolvedAgainst(OptionsAt("https://climate.example.com"));

        Assert.Equal(stored, resolved.LogoUrl);
    }

    [Fact]
    public void A_brand_with_no_logo_draws_no_masthead()
    {
        Assert.Equal(string.Empty, EmailBranding.Masthead(null));
        Assert.Equal(string.Empty, EmailBranding.Masthead(EmailBrand.None));

        // A name with no image, and an image with no name, are both nothing to draw: the alt
        // text names the company, so without the name there is no truthful label for it. The
        // same rule CompanyLogo.tsx applies on the respondent's own screen.
        Assert.Equal(string.Empty, EmailBranding.Masthead(new EmailBrand(null, "ESPH", null)));
        Assert.Equal(string.Empty, EmailBranding.Masthead(new EmailBrand("/brand/x.png", null, null)));
    }

    [Fact]
    public void The_masthead_carries_the_company_name_as_alt_text_and_a_fixed_height()
    {
        var html = EmailBranding.Masthead(new EmailBrand("https://climate.example.com/brand/esph-logo.png", "ESPH", null));

        Assert.Contains("""alt="ESPH" """.TrimEnd(), html, StringComparison.Ordinal);
        // The attribute, not only the style: Outlook on Windows renders through Word, which
        // ignores the style and would otherwise draw a 334px-wide lockup at full size.
        Assert.Contains("""height="32" """.TrimEnd(), html, StringComparison.Ordinal);
        Assert.Contains("src=\"https://climate.example.com/brand/esph-logo.png\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public void A_company_name_in_the_alt_text_cannot_carry_markup()
    {
        var html = EmailBranding.Masthead(new EmailBrand("/x.png", "\"><script>alert(1)</script>", null));

        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_button_keeps_the_products_own_blue_when_no_tenant_colour_is_set()
    {
        // Every company that never chose one must look exactly as it did before this change.
        var before = EmailBranding.Button("https://app.example.com/login", "Iniciar");
        var none = EmailBranding.Button("https://app.example.com/login", "Iniciar", EmailBrand.None);

        Assert.Contains(EmailBrand.DefaultAccent, before, StringComparison.Ordinal);
        Assert.Contains(EmailBrand.DefaultAccent, none, StringComparison.Ordinal);
        Assert.Contains("#ffffff", before, StringComparison.Ordinal);
    }

    [Theory]
    // Dark brands keep white text.
    [InlineData("#0b1524", "#ffffff")]
    [InlineData("#1f6feb", "#ffffff")]
    [InlineData("#B71C1C", "#ffffff")]
    // Pale ones must not. Amber with white text is the case that would have shipped.
    [InlineData("#FFC107", "#0b1524")]
    [InlineData("#FFFF00", "#0b1524")]
    [InlineData("#ffffff", "#0b1524")]
    public void The_button_text_is_whichever_of_black_and_white_can_be_read(string accent, string expected)
    {
        var html = EmailBranding.Button("https://app.example.com/login", "Iniciar", new EmailBrand(null, null, accent));

        Assert.Contains($"background:{accent}", html, StringComparison.Ordinal);
        Assert.Contains($"color:{expected}", html, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("3B82F6")]      // no hash
    [InlineData("#3B82F")]      // too short
    [InlineData("#3B82F6F")]    // too long
    [InlineData("#GGGGGG")]     // not hex
    [InlineData("rgb(0,0,0)")]
    [InlineData("")]
    [InlineData(null)]
    public void An_accent_that_is_not_six_hex_digits_falls_back_rather_than_reaching_the_style(string? accent)
    {
        // The value lands inside a style attribute unescaped, so anything that is not a colour
        // must never get there. BrandingValidation refuses these at the write, which is why
        // this is a second line rather than the only one.
        var html = EmailBranding.Button("https://app.example.com/login", "Iniciar", new EmailBrand(null, null, accent));

        Assert.Contains($"background:{EmailBrand.DefaultAccent}", html, StringComparison.Ordinal);
        Assert.DoesNotContain("rgb(", html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_shell_names_the_product_even_when_a_tenants_logo_is_blocked()
    {
        // Gmail and Outlook block remote images by default, so the masthead can simply not
        // arrive. The footer is text and always does -- which is why the product identifies
        // itself there and not at the top.
        var footer = EmailBranding.Footer("Si no esperabas este mensaje, puedes ignorarlo.");

        Assert.Contains(EmailBranding.ProductName, footer, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unbranded_document_is_the_shell_it_always_was()
    {
        var plain = EmailBranding.Document("es", "<p>hola</p>");

        Assert.DoesNotContain("<img", plain, StringComparison.Ordinal);
        Assert.Contains("<p>hola</p>", plain, StringComparison.Ordinal);
        Assert.Contains("""lang="es" """.TrimEnd(), plain, StringComparison.Ordinal);
    }

    [Fact]
    public void A_branded_document_wears_the_logo_above_the_message()
    {
        var brand = new EmailBrand("https://climate.example.com/brand/esph-logo.png", "ESPH", "#0b1524");
        var html = EmailBranding.Document("es", "<p>hola</p>", brand);

        Assert.Contains("brand/esph-logo.png", html, StringComparison.Ordinal);
        Assert.True(
            html.IndexOf("brand/esph-logo.png", StringComparison.Ordinal) < html.IndexOf("<p>hola</p>", StringComparison.Ordinal),
            "The logo belongs above the message, not after it.");
    }
}
