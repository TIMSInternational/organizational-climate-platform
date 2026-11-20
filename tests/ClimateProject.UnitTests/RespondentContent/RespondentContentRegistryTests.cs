using System.Runtime.CompilerServices;
using System.Text.Json;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.RespondentContent;

/// <summary>
/// The registry against the catalogues it points into (<c>web/src/i18n/{es,en}.json</c>), the way
/// <c>AuditActionLabelsTests</c> reads them: a screen key that no screen can resolve, or an
/// override allowed a placeholder its default never fills, would be an editor that lies.
/// </summary>
public class RespondentContentRegistryTests
{
    private const string Namespace = "surveyRespond";

    private static readonly JsonDocument Es = Catalogue("es");
    private static readonly JsonDocument En = Catalogue("en");

    public static TheoryData<string> ScreenKeys()
    {
        var data = new TheoryData<string>();
        foreach (var entry in RespondentContentRegistry.Entries.Where(e => e.Kind == RespondentContentKinds.Screen))
        {
            data.Add(entry.Key);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(ScreenKeys))]
    public void Every_screen_key_is_a_string_in_both_catalogues_under_surveyRespond(string key)
    {
        Assert.True(Lookup(Es, key) is { Length: > 0 }, $"surveyRespond.{key} is missing from es.json");
        Assert.True(Lookup(En, key) is { Length: > 0 }, $"surveyRespond.{key} is missing from en.json");
    }

    /// <summary>
    /// "Exactly those the product default uses": the registry's allowed set equals the
    /// placeholders of the Spanish default and of the English one.
    /// </summary>
    [Theory]
    [MemberData(nameof(ScreenKeys))]
    public void A_screen_keys_placeholders_are_exactly_those_its_defaults_use(string key)
    {
        Assert.True(RespondentContentRegistry.TryGet(key, out var entry));
        var declared = entry.Placeholders.Order(StringComparer.Ordinal).ToList();

        Assert.Equal(declared, RespondentContentPlaceholders.In(Lookup(Es, key)).Order(StringComparer.Ordinal).ToList());
        Assert.Equal(declared, RespondentContentPlaceholders.In(Lookup(En, key)).Order(StringComparer.Ordinal).ToList());
    }

    [Theory]
    [MemberData(nameof(ScreenKeys))]
    public void Every_screen_default_fits_its_own_maximum(string key)
    {
        Assert.True(RespondentContentRegistry.TryGet(key, out var entry));
        Assert.True(Lookup(Es, key)!.Length <= entry.MaxLength, $"es default of {key} is longer than {entry.MaxLength}");
        Assert.True(Lookup(En, key)!.Length <= entry.MaxLength, $"en default of {key} is longer than {entry.MaxLength}");
    }

    /// <summary>The three key families can never collide: no email or display prefix exists as a screen path.</summary>
    [Theory]
    [InlineData("email")]
    [InlineData("display")]
    public void The_email_and_display_prefixes_are_not_paths_under_surveyRespond(string prefix)
    {
        Assert.False(Es.RootElement.GetProperty(Namespace).TryGetProperty(prefix, out _));
        Assert.False(En.RootElement.GetProperty(Namespace).TryGetProperty(prefix, out _));
        Assert.All(
            RespondentContentRegistry.Entries.Where(e => e.Key.StartsWith(prefix + ".", StringComparison.Ordinal)),
            e => Assert.Equal(prefix == "email" ? RespondentContentKinds.Email : RespondentContentKinds.Display, e.Kind));
    }

