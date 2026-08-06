using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace ClimateProject.UnitTests.Localization;

// #195's storage contract, pinned off the EF model. Model building is entirely
// offline, so a regression here is caught by the unit suite rather than only by the
// container suite -- the DB-level proof (raw SQL insert, then EF read) lives in
// ContentI18nPersistenceTests.
public class ContentI18nModelTests
{
    private static IModel Model()
    {
        // A connection string is required to build the Npgsql model but never opened.
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql("Host=localhost;Database=model-only")
            .Options;
        using var db = new ClimateProjectDbContext(options);
        return db.Model;
    }

    private static IProperty Property(IModel model, Type entity, string name)
        => model.FindEntityType(entity)!.FindProperty(name)!;

    [Theory]
    [InlineData(typeof(Question))]
    [InlineData(typeof(TemplateQuestion))]
    public void BothCommentPromptHalvesCarryADefaultInTheirOwnLanguage(Type entity)
    {
        var model = Model();

        var en = Property(model, entity, "CommentPromptEn");
        var es = Property(model, entity, "CommentPromptEs");

        // The single column these replace shipped an English string as a DATABASE
        // default, so a Spanish-only survey got an English prompt out of the DDL
        // itself -- #195's one live defect rather than a gap.
        Assert.Equal("Please explain your answer:", en.GetDefaultValue());
        Assert.Equal("Por favor explica tu respuesta:", es.GetDefaultValue());
        Assert.False(en.IsNullable);
        Assert.False(es.IsNullable);
    }

    [Fact]
    public void ResponseRecordsTheLocaleTheRespondentWasServed()
    {
        // Did not exist before #195, and its absence was load-bearing: the word cloud
        // counted "trabajo" and "work" separately with nothing recording which
        // language anyone answered in.
        var language = Property(Model(), typeof(Response), nameof(Response.Language));

        Assert.False(language.IsNullable);
        Assert.Equal(ContentLanguages.FallbackLocale, language.GetDefaultValue());
    }

    [Theory]
    [InlineData(typeof(Survey))]
    [InlineData(typeof(Microclimate))]
    public void ContentLanguageDefaultsInTheDdlNotOnlyInTheClrInitialiser(Type entity)
    {
        var language = Property(Model(), entity, "Language");

        // A row inserted outside EF (the #154 loader, a repair script) would otherwise
        // backfill with the raw CLR default.
        Assert.False(language.IsNullable);
        Assert.Equal("en", language.GetDefaultValue());
    }

    [Theory]
    [InlineData(typeof(QuestionOption), "QuestionId")]
    [InlineData(typeof(TemplateQuestionOption), "TemplateQuestionId")]
    [InlineData(typeof(MicroclimateQuestionOption), "MicroclimateQuestionId")]
    [InlineData(typeof(MicroclimateTemplateQuestionOption), "MicroclimateTemplateQuestionId")]
    [InlineData(typeof(DemographicFieldOption), "DemographicFieldId")]
    public void EveryOptionTableKeepsItsValueUniqueAndRequired(Type entity, string ownerProperty)
    {
        var entityType = Model().FindEntityType(entity)!;

        var value = entityType.FindProperty("Value")!;
        Assert.False(value.IsNullable);

        // Two options of one parent sharing a value would make a stored answer
        // ambiguous -- exactly the failure the stable value exists to prevent.
        var unique = entityType.GetIndexes()
            .Where(i => i.IsUnique)
            .Any(i => i.Properties.Select(p => p.Name).SequenceEqual([ownerProperty, "Value"]));
        Assert.True(unique, $"{entity.Name} must have a unique index on ({ownerProperty}, Value)");

        // Both labels are optional: half a translation must be savable, or
        // side-by-side editing cannot work. Required-ness lives in the publish gate.
        Assert.True(entityType.FindProperty("LabelEn")!.IsNullable);
        Assert.True(entityType.FindProperty("LabelEs")!.IsNullable);
    }

    [Fact]
    public void NoTier1ContentColumnSurvivesUnpaired()
    {
        // A guard-shaped test needs a companion proving it still detects what it
        // should, so it enumerates the pairs rather than trusting a naming sweep.
        var model = Model();
        (Type Entity, string Base)[] pairs =
        [
            (typeof(Survey), "Title"),
            (typeof(Survey), "Description"),
            (typeof(SurveyVersion), "Title"),
            (typeof(SurveyVersion), "Description"),
            (typeof(Question), "Text"),
            (typeof(Question), "ScaleLabelMin"),
            (typeof(Question), "ScaleLabelMax"),
            (typeof(Question), "BinaryCommentConfig"),
            (typeof(TemplateQuestion), "Text"),
            (typeof(QuestionEmojiOption), "Label"),
            (typeof(Microclimate), "Title"),
            (typeof(Microclimate), "Description"),
            (typeof(MicroclimateQuestion), "Text"),
            (typeof(MicroclimateTemplateQuestion), "Text"),
            (typeof(DemographicField), "Label"),
            (typeof(SystemSettings), "MaintenanceMessage"),
            (typeof(NotificationTemplate), "Subject"),
            (typeof(NotificationTemplate), "Title"),
            (typeof(NotificationTemplate), "Content"),
            (typeof(NotificationTemplate), "HtmlContent"),
        ];

        foreach (var (entity, @base) in pairs)
        {
            var entityType = model.FindEntityType(entity)!;
            Assert.NotNull(entityType.FindProperty($"{@base}En"));
            Assert.NotNull(entityType.FindProperty($"{@base}Es"));
            // The unpaired original must be gone, not shadowed by a leftover column.
            Assert.Null(entityType.FindProperty(@base));
        }
    }

    [Fact]
    public void TheUnpairedCheckActuallyDetectsAnUnpairedColumn()
    {
        // Companion to the guard above: a monolingual column that is NOT translatable
        // still exists, so "FindProperty returns null for everything" cannot make the
        // guard pass vacuously.
        var entityType = Model().FindEntityType(typeof(DemographicField))!;

        Assert.NotNull(entityType.FindProperty(nameof(DemographicField.Field)));
        Assert.Null(entityType.FindProperty("FieldEn"));
    }
}
