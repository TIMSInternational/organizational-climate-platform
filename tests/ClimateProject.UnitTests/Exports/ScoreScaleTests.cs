using System.Text;
using System.Text.Json;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Dashboard.Rendering;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// A company on 0–100 downloads files on 0–100 (mean × 20); a company on the mean downloads
/// exactly the file it always did. Counts, rates and percentages never convert.
/// </summary>
public class ScoreScaleTests
{
    private static readonly Guid SurveyId = Guid.Parse("5c0e5c0e-0000-0000-0000-000000000001");
    private static readonly Guid QuestionId = Guid.Parse("5c0e5c0e-0000-0000-0000-0000000000a1");
    private static readonly DateTimeOffset GeneratedAt = new(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);

    // ------------------------------------------------------------------
    // The formatting rule
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(4.07, "81.4")]
    [InlineData(4.1, "82")]
    [InlineData(4.0, "80")]
    [InlineData(3.8, "76")]
    [InlineData(4.3, "86")]
    [InlineData(1.0, "20")]
    [InlineData(5.0, "100")]
    [InlineData(4.17, "83.4")]
    [InlineData(-0.35, "-7")]
    public void On_percent_a_score_prints_one_decimal_fewer_than_the_mean_would(double mean, string expected)
        => Assert.Equal(expected, ScoreScale.Percent.Display(mean));

    [Theory]
    [InlineData(4.07, "4.07")]
    [InlineData(4.1, "4.1")]
    [InlineData(4.0, "4")]
    [InlineData(4.166666, "4.17")]
    public void On_the_mean_a_score_prints_as_it_always_has(double mean, string expected)
        => Assert.Equal(expected, ScoreScale.Mean.Display(mean));

    [Fact]
    public void A_csv_score_is_the_mean_times_twenty_without_float_noise()
    {
        Assert.Equal("81.4", ScoreScale.Percent.CsvNumber(4.07));
        Assert.Equal("4.07", ScoreScale.Mean.CsvNumber(4.07));
        Assert.Null(ScoreScale.Percent.CsvNumber((double?)null));
    }

    [Fact]
    public void Only_mean_and_percent_are_settings_and_anything_else_reads_as_the_mean()
    {
        Assert.True(ScoreScales.IsKnown("mean"));
        Assert.True(ScoreScales.IsKnown("percent"));
        Assert.False(ScoreScales.IsKnown("Percent"));
        Assert.False(ScoreScales.IsKnown("0-100"));
        Assert.Equal(ScoreScale.Percent, ScoreScales.Parse("percent"));
        Assert.Equal(ScoreScale.Mean, ScoreScales.Parse(null));
        Assert.Equal(ScoreScale.Mean, ScoreScales.Parse("junk"));
    }

    // ------------------------------------------------------------------
    // Survey export
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_survey_csv_on_percent_writes_every_score_times_twenty_and_says_so()
    {
        var rows = await SurveyCsvAsync(ScoreScale.Percent);

        Assert.Equal("0-100", SurveyCell(rows, SurveyExport.SummarySection, "score_scale", "value"));
        Assert.Equal("83.4", SurveyCell(rows, SurveyExport.QuestionSection, QuestionId.ToString(), "average"));
        Assert.Equal("80", SurveyCell(rows, SurveyExport.QuestionSection, QuestionId.ToString(), "median"));
        Assert.Equal("83.4", SurveyCell(rows, SurveyExport.DimensionSection, "liderazgo", "average_score"));

        // Counts are not scores.
        Assert.Equal("6", SurveyCell(rows, SurveyExport.QuestionSection, QuestionId.ToString(), "answered_count"));
        Assert.Equal("6", SurveyCell(rows, SurveyExport.SummarySection, "completed_count", "value"));
    }

    [Fact]
    public async Task A_survey_csv_on_the_mean_is_the_file_it_always_was_plus_its_scale()
    {
        var rows = await SurveyCsvAsync(ScoreScale.Mean);

        Assert.Equal("1-5", SurveyCell(rows, SurveyExport.SummarySection, "score_scale", "value"));
        Assert.Equal("4.17", SurveyCell(rows, SurveyExport.QuestionSection, QuestionId.ToString(), "average"));
        Assert.Equal("4", SurveyCell(rows, SurveyExport.QuestionSection, QuestionId.ToString(), "median"));
        Assert.Equal("4.17", SurveyCell(rows, SurveyExport.DimensionSection, "liderazgo", "average_score"));
    }

    [Fact]
    public void A_survey_pdf_on_percent_prints_the_0_to_100_reading()
    {
        var percent = PdfText.Prose(SurveyExport.BuildPdf(SurveyContext(ScoreScale.Percent)));
        var mean = PdfText.Prose(SurveyExport.BuildPdf(SurveyContext(ScoreScale.Mean)));

        Assert.Contains("83,4", percent, StringComparison.Ordinal);
        Assert.DoesNotContain("4,17", percent, StringComparison.Ordinal);

        Assert.Contains("4,17", mean, StringComparison.Ordinal);
        Assert.DoesNotContain("83,4", mean, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Report export
    // ------------------------------------------------------------------

    [Fact]
    public void A_report_csv_on_percent_converts_scores_and_the_comparison_and_says_so()
    {
        var rows = ReportCsv(ScoreScale.Percent);

        Assert.Contains(rows, r => r.Group == "score_scale" && r.Value == "0-100");
        Assert.Equal("83.4", ReportCell(rows, QuestionId.ToString(), "average"));
        Assert.Equal("80", ReportCell(rows, QuestionId.ToString(), "median"));
        Assert.Equal("83.4", ReportCell(rows, "liderazgo", "average_score"));
        Assert.Equal("76", ReportCell(rows, "liderazgo", "earlier_score"));
        Assert.Equal("86", ReportCell(rows, "liderazgo", "later_score"));
        Assert.Equal("10", ReportCell(rows, "liderazgo", "delta"));
    }

    [Fact]
    public void A_report_csv_on_the_mean_keeps_the_mean()
    {
        var rows = ReportCsv(ScoreScale.Mean);

        Assert.Contains(rows, r => r.Group == "score_scale" && r.Value == "1-5");
        Assert.Equal("4.17", ReportCell(rows, QuestionId.ToString(), "average"));
        Assert.Equal("4.17", ReportCell(rows, "liderazgo", "average_score"));
        Assert.Equal("3.8", ReportCell(rows, "liderazgo", "earlier_score"));
        Assert.Equal("0.5", ReportCell(rows, "liderazgo", "delta"));
    }

    [Fact]
    public void A_report_pdf_on_percent_prints_scores_and_the_comparison_on_0_to_100()
    {
        var percent = PdfText.DrawnStrings(ReportRenderer.BuildPdf(ReportContext(ScoreScale.Percent)));
        var mean = PdfText.DrawnStrings(ReportRenderer.BuildPdf(ReportContext(ScoreScale.Mean)));

        Assert.Contains("83,4", percent);
        Assert.Contains("76", percent);
        Assert.Contains("86", percent);
        Assert.DoesNotContain("4,17", percent);
        Assert.DoesNotContain("3,8", percent);

        Assert.Contains("4,17", mean);
        Assert.Contains("3,8", mean);
        Assert.DoesNotContain("83,4", mean);
    }

    // ------------------------------------------------------------------
    // Dashboard export
    // ------------------------------------------------------------------

    [Fact]
    public void A_team_dashboard_on_percent_prints_its_dimensions_on_0_to_100_in_both_formats()
    {
        var document = DashboardExport.ForDepartmentAdmin(Dashboard(), ContentLanguages.Spanish, GeneratedAt, ScoreScale.Percent);

        var csv = Encoding.UTF8.GetString(DashboardExport.BuildCsv(document).ToBytes());
        var pdf = PdfText.DrawnStrings(DashboardExport.BuildPdf(document));

        Assert.Contains("\"81,4\"", csv, StringComparison.Ordinal);
        Assert.Contains("\"0-100\"", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("4,07", csv, StringComparison.Ordinal);
        Assert.Contains("81,4", pdf);
        // Counts are not scores.
        Assert.Contains("\"9\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public void A_team_dashboard_on_the_mean_is_the_file_it_always_was()
    {
        var onMean = DashboardExport.ForDepartmentAdmin(Dashboard(), ContentLanguages.Spanish, GeneratedAt, ScoreScale.Mean);
        var defaulted = DashboardExport.ForDepartmentAdmin(Dashboard(), ContentLanguages.Spanish, GeneratedAt);

        var csv = Encoding.UTF8.GetString(DashboardExport.BuildCsv(onMean).ToBytes());

        Assert.Contains("\"4,07\"", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("0-100", csv, StringComparison.Ordinal);
        Assert.Equal(csv, Encoding.UTF8.GetString(DashboardExport.BuildCsv(defaulted).ToBytes()));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /// <summary>Six complete responses to one 1–5 likert: 5,4,4,4,4,4 → mean 4,17, median 4.</summary>
    private static SurveyAggregate Aggregate()
    {
        var responses = Enumerable.Range(0, 6)
            .Select(i => new AggregationResponse(
                Guid.Parse($"5c0e5c0e-0000-0000-0001-{i:D12}"),
                ContentLanguages.Spanish,
                null,
                IsComplete: true,
                new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero),
                new DateTimeOffset(2026, 10, 1, 9, 5, 0, TimeSpan.Zero),
                300,
                new Dictionary<string, string>(StringComparer.Ordinal)))
            .ToList();

        var answers = responses
            .Select((r, i) => new AggregationAnswer(r.ResponseId, QuestionId, JsonSerializer.Serialize(i == 0 ? "5" : "4"), null))
            .ToList();

        return SurveyAggregation.Compute(
            [new AggregationQuestion(QuestionId, 0, QuestionTypes.Likert, "Mi líder me apoya", "liderazgo", 1, 5, null, null, [])],
            responses,
            answers,
            [],
            targetAudienceCount: 10);
    }

    private static SurveyExportContext SurveyContext(ScoreScale scale)
        => new(
            SurveyId,
            "Clima 2026",
            SurveyStatuses.Closed,
            ContentLanguages.Spanish,
            ContentLanguages.Spanish,
            [],
            Aggregate(),
            GeneratedAt,
            Scale: scale);

    private sealed record Row(string Section, string Question, string Group, string Metric, string Value);

    private static async Task<IReadOnlyList<Row>> SurveyCsvAsync(ScoreScale scale)
    {
        using var stream = new MemoryStream();
        await using (var csv = new CsvStreamWriter(stream, SurveyExport.Columns))
        {
            await SurveyExport.WriteCsvAsync(csv, SurveyContext(scale));
        }

        // Columns: section, question, group, language, metric, value.
        return [.. Fields(Encoding.UTF8.GetString(stream.ToArray().AsSpan(3)))
            .Select(f => new Row(f[0], f[1], f[2], f[4], f[5]))];
    }

    private static string SurveyCell(IReadOnlyList<Row> rows, string section, string group, string metric)
        => rows.Single(r => r.Section == section && r.Group == group && r.Metric == metric).Value;

    private static ReportRenderContext ReportContext(ScoreScale scale)
        => new(
            Guid.Parse("5c0e5c0e-0000-0000-0000-0000000000e1"),
            "Informe",
            null,
            "summary",
            GeneratedAt,
            new ReportOutputDocument(
                "note",
                [ReportSurveySections.ToSection(SurveyId, "Clima 2026", SurveyStatuses.Closed, ContentLanguages.Spanish, Aggregate())],
                [],
                [],
                new ReportComparisonSection(
                    Guid.Parse("5c0e5c0e-0000-0000-0000-0000000000e2"),
                    "Clima 2025",
                    new DateTimeOffset(2025, 10, 1, 0, 0, 0, TimeSpan.Zero),
                    SurveyId,
                    "Clima 2026",
                    new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero),
                    IsSuppressed: false,
                    [new ReportDimensionMovement("liderazgo", 3.8, 4.3, 0.5)])),
            scale);

    private static IReadOnlyList<Row> ReportCsv(ScoreScale scale)
        // Columns: section, survey, question, group, language, metric, value.
        => [.. Fields(Encoding.UTF8.GetString(ReportRenderer.BuildCsv(ReportContext(scale)).ToBytes().AsSpan(3)))
            .Select(f => new Row(f[0], f[2], f[3], f[5], f[6]))];

    private static string ReportCell(IReadOnlyList<Row> rows, string groupOrQuestion, string metric)
        => rows.Single(r => (r.Group == groupOrQuestion || r.Question == groupOrQuestion) && r.Metric == metric).Value;

    private static DepartmentAdminDashboard Dashboard()
        => new(
            Guid.Parse("5c0e5c0e-0000-0000-0000-0000000000d1"),
            "Operaciones",
            Guid.Parse("5c0e5c0e-0000-0000-0000-0000000000c1"),
            MemberCount: 12,
            ActiveMemberCount: 12,
            ActiveSurveyCount: 0,
            CompletedResponseCount: 9,
            OpenActionPlanCount: 0,
            OverdueActionPlanCount: 0,
            ActiveSurveys: [],
            Climate: new DashboardTeamClimate(
                SurveyId,
                "Clima 2026",
                new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero),
                RespondentCount: 9,
                IsSuppressed: false,
                MinimumGroupSize: 5,
                [new DashboardDimensionScore("liderazgo", 4.07)]));

    /// <summary>Every field is quoted unconditionally and these fixtures embed no quotes.</summary>
    private static IEnumerable<string[]> Fields(string text)
        => text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
            .Skip(1)
            .Select(line => line[1..^1].Split("\",\"", StringSplitOptions.None));
}
