using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// <see cref="ReportComparison"/> — the period-over-period section of a generated report.
///
/// <para><b>Why these are unit tests and why they matter more than most.</b> The document this
/// builds is served to anonymous readers by <c>ReportShareEndpoints</c>, verbatim. A delta is a
/// *relationship* between two waves, so it is the one figure in the document that can leak a
/// withheld reading by arithmetic rather than by printing it. The rule under test is that a
/// delta exists only where the trends matrix gave both ends, and that a withheld wave produces
/// a section that says so rather than a section of zeros.</para>
/// </summary>
public class ReportComparisonTests
{
    private const string Safety = "psychological_safety";
    private const string Workload = "workload";

    private static ClimateTrendsResponse Trends(
        IReadOnlyList<ClimateTrendPoint> points,
        int surveyCount = 2,
        int groupCount = 1,
        IReadOnlyList<string>? dimensions = null)
    {
        var dims = dimensions ?? [Safety, Workload];
        var surveys = Enumerable.Range(0, surveyCount)
            .Select(i => new ClimateTrendSurvey(
                Guid.Parse($"00000000-0000-0000-0000-00000000000{i + 1}"),
                $"Wave {i + 1}",
                "closed",
                new DateTimeOffset(2026, 1 + i, 1, 0, 0, 0, TimeSpan.Zero),
                CompletedCount: 40,
                IsSuppressed: false))
            .ToList();

        var groups = Enumerable.Range(0, groupCount)
            .Select(g => new ClimateTrendGroup($"group-{g}", null, points))
            .ToList();

        return new ClimateTrendsResponse(
            CompanyId: Guid.NewGuid(),
            GroupBy: null,
            Surveys: surveys,
            Dimensions: [.. dims.Select(d => new ClimateTrendDimension(d, surveyCount))],
            Groups: groups,
            SuppressedGroupCount: 0,
            MinimumGroupSize: 5,
            GeneratedAt: DateTimeOffset.UnixEpoch);
    }

    private static ClimateTrendPoint Point(params double?[] scores)
        => new(Guid.NewGuid(), RespondentCount: 40, IsSuppressed: false, Scores: scores);

    private static ClimateTrendPoint SuppressedPoint(int dimensions = 2)
        => new(Guid.NewGuid(), RespondentCount: 0, IsSuppressed: true,
               Scores: [.. Enumerable.Repeat<double?>(null, dimensions)]);

    [Fact]
    public void A_company_with_one_closed_survey_has_nothing_to_compare_and_gets_no_section()
    {
        // Null, not an empty section: "nothing to compare" and "compared and withheld" are
        // different answers and the renderers print them differently.
        var result = ReportComparison.Build(Trends([Point(4.1, 3.2)], surveyCount: 1));

        Assert.Null(result);
    }

    [Fact]
    public void Two_readable_waves_produce_a_delta_per_dimension_in_the_direction_of_travel()
    {
        var result = ReportComparison.Build(Trends([Point(4.0, 3.0), Point(4.5, 2.4)]));

        Assert.NotNull(result);
        Assert.False(result.IsSuppressed);

        var safety = result.Dimensions.Single(d => d.Dimension == Safety);
        Assert.Equal(4.0, safety.EarlierScore);
        Assert.Equal(4.5, safety.LaterScore);
        // Later minus earlier: a rise is positive. The other order would print every
        // improvement as a loss, which no assertion on magnitude alone would catch.
        Assert.Equal(0.5, safety.Delta!.Value, precision: 6);

        var workload = result.Dimensions.Single(d => d.Dimension == Workload);
        Assert.Equal(-0.6, workload.Delta!.Value, precision: 6);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void A_withheld_wave_at_either_end_withholds_the_whole_comparison(bool earlier, bool later)
    {
        var points = new List<ClimateTrendPoint>
        {
            earlier ? SuppressedPoint() : Point(4.0, 3.0),
            later ? SuppressedPoint() : Point(4.5, 2.4),
        };

        var result = ReportComparison.Build(Trends(points));

        Assert.NotNull(result);
        Assert.True(result.IsSuppressed);

        // Empty, not a list of nulls. A row per dimension would publish the instrument's shape
        // for a wave whose readings are withheld, and a reader could count the dimensions a
        // small group was asked about.
        Assert.Empty(result.Dimensions);

        // The surveys are still named -- that a wave happened is not the withheld fact.
        Assert.NotEqual(Guid.Empty, result.EarlierSurveyId);
        Assert.NotEqual(Guid.Empty, result.LaterSurveyId);
    }

    [Fact]
    public void A_dimension_missing_from_one_wave_yields_no_delta_and_does_not_withhold_the_rest()
    {
        // Null on one side is "not asked", "no scale question" or "withheld" -- the matrix
        // deliberately conflates them, and so must this. What it must NOT do is treat the
        // absent side as zero and report a full-scale movement.
        var result = ReportComparison.Build(Trends([Point(4.0, null), Point(4.5, 2.4)]));

        Assert.NotNull(result);
        Assert.False(result.IsSuppressed);

        var workload = result.Dimensions.Single(d => d.Dimension == Workload);
        Assert.Null(workload.EarlierScore);
        Assert.Equal(2.4, workload.LaterScore);
        Assert.Null(workload.Delta);

        // The readable dimension is unaffected: one absent cell does not withhold the row.
        Assert.Equal(0.5, result.Dimensions.Single(d => d.Dimension == Safety).Delta!.Value, precision: 6);
    }

    [Fact]
    public void A_grouped_matrix_is_refused_rather_than_publishing_its_first_group_as_the_company()
    {
        // The generator passes groupBy: null. If that ever changed, the first department's
        // series would otherwise be published on an anonymous link labelled as the company's.
        var result = ReportComparison.Build(
            Trends([Point(4.0, 3.0), Point(4.5, 2.4)], groupCount: 2));

        Assert.Null(result);
    }

    [Fact]
    public void The_pair_compared_is_the_two_most_recent_waves_not_the_two_oldest()
    {
        var trends = Trends([Point(1.0, 1.0), Point(2.0, 2.0), Point(3.0, 3.0)], surveyCount: 3);

        var result = ReportComparison.Build(trends);

        Assert.NotNull(result);
        Assert.Equal(trends.Surveys[1].SurveyId, result.EarlierSurveyId);
        Assert.Equal(trends.Surveys[2].SurveyId, result.LaterSurveyId);
        Assert.Equal(1.0, result.Dimensions.Single(d => d.Dimension == Safety).Delta!.Value, precision: 6);
    }
}
