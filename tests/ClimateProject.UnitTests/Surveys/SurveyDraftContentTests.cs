using System.Text.Json;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyDraftContentTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    // ------------------------------------------------------------------
    // Envelope round-trip
    // ------------------------------------------------------------------

    [Fact]
    public void Round_trips_paired_locales_and_opaque_content()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both,
            "Team pulse",
            "Pulso de equipo",
            "How we are doing",
            "Cómo vamos",
            Json("""{"step":2,"selected":["a","b"],"nested":{"n":1}}"""));

        var parsed = SurveyDraftContent.Parse(SurveyDraftContent.Serialise(envelope));

        Assert.Equal(ContentLanguages.Both, parsed.Language);
        Assert.Equal("Team pulse", parsed.TitleEn);
        Assert.Equal("Pulso de equipo", parsed.TitleEs);
        Assert.Equal("How we are doing", parsed.DescriptionEn);
        Assert.Equal("Cómo vamos", parsed.DescriptionEs);
        Assert.Equal(
            """{"step":2,"selected":["a","b"],"nested":{"n":1}}""",
            parsed.Content!.Value.GetRawText());
    }

    [Fact]
    public void Empty_draft_round_trips_to_an_empty_envelope()
    {
        var parsed = SurveyDraftContent.Parse(
            SurveyDraftContent.Serialise(SurveyDraftEnvelope.Empty with { Language = ContentLanguages.English }));

        Assert.Equal(ContentLanguages.English, parsed.Language);
        Assert.Null(parsed.TitleEn);
        Assert.Null(parsed.TitleEs);
        Assert.Null(parsed.Content);
    }

    /// <summary>
    /// The schema marker is the discriminator that tells our envelope from a foreign blob.
    /// Pinned by a test because dropping it would silently reclassify every existing draft
    /// as opaque content and lose its title.
    /// </summary>
    [Fact]
    public void Serialised_envelope_carries_the_schema_marker()
    {
        var raw = SurveyDraftContent.Serialise(
            SurveyDraftEnvelope.Empty with { Language = ContentLanguages.English });

        using var document = JsonDocument.Parse(raw);
        Assert.Equal(SurveyDraftContent.SchemaVersion, document.RootElement.GetProperty("schema").GetInt32());
    }

    [Fact]
    public void An_explicit_json_null_content_is_absence_not_a_snapshot()
    {
        var parsed = SurveyDraftContent.Parse($$"""{"schema":{{SurveyDraftContent.SchemaVersion}},"content":null}""");

        Assert.Null(parsed.Content);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Missing_draft_data_is_an_empty_envelope_rather_than_a_throw(string? draftData)
    {
        var parsed = SurveyDraftContent.Parse(draftData);

        Assert.Same(SurveyDraftEnvelope.Empty, parsed);
    }

    /// <summary>
    /// The row shape the existing persistence test writes
    /// (<c>SurveyDraftAndVersionTests.Draft_round_trips_with_jsonb_scratchpad</c>) predates
    /// this envelope. It must still load, whole, as opaque content -- a draft the server
    /// silently drops on read is the exact failure this feature exists to prevent.
    /// </summary>
    [Fact]
    public void Legacy_blob_without_a_schema_marker_survives_intact_as_opaque_content()
    {
        const string legacy = """{"step1_data":{"title":"Draft Title"},"step2_data":{"questions":[]}}""";

        var parsed = SurveyDraftContent.Parse(legacy);

        Assert.Null(parsed.Language);
        Assert.Null(parsed.TitleEn);
        Assert.NotNull(parsed.Content);
        Assert.Equal(legacy, parsed.Content!.Value.GetRawText());
    }

    [Fact]
    public void Legacy_blob_survives_a_subsequent_save_that_only_adds_a_title()
    {
        var stored = SurveyDraftContent.Parse("""{"step1_data":{"title":"Draft Title"}}""");

        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.English, "Renamed", null, null, null, content: null);
        var reloaded = SurveyDraftContent.Parse(SurveyDraftContent.Serialise(merged));

        Assert.Equal("Renamed", reloaded.TitleEn);
        Assert.Equal("""{"step1_data":{"title":"Draft Title"}}""", reloaded.Content!.Value.GetRawText());
    }

    [Fact]
    public void Malformed_draft_data_degrades_to_empty_instead_of_throwing()
    {
        var parsed = SurveyDraftContent.Parse("{not json");

        Assert.Same(SurveyDraftEnvelope.Empty, parsed);
    }

    // ------------------------------------------------------------------
    // Merge semantics
    // ------------------------------------------------------------------

    [Fact]
    public void Omitted_locale_leaves_the_stored_one_alone()
    {
        var stored = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", null, null, null);

        // Only the English title supplied: TryResolve hands null for "es not sent".
        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.Both, "Team pulse v2", null, null, null, content: null);

        Assert.Equal("Team pulse v2", merged.TitleEn);
        Assert.Equal("Pulso de equipo", merged.TitleEs);
    }

    [Fact]
    public void Explicit_empty_string_clears_a_translation()
    {
        var stored = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", null, null, null);

        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.Both, null, string.Empty, null, null, content: null);

        Assert.Equal("Team pulse", merged.TitleEn);
        Assert.Equal(string.Empty, merged.TitleEs);
    }

    [Fact]
    public void Content_is_replaced_wholesale_not_deep_merged()
    {
        var stored = SurveyDraftEnvelope.Empty with
        {
            Language = ContentLanguages.English,
            Content = Json("""{"questions":[{"id":1},{"id":2}]}"""),
        };

        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.English, null, null, null, null, Json("""{"questions":[{"id":1}]}"""));

        // A deep merge would resurrect question 2, which is how a deletion undoes itself.
        Assert.Equal("""{"questions":[{"id":1}]}""", merged.Content!.Value.GetRawText());
    }

    [Fact]
    public void Omitted_content_leaves_the_stored_snapshot_alone()
    {
        var stored = SurveyDraftEnvelope.Empty with
        {
            Language = ContentLanguages.English,
            Content = Json("""{"step":4}"""),
        };

        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.English, "Only the title moved", null, null, null, content: null);

        Assert.Equal("""{"step":4}""", merged.Content!.Value.GetRawText());
    }

    [Fact]
    public void Merge_adopts_the_supplied_language()
    {
        var stored = SurveyDraftEnvelope.Empty with { Language = ContentLanguages.English };

        var merged = SurveyDraftContent.Merge(
            stored, ContentLanguages.Both, null, "Pulso", null, null, content: null);

        Assert.Equal(ContentLanguages.Both, merged.Language);
    }

    // ------------------------------------------------------------------
    // Read-time resolution -- no En/Es on the way out
    // ------------------------------------------------------------------

    [Fact]
    public void Resolves_the_requested_locale_when_it_was_authored()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", null, null, null);

        var resolved = SurveyDraftContent.Resolve(envelope, "es");

        Assert.Equal("Pulso de equipo", resolved.Title);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.Empty(resolved.FallbackFields);
    }

    /// <summary>
    /// The bug #104 shipped and had caught: ResolvedLocale is the locale the text is
    /// ACTUALLY in, not the one that was asked for. A Spanish-only draft read with
    /// ?lang=en comes back in Spanish and has to say 'es'.
    /// </summary>
    [Fact]
    public void Spanish_only_draft_read_as_english_reports_es_not_en()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Spanish, null, "Pulso de equipo", null, null, null);

        var resolved = SurveyDraftContent.Resolve(envelope, "en");

        Assert.Equal("Pulso de equipo", resolved.Title);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.Contains("title", resolved.FallbackFields);
    }

    [Fact]
    public void Spanish_only_draft_read_without_a_lang_renders_in_spanish()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Spanish, null, "Pulso de equipo", null, null, null);

        var resolved = SurveyDraftContent.Resolve(envelope, lang: null);

        Assert.Equal("Pulso de equipo", resolved.Title);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.Empty(resolved.FallbackFields);
    }

    [Fact]
    public void Half_translated_both_draft_falls_back_per_field_and_says_so()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both,
            "Team pulse",
            "Pulso de equipo",
            "How we are doing",
            DescriptionEs: null,
            Content: null);

        var resolved = SurveyDraftContent.Resolve(envelope, "es");

        Assert.Equal("Pulso de equipo", resolved.Title);
        Assert.Equal("es", resolved.ResolvedLocale);
        Assert.Equal("How we are doing", resolved.Description);
        Assert.Equal(["description"], resolved.FallbackFields);
    }

    [Fact]
    public void An_absent_field_is_null_and_is_not_reported_as_a_fallback()
    {
        var envelope = SurveyDraftEnvelope.Empty with { Language = ContentLanguages.English };

        var resolved = SurveyDraftContent.Resolve(envelope, "en");

        Assert.Null(resolved.Title);
        Assert.Null(resolved.Description);
        Assert.Empty(resolved.FallbackFields);
        Assert.Equal("en", resolved.ResolvedLocale);
    }

    [Fact]
    public void An_unrecognised_lang_falls_back_rather_than_throwing()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", null, null, null);

        var resolved = SurveyDraftContent.Resolve(envelope, "pt-BR");

        Assert.Equal("Team pulse", resolved.Title);
        Assert.Equal("en", resolved.ResolvedLocale);
    }

    // ------------------------------------------------------------------
    // Publish readiness -- advisory, not a gate
    // ------------------------------------------------------------------

    [Fact]
    public void A_both_draft_missing_the_spanish_title_reports_it()
    {
        var envelope = new SurveyDraftEnvelope(ContentLanguages.Both, "Team pulse", null, null, null, null);

        var missing = SurveyDraftContent.MissingTranslations(envelope);

        Assert.Equal([new MissingTranslation("title", "es")], missing);
    }

    [Fact]
    public void A_both_draft_with_a_one_sided_description_reports_the_other_side()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", "How we are doing", null, null);

        var missing = SurveyDraftContent.MissingTranslations(envelope);

        Assert.Equal([new MissingTranslation("description", "es")], missing);
    }

    [Fact]
    public void An_untouched_optional_description_is_not_a_missing_translation()
    {
        var envelope = new SurveyDraftEnvelope(
            ContentLanguages.Both, "Team pulse", "Pulso de equipo", null, null, null);

        Assert.Empty(SurveyDraftContent.MissingTranslations(envelope));
    }

    [Fact]
    public void A_single_language_draft_never_demands_the_other_language()
    {
        var envelope = new SurveyDraftEnvelope(ContentLanguages.Spanish, null, "Pulso de equipo", null, null, null);

        Assert.Empty(SurveyDraftContent.MissingTranslations(envelope));
    }

    [Fact]
    public void A_brand_new_empty_draft_reports_its_missing_title_and_is_still_savable()
    {
        // The report is advisory: ContentPublishValidation is explicit that draft-time is
        // a warning and publish-time is the gate. Nothing here refuses anything.
        var envelope = SurveyDraftEnvelope.Empty with { Language = ContentLanguages.English };

        Assert.Equal([new MissingTranslation("title", "en")], SurveyDraftContent.MissingTranslations(envelope));
    }
}
