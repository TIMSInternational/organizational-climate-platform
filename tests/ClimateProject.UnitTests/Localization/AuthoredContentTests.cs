using ClimateProject.Application.Localization;

namespace ClimateProject.UnitTests.Localization;

// The Tier 2 (#210) rules, branch by branch. Two things differ from Tier 1 and both are
// pinned here: the content language is READ OFF the pair rather than declared, and a bare
// string on write is attributed, never refused.
public class AuthoredContentTests
{
    [Theory]
    [InlineData("Team pulse", "Pulso de equipo", ContentLanguages.Both)]
    [InlineData("Team pulse", null, ContentLanguages.English)]
    [InlineData(null, "Pulso de equipo", ContentLanguages.Spanish)]
    [InlineData("Team pulse", "   ", ContentLanguages.English)]
    [InlineData(null, null, null)]
    [InlineData("", "", null)]
    public void LanguageOf_reads_the_pair_and_treats_blank_as_absent(string? en, string? es, string? expected)
        => Assert.Equal(expected, AuthoredContent.LanguageOf(en, es));

    [Fact]
    public void A_Spanish_only_row_read_in_English_comes_back_in_Spanish_and_says_so()
    {
        // Tier 1 would need a declared 'es' to reach this branch; here the pair itself is
        // the declaration, so an undeclared Spanish-only template is never rendered blank.
        var resolved = AuthoredContent.Resolve(en: null, es: "Plantilla de clima", requestedLocale: "en");

        Assert.Equal("Plantilla de clima", resolved.Text);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.True(resolved.IsFallback);
    }

    [Fact]
    public void A_bilingual_row_answers_in_the_requested_locale_without_a_fallback()
    {
        var resolved = AuthoredContent.Resolve("Climate template", "Plantilla de clima", "es");

        Assert.Equal("Plantilla de clima", resolved.Text);
        Assert.False(resolved.IsFallback);
    }

    [Fact]
    public void Resolve_records_the_field_path_only_when_it_fell_back()
    {
        var fallbackFields = new List<string>();

        var direct = AuthoredContent.Resolve("Name", "Nombre", "es", "name", fallbackFields);
        var fallen = AuthoredContent.Resolve("Description", null, "es", "description", fallbackFields);

        Assert.Equal("Nombre", direct);
        Assert.Equal("Description", fallen);
        Assert.Equal(["description"], fallbackFields);
    }

    [Fact]
    public void ResolveRequired_never_returns_null()
        => Assert.Equal(string.Empty, AuthoredContent.ResolveRequired(null, null, "en"));

    [Theory]
    [InlineData("es", "en", "en", "es")]     // the request's declared language wins
    [InlineData(ContentLanguages.Both, "es", "en", "es")]     // 'both' names no single language: the company's
    [InlineData(null, "es", "en", "es")]
    [InlineData(null, ContentLanguages.Both, "es", "es")]     // company 'both': the author's own
    [InlineData(null, ContentLanguages.Both, "es-CO", "es")]  // a BCP-47 display preference normalises
    [InlineData(null, null, null, "en")]                      // global row, no signal: English
    [InlineData(null, null, "pt", "en")]                      // an unsupported display language is no signal
    public void AttributionLocale_prefers_the_signal_that_knows_most(string? declared, string? company, string? display, string expected)
        => Assert.Equal(expected, AuthoredContent.AttributionLocale(declared, company, display));

    [Fact]
    public void A_bare_string_is_filed_under_the_attribution_locale_and_leaves_the_other_half_alone()
    {
        string? en = "Old name";
        string? es = "Nombre antiguo";

        var ok = AuthoredContent.TryApply(LocalizedInput.FromBare("  Nombre nuevo  "), "es", "name", ref en, ref es, out var error);

        Assert.True(ok);
        Assert.Null(error);
        Assert.Equal("Old name", en);
        Assert.Equal("Nombre nuevo", es);
    }

    [Fact]
    public void A_bare_string_is_never_refused_whatever_the_pair_holds()
    {
        // Tier 1 refuses a bare string for 'both'; these fields reach no respondent and every
        // admin form sends bare strings, so the same input is attributed instead.
        string? en = "Both";
        string? es = "Ambos";

        var ok = AuthoredContent.TryApply(LocalizedInput.FromBare("Changed"), "en", "name", ref en, ref es, out var error);

        Assert.True(ok);
        Assert.Null(error);
        Assert.Equal("Changed", en);
        Assert.Equal("Ambos", es);
    }

    [Fact]
    public void A_locale_keyed_object_writes_exactly_the_halves_it_names()
    {
        string? en = "Old";
        string? es = "Viejo";

        var ok = AuthoredContent.TryApply(
            LocalizedInput.FromLocales(new Dictionary<string, string?> { ["es"] = "Nuevo" }),
            "en", "name", ref en, ref es, out _);

        Assert.True(ok);
        Assert.Equal("Old", en);
        Assert.Equal("Nuevo", es);
    }

    [Fact]
    public void An_explicit_blank_clears_that_half_to_null_not_to_an_empty_string()
    {
        string? en = "Old";
        string? es = "Viejo";

        AuthoredContent.TryApply(
            LocalizedInput.FromLocales(new Dictionary<string, string?> { ["es"] = "" }),
            "en", "name", ref en, ref es, out _);

        Assert.Equal("Old", en);
        Assert.Null(es);
        Assert.True(AuthoredContent.IsAuthored(en, es));
    }

    [Fact]
    public void An_unsupported_locale_key_is_the_one_refusal_and_it_names_the_field()
    {
        string? en = "Old";
        string? es = null;

        var ok = AuthoredContent.TryApply(
            LocalizedInput.FromLocales(new Dictionary<string, string?> { ["pt"] = "Novo" }),
            "en", "name", ref en, ref es, out var error);

        Assert.False(ok);
        Assert.Contains("'name'", error);
        Assert.Contains("pt", error);
        Assert.Equal("Old", en);
    }

    [Fact]
    public void A_null_input_leaves_both_halves_untouched()
    {
        string? en = "Old";
        string? es = "Viejo";

        var ok = AuthoredContent.TryApply(null, "en", "name", ref en, ref es, out _);

        Assert.True(ok);
        Assert.Equal("Old", en);
        Assert.Equal("Viejo", es);
    }

    [Theory]
    [InlineData("x", null, true)]
    [InlineData(null, "x", true)]
    [InlineData(null, null, false)]
    [InlineData(" ", "", false)]
    public void IsAuthored_is_true_when_any_half_holds_text(string? en, string? es, bool expected)
        => Assert.Equal(expected, AuthoredContent.IsAuthored(en, es));
}