    [Fact]
    public void Keys_are_unique_and_every_entry_is_well_formed()
    {
        var entries = RespondentContentRegistry.Entries;
        Assert.Equal(entries.Count, entries.Select(e => e.Key).Distinct(StringComparer.Ordinal).Count());

        foreach (var entry in entries)
        {
            Assert.Contains(entry.Kind, RespondentContentKinds.All);
            Assert.InRange(entry.MaxLength, 1, RespondentContentRegistry.StorageMaxLength);
            Assert.True(entry.Key.Length <= 100, $"{entry.Key} would not fit respondent_content_overrides.key");
            Assert.False(string.IsNullOrWhiteSpace(entry.Group));

            if (entry.IsDisplay)
            {
                Assert.NotEmpty(entry.AllowedValues);
                Assert.Contains(entry.DefaultValue!, entry.AllowedValues);
                Assert.Empty(entry.Placeholders);
                Assert.Equal(entry.AllowedValues.Max(v => v.Length), entry.MaxLength);
                Assert.True(entry.TakesLocale("*"));
                Assert.False(entry.TakesLocale("es"));
            }
            else
            {
                Assert.Empty(entry.AllowedValues);
                Assert.Null(entry.DefaultValue);
                Assert.True(entry.TakesLocale("es") && entry.TakesLocale("en"));
                Assert.False(entry.TakesLocale("*"));
            }

            if (entry.Kind == RespondentContentKinds.Email)
            {
                Assert.Equal(["survey", "company"], entry.Placeholders);
            }
        }
    }

    /// <summary>
    /// A legacy key's limit is its column's: the survey PUT writes the column, and a longer value
    /// would be refused by Postgres instead of by the validation.
    /// </summary>
    [Theory]
    [InlineData(RespondentContentLegacyColumns.RespondentIntro, "anonymousBody", SurveyRespondentText.IntroMaxLength)]
    [InlineData(RespondentContentLegacyColumns.ClosingMessage, "thankYouTitle", SurveyRespondentText.ClosingMaxLength)]
    [InlineData(RespondentContentLegacyColumns.InvitationCustomSubject, "email.personalLink.subject", 200)]
    [InlineData(RespondentContentLegacyColumns.InvitationCustomMessage, "email.personalLink.message", 1000)]
    public void Each_legacy_column_maps_to_one_key_with_the_columns_width(string column, string key, int width)
    {
        var entry = RespondentContentRegistry.ForLegacyColumn(column);
        Assert.NotNull(entry);
        Assert.Equal(key, entry.Key);
        Assert.Equal(width, entry.MaxLength);
        Assert.Single(RespondentContentRegistry.Entries, e => e.LegacyColumn == column);
    }

    /// <summary>
    /// An author's prose must never be able to hide that names are kept
    /// (<c>SurveySettings.RespondentIntroEn</c>): the identified wording and the device notes
    /// that state what is recorded are not overridable.
    /// </summary>
    [Theory]
    [InlineData("identifiedChip")]
    [InlineData("identifiedTitle")]
    [InlineData("identifiedBody")]
    [InlineData("answeredOnThisDeviceBody")]
    [InlineData("answeredOnThisDeviceBodyRecorded")]
    public void The_wording_that_states_what_is_recorded_is_not_overridable(string key)
        => Assert.False(RespondentContentRegistry.TryGet(key, out _));

    [Fact]
    public void The_text_alignment_is_justified_or_start_and_justified_by_default()
    {
        Assert.True(RespondentContentRegistry.TryGet(RespondentContentRegistry.DisplayTextAlign, out var entry));
        Assert.Equal(["justify", "start"], entry.AllowedValues);
        Assert.Equal("justify", entry.DefaultValue);
    }

    [Theory]
    [InlineData("{count} preguntas. {minutes} minutos.", new[] { "count", "minutes" })]
    [InlineData("Cierra el {date} y el {date}.", new[] { "date" })]
    [InlineData("{ no } {} {fecha-larga} {ñ}", new string[0])]
    [InlineData("", new string[0])]
    public void Placeholders_are_read_as_translate_ts_interpolates_them(string text, string[] expected)
        => Assert.Equal(expected, RespondentContentPlaceholders.In(text));

    private static string? Lookup(JsonDocument catalogue, string key)
    {
        var node = catalogue.RootElement.GetProperty(Namespace);
        foreach (var segment in key.Split('.'))
        {
            if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(segment, out node))
            {
                return null;
            }
        }

        return node.ValueKind == JsonValueKind.String ? node.GetString() : null;
    }

    private static JsonDocument Catalogue(string locale)
        => JsonDocument.Parse(File.ReadAllText(Path.Combine(RepositoryRoot(), "web", "src", "i18n", $"{locale}.json")));

    private static string RepositoryRoot([CallerFilePath] string thisFile = "")
    {
        var dir = new DirectoryInfo(Path.GetDirectoryName(thisFile)!);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ClimateProject.slnx")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("ClimateProject.slnx not found above " + thisFile);
    }
}
