using ClimateProject.Application.Localization;

namespace ClimateProject.UnitTests.Localization;

// The read-time resolution rule from #195, branch by branch.
//
// It is deliberately asymmetric -- UI strings fall back to English, authored content
// does not silently -- so the asymmetry is pinned here rather than left to be
// rediscovered as a bug report about a Spanish survey rendering in English.
public class LocalizedContentTests
{
    [Fact]
    public void ReturnsTheRequestedLocaleWhenItWasAuthored()
    {
        var resolved = LocalizedContent.Resolve("Team pulse", "Pulso de equipo", "es", ContentLanguages.Both);

        Assert.Equal("Pulso de equipo", resolved.Text);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.False(resolved.IsFallback);
    }

    [Fact]
    public void FallsBackToTheContentsOwnLanguageBeforeEnglish()
    {
        // A Spanish-only survey asked for in English falls back to ITS OWN Spanish,
        // not to an English column that was never authored.
        var resolved = LocalizedContent.Resolve(en: null, es: "Pulso de equipo", requestedLocale: "en", contentLanguage: "es");

        Assert.Equal("Pulso de equipo", resolved.Text);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.True(resolved.IsFallback);
    }

    [Fact]
    public void FallsBackToEnglishAsTheLastResort()
    {
        var resolved = LocalizedContent.Resolve("Team pulse", es: null, requestedLocale: "es", contentLanguage: ContentLanguages.Both);

        Assert.Equal("Team pulse", resolved.Text);
        Assert.Equal("en", resolved.ResolvedLocale);
        Assert.True(resolved.IsFallback);
    }

    [Fact]
    public void ReturnsNullRatherThanAnEmptyStringOrAKeyPathWhenNothingWasAuthored()
    {
        // #78 fixed a real bug where 8 missing keys rendered raw key paths to Spanish
        // users. The same failure at content level must not be reintroduced, so the
        // resolver returns null and lets the caller decide what to render.
        var resolved = LocalizedContent.Resolve(en: null, es: null, requestedLocale: "es", contentLanguage: ContentLanguages.Both);

        Assert.Null(resolved.Text);
        Assert.Null(resolved.ResolvedLocale);
        Assert.False(resolved.IsFallback);
    }

    [Fact]
    public void TreatsWhitespaceAsAbsentRatherThanAsContent()
    {
        var resolved = LocalizedContent.Resolve("Team pulse", "   ", "es", ContentLanguages.Both);

        Assert.Equal("Team pulse", resolved.Text);
        Assert.True(resolved.IsFallback);
    }

    [Fact]
    public void AnEnglishRequestWithNoEnglishContentDoesNotSilentlyRenderSpanish()
    {
        // The one branch that returns nothing despite a translation existing. It is
        // intentional: content authored as 'both' but missing its English half should
        // never have been published (the publish gate rejects it), so serving the
        // Spanish under an English label would hide a defect rather than surface it.
        var resolved = LocalizedContent.Resolve(en: null, es: "Pulso", requestedLocale: "en", contentLanguage: ContentLanguages.Both);

        Assert.Null(resolved.Text);
    }

    [Theory]
    [InlineData("es-CO", "es")]
    [InlineData("EN-us", "en")]
    [InlineData("es_MX", "es")]
    [InlineData("pt", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void NormalisesBcp47TagsAndRejectsUnknownOnes(string? raw, string? expected)
        => Assert.Equal(expected, ContentLanguages.NormaliseLocale(raw));

    [Fact]
    public void AnUnrecognisedRequestLocaleIsTreatedAsEnglishRatherThanAsAnError()
    {
        // A ?lang=pt from a bookmarked URL must render something, not 500.
        var resolved = LocalizedContent.Resolve("Team pulse", "Pulso", "pt", ContentLanguages.Both);

        Assert.Equal("Team pulse", resolved.Text);
        Assert.Equal("en", resolved.ResolvedLocale);
        Assert.False(resolved.IsFallback);
    }

    [Theory]
    [InlineData("both", new[] { "en", "es" })]
    [InlineData("es", new[] { "es" })]
    [InlineData("en", new[] { "en" })]
    [InlineData(null, new[] { "en" })]
    public void RequiredLocalesFollowsTheContentsOwnLanguage(string? language, string[] expected)
        => Assert.Equal(expected, ContentLanguages.RequiredLocales(language));
}
