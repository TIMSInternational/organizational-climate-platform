using System.Text.Json;
using ClimateProject.Application.Localization;

namespace ClimateProject.UnitTests.Localization;

// The write side. A bare string is *attributed* to the content's own language -- the
// same rule #154's ETL has to apply to legacy rows, which carry one string and no
// language field at all.
public class LocalizedInputTests
{
    private static LocalizedInput Parse(string json)
        => JsonSerializer.Deserialize<LocalizedInput>(json)!;

    [Fact]
    public void ALocaleKeyedObjectWritesBothColumns()
    {
        var input = Parse("""{ "en": "Team pulse", "es": "Pulso de equipo" }""");

        Assert.True(input.TryResolve(ContentLanguages.Both, "title", out var en, out var es, out var error));

        Assert.Equal("Team pulse", en);
        Assert.Equal("Pulso de equipo", es);
        Assert.Null(error);
    }

    [Fact]
    public void ABareStringIsAttributedToTheContentsOwnLanguage()
    {
        var input = Parse("\"Pulso de equipo\"");

        Assert.True(input.TryResolve("es", "title", out var en, out var es, out _));

        Assert.Null(en);
        Assert.Equal("Pulso de equipo", es);
    }

    [Fact]
    public void ABareStringIsRejectedWhenTheContentIsAuthoredInBothLanguages()
    {
        // Guessing here is how Spanish text ends up in the English column: a defect
        // that reconciles by row count and is invisible until someone reads a survey.
        var input = Parse("\"Pulso de equipo\"");

        Assert.False(input.TryResolve(ContentLanguages.Both, "title", out _, out _, out var error));
        Assert.Contains("both languages", error);
    }

    [Fact]
    public void AnUnsupportedLocaleKeyIsNamedInTheError()
    {
        var input = Parse("""{ "en": "Team pulse", "pt": "Pulso" }""");

        Assert.False(input.TryResolve(ContentLanguages.Both, "title", out _, out _, out var error));
        Assert.Contains("'pt'", error);
        Assert.Contains("title", error);
    }

    [Fact]
    public void AnOmittedLocaleResolvesToNullSoAnUpdateLeavesItAlone()
    {
        var input = Parse("""{ "es": "Pulso de equipo" }""");

        Assert.True(input.TryResolve(ContentLanguages.Both, "title", out var en, out var es, out _));

        // null means "not supplied"; clearing a translation is an explicit empty string.
        Assert.Null(en);
        Assert.Equal("Pulso de equipo", es);
    }

    [Fact]
    public void AnExplicitEmptyStringIsDistinctFromAnOmittedLocale()
    {
        var input = Parse("""{ "en": "" }""");

        Assert.True(input.TryResolve(ContentLanguages.Both, "title", out var en, out _, out _));

        Assert.Equal(string.Empty, en);
    }

    [Fact]
    public void ALocaleKeyIsCaseAndRegionInsensitive()
    {
        var input = Parse("""{ "ES-mx": "Pulso de equipo" }""");

        Assert.True(input.TryResolve(ContentLanguages.Both, "title", out _, out var es, out _));
        Assert.Equal("Pulso de equipo", es);
    }

    [Fact]
    public void ANullLiteralDeserialisesToNullRatherThanAnEmptyInput()
        => Assert.Null(JsonSerializer.Deserialize<LocalizedInput>("null"));

    [Fact]
    public void ANumberIsARequestError()
        => Assert.Throws<JsonException>(() => Parse("42"));
}
