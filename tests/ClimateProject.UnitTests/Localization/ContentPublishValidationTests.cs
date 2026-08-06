using ClimateProject.Application.Localization;

namespace ClimateProject.UnitTests.Localization;

// The write-time gate. The requirement's acceptance test -- "Export/show the survey in
// ES and EN without 'untranslated' strings" -- has to be deterministically true, and a
// read-time fallback can only ever make it usually true.
public class ContentPublishValidationTests
{
    private static LocalizedFieldValue[] OneRequiredAndOneOptional(string? en, string? es, string? descEn = null, string? descEs = null)
        => [
            new("title", en, es, Required: true),
            new("description", descEn, descEs, Required: false),
        ];

    [Fact]
    public void BothRejectsAMissingSpanishTranslationAndNamesTheFieldAndLocale()
    {
        var missing = ContentPublishValidation.FindMissing(ContentLanguages.Both, OneRequiredAndOneOptional("Team pulse", null));

        var only = Assert.Single(missing);
        Assert.Equal("title", only.Field);
        Assert.Equal("es", only.Locale);
    }

    [Fact]
    public void SpanishRejectsAMissingSpanishTranslation()
    {
        var missing = ContentPublishValidation.FindMissing("es", OneRequiredAndOneOptional("Team pulse", null));

        Assert.Equal([new MissingTranslation("title", "es")], missing);
    }

    [Fact]
    public void SpanishDoesNotDemandAnEnglishTranslation()
    {
        // The gate stays out of the way of single-language surveys, which is the whole
        // reason 'both' is an explicit opt-in rather than the default.
        var missing = ContentPublishValidation.FindMissing("es", OneRequiredAndOneOptional(null, "Pulso de equipo"));

        Assert.Empty(missing);
    }

    [Fact]
    public void AnOptionalFieldNobodyFilledInIsNotAMissingTranslation()
    {
        var missing = ContentPublishValidation.FindMissing(ContentLanguages.Both, OneRequiredAndOneOptional("Team pulse", "Pulso"));

        Assert.Empty(missing);
    }

    [Fact]
    public void AnOptionalFieldFilledInOneLanguageMustBeFilledInTheOther()
    {
        // Half a description is worse than none: the survey renders in Spanish with an
        // English paragraph in the middle of it, which is exactly the "untranslated
        // string" the test case forbids.
        var missing = ContentPublishValidation.FindMissing(
            ContentLanguages.Both,
            OneRequiredAndOneOptional("Team pulse", "Pulso", descEn: "How is it going"));

        Assert.Equal([new MissingTranslation("description", "es")], missing);
    }

    [Fact]
    public void WhitespaceIsNotATranslation()
    {
        var missing = ContentPublishValidation.FindMissing(ContentLanguages.Both, OneRequiredAndOneOptional("Team pulse", "   "));

        Assert.Single(missing);
    }

    [Fact]
    public void TheMessageListsEveryMissingPairRatherThanACount()
    {
        // #108's acceptance criteria require validation to "be honest about what
        // publishing does" -- an admin has to know which question in which language.
        var missing = ContentPublishValidation.FindMissing(
            ContentLanguages.Both,
            [
                new("title", null, null, Required: true),
                new("questions[0].text", "How are you?", null, Required: true),
            ]);

        var described = ContentPublishValidation.Describe(missing);

        Assert.Contains("title (en)", described);
        Assert.Contains("title (es)", described);
        Assert.Contains("questions[0].text (es)", described);
        Assert.DoesNotContain("questions[0].text (en)", described);
    }

    [Theory]
    [InlineData("draft", "active", true)]
    [InlineData("draft", "scheduled", true)]
    [InlineData("draft", "draft", false)]
    [InlineData("active", "closed", false)]
    [InlineData("draft", null, false)]
    public void OnlyLeavingDraftIsAPublishTransition(string? from, string? to, bool expected)
        => Assert.Equal(expected, ContentPublishValidation.IsPublishTransition(from, to));
}
