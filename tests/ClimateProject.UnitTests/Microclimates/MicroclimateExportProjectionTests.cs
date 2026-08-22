using System.Text;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// The disclosure control on the export, and the CSV rendering of the result.
/// </summary>
public class MicroclimateExportProjectionTests
{
    private static MicroclimateExport Project(
        int responseCount,
        IReadOnlyList<WordCloudEntry> words,
        int targetParticipantCount = 40,
        IReadOnlyList<string>? fallbackFields = null)
        => MicroclimateExportProjection.Project(
            Guid.NewGuid(),
            "Weekly pulse",
            "How is the team feeling",
            Guid.NewGuid(),
            MicroclimateStatuses.Closed,
            "en",
            "en",
            fallbackFields ?? [],
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddHours(1),
            responseCount,
            targetParticipantCount,
            "medium",
            0,
            [],
            words,
            DateTimeOffset.UtcNow);

    [Fact]
    public void A_session_below_the_respondent_floor_withholds_every_word()
    {
        var words = new[]
        {
            new WordCloudEntry("visa", 4, "en"),
            new WordCloudEntry("renewal", 3, "en"),
        };

        // Four responses, floor is five. "my visa renewal" names its author to anyone who
        // knows the team, however many times they typed it.
        var export = Project(responseCount: SurveyResultsPrivacy.MinimumRespondents - 1, words);

        Assert.True(export.IsSuppressed);
        Assert.Empty(export.Words);
        Assert.Equal(MicroclimateExportProjection.BelowMinimumRespondents, export.SuppressionReason);
    }

    [Fact]
    public void Withheld_words_are_counted_so_the_reader_can_tell_withheld_from_empty()
    {
        var export = Project(
            responseCount: 2,
            words: [new WordCloudEntry("visa", 1, "en"), new WordCloudEntry("renewal", 1, "en")]);

        // Not blanked: a reader has to be able to tell "no one wrote anything" from "this
        // was withheld", or they go looking for the raw data.
        Assert.Equal(2, export.WithheldWordCount);
    }

    [Fact]
    public void Participation_counters_are_never_suppressed()
    {
        var export = Project(responseCount: 2, words: [new WordCloudEntry("visa", 1, "en")]);

        // "2 of 40 so far" identifies nobody, and it is the number that tells an admin
        // whether to keep chasing responses.
        Assert.True(export.IsSuppressed);
        Assert.Equal(2, export.ResponseCount);
        Assert.Equal(40, export.TargetParticipantCount);
        Assert.Equal(5, export.ParticipationPercent);
    }

    [Fact]
    public void Above_the_session_floor_rare_words_are_dropped_and_counted()
    {
        var words = new[]
        {
            new WordCloudEntry("workload", 6, "en"),
            new WordCloudEntry("visa", 1, "en"),
        };

        var export = Project(responseCount: 10, words);

        Assert.False(export.IsSuppressed);
        Assert.Equal("workload", Assert.Single(export.Words).Text);
        Assert.Equal(1, export.WithheldWordCount);
        Assert.Equal(MicroclimateExportProjection.RareWordsWithheld, export.SuppressionReason);
    }

    [Fact]
    public void Nothing_withheld_reports_no_reason()
    {
        var export = Project(responseCount: 10, words: [new WordCloudEntry("workload", 6, "en")]);

        Assert.False(export.IsSuppressed);
        Assert.Null(export.SuppressionReason);
        Assert.Equal(0, export.WithheldWordCount);
    }

    [Fact]
    public void Participation_percent_is_null_rather_than_zero_when_there_is_no_denominator()
    {
        // A rate computed against a target of zero is an invented denominator.
        var export = Project(responseCount: 10, words: [], targetParticipantCount: 0);
        Assert.Null(export.ParticipationPercent);
    }

    [Fact]
    public void The_floors_are_bound_to_the_survey_surfaces_constants()
    {
        // A microclimate group is small by nature. A floor lower than the survey surface's
        // would make this the cheapest place in the product to difference one workforce
        // against itself, so the two must move together.
        var atFloor = Project(
            responseCount: SurveyResultsPrivacy.MinimumRespondents,
            words: [new WordCloudEntry("workload", SurveyResultsPrivacy.MinimumWordRespondents, "en")]);

        Assert.False(atFloor.IsSuppressed);
        Assert.Single(atFloor.Words);
    }

    // ------------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------------

    private static string Csv(MicroclimateExport export)
        => Encoding.UTF8.GetString(MicroclimateExportProjection.ToCsv(export));

    [Fact]
    public void The_csv_starts_with_a_utf8_bom_so_excel_does_not_mangle_spanish()
    {
        var bytes = MicroclimateExportProjection.ToCsv(Project(10, []));

        Assert.Equal(0xEF, bytes[0]);
        Assert.Equal(0xBB, bytes[1]);
        Assert.Equal(0xBF, bytes[2]);
    }

    [Fact]
    public void A_word_a_respondent_typed_cannot_become_a_formula_in_the_readers_spreadsheet()
    {
        // The reader is by definition a CompanyAdmin or SuperAdmin, and the word came from
        // an unauthenticated respondent, so the payload would run with the reader's
        // authority on the reader's machine. Quoting alone does not stop it.
        var export = Project(
            responseCount: 10,
            words: [new WordCloudEntry("=cmd|'/c calc'!A1", 7, "en")]);

        Assert.Contains("\"'=cmd|'/c calc'!A1\"", Csv(export), StringComparison.Ordinal);
    }

    [Fact]
    public void A_word_containing_a_delimiter_or_a_quote_survives_the_round_trip()
    {
        var export = Project(
            responseCount: 10,
            words: [new WordCloudEntry("pay,\"rise\"", 7, "en")]);

        Assert.Contains("\"pay,\"\"rise\"\"\"", Csv(export), StringComparison.Ordinal);
    }

    [Fact]
    public void A_suppressed_session_writes_no_word_rows_but_still_reports_the_counters()
    {
        var export = Project(
            responseCount: 2,
            words: [new WordCloudEntry("visa", 1, "en")]);

        var csv = Csv(export);

        Assert.DoesNotContain("visa", csv, StringComparison.Ordinal);
        Assert.Contains("\"is_suppressed\",\"\",\"true\"", csv, StringComparison.Ordinal);
        Assert.Contains("\"withheld_word_count\",\"\",\"1\"", csv, StringComparison.Ordinal);
        Assert.Contains("\"response_count\",\"\",\"2\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public void Numbers_are_written_invariantly_whatever_the_hosts_culture()
    {
        var original = Thread.CurrentThread.CurrentCulture;
        try
        {
            // A Spanish culture renders 0.5 as "0,5", which inside a comma-delimited file
            // is a value that has to be quoted to survive and reads as text once it is.
            Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("es-ES");
            var export = Project(responseCount: 10, words: [], targetParticipantCount: 8);

            Assert.Contains("\"participation_percent\",\"\",\"125\"", Csv(export), StringComparison.Ordinal);
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = original;
        }
    }
}
