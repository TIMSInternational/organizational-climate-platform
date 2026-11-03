using ClimateProject.Application.Benchmarks;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Benchmarks;

/// <summary>
/// The arithmetic behind a computed reference group, proved without Postgres. The properties
/// that matter are the ones a screen cannot check: each question read on its own scale, no
/// median under three companies (for the group or for one dimension), the subject never in
/// its own group, and a suppressed survey never an input.
/// </summary>
public class BenchmarkGroupReadingTests
{
    private static SurveyQuestionResult Question(string? category, double? average, int answered = 10, int? min = 1, int? max = 5, string type = "likert")
        => new(Guid.NewGuid(), 0, type, "q", category, answered, [], average, null, min, max, null, null, [], 0);

    private static SurveyAggregate Aggregate(params SurveyQuestionResult[] questions)
        => new(new SurveyResultsSummary(null, 10, 10, 0, null, 1, null, null, null, []), questions, [], [], false, null, 3);

    private static BenchmarkGroupReading.CompanyIndices Company(double overall, params (string Key, double Index)[] dimensions)
        => new(overall, [.. dimensions.Select(d => new BenchmarkGroupReading.DimensionIndex(d.Key, d.Index))]);

    [Fact]
    public void A_mean_reads_on_its_own_questions_range_not_an_assumed_one_to_five()
    {
        Assert.Equal(75, BenchmarkGroupReading.ToIndex(4, 1, 5));
        // 3 on 1–4 is two thirds of the way; read as 1–5 it would be 50.
        Assert.Equal(200.0 / 3, BenchmarkGroupReading.ToIndex(3, 1, 4)!.Value, 6);
        // EAGLE's 20–100 answers, had they been imported as such.
        Assert.Equal(75, BenchmarkGroupReading.ToIndex(80, 20, 100));
        Assert.Equal(100, BenchmarkGroupReading.ToIndex(7, 1, 5));
        Assert.Null(BenchmarkGroupReading.ToIndex(3, null, 5));
        Assert.Null(BenchmarkGroupReading.ToIndex(3, 5, 1));
        Assert.Null(BenchmarkGroupReading.ToIndex(null, 1, 5));
    }

    [Fact]
    public void A_dimension_pools_its_questions_by_how_many_answered_each_in_the_order_first_asked()
    {
        var indices = BenchmarkGroupReading.Indices(Aggregate(
            Question("trust", 5, answered: 30),
            Question("pay", 3, answered: 10),
            Question("trust", 1, answered: 10),
            Question(null, 5),
            Question("open", null, min: null, max: null, type: "open_text")));

        Assert.NotNull(indices);
        Assert.Equal(["trust", "pay"], indices.Dimensions.Select(d => d.Key));
        // (100·30 + 0·10) / 40
        Assert.Equal(75, indices.Dimensions[0].Index, 6);
        Assert.Equal(50, indices.Dimensions[1].Index, 6);
        Assert.Equal(62.5, indices.Overall, 6);
    }

    [Fact]
    public void A_suppressed_survey_or_one_with_no_scored_dimension_is_no_input()
    {
        var suppressed = Aggregate(Question("trust", 4)) with { IsSuppressed = true };
        Assert.Null(BenchmarkGroupReading.Indices(suppressed));
        Assert.Null(BenchmarkGroupReading.Indices(Aggregate(Question(null, 4), Question("trust", 4, answered: 0))));
    }

    [Fact]
    public void Under_three_companies_the_group_publishes_nothing_not_even_the_subjects_own_index()
    {
        var subject = Company(70, ("trust", 70));
        var reading = BenchmarkGroupReading.Read(subject, [Company(60, ("trust", 60)), Company(80, ("trust", 80))]);
        Assert.False(reading.Sufficient);
        Assert.Equal(2, reading.CompanyCount);
        Assert.Null(reading.CompanyIndex);
        Assert.Null(reading.GroupMedian);
        Assert.Empty(reading.Dimensions);
    }

    [Fact]
    public void A_dimension_scored_by_fewer_than_three_companies_has_no_median_while_the_others_do()
    {
        var subject = Company(70, ("trust", 72), ("pay", 55));
        var reading = BenchmarkGroupReading.Read(subject,
        [
            Company(60, ("trust", 60), ("pay", 50)),
            Company(66, ("trust", 66)),
            Company(90, ("trust", 90), ("pay", 70)),
            Company(64, ("trust", 64)),
        ]);

        Assert.True(reading.Sufficient);
        Assert.Equal(4, reading.CompanyCount);
        Assert.Equal(70, reading.CompanyIndex);
        // Median of 60, 64, 66, 90.
        Assert.Equal(65, reading.GroupMedian);
        var trust = Assert.Single(reading.Dimensions, d => d.Key == "trust");
        Assert.Equal(65, trust.Median);
        Assert.Equal(4, trust.Companies);
        var pay = Assert.Single(reading.Dimensions, d => d.Key == "pay");
        Assert.Null(pay.Median);
        Assert.Equal(2, pay.Companies);
        Assert.Equal(55, pay.Score);
    }

    [Fact]
    public void Dimensions_match_by_exact_key_so_two_instruments_words_never_pool()
    {
        var subject = Company(70, ("Liderazgo", 70));
        var reading = BenchmarkGroupReading.Read(subject,
            [Company(60, ("liderazgo", 60)), Company(61, ("LIDERAZGO", 61)), Company(62, ("Leadership", 62))]);
        var dimension = Assert.Single(reading.Dimensions);
        Assert.Equal(0, dimension.Companies);
        Assert.Null(dimension.Median);
    }

    [Fact]
    public void The_median_is_the_middle_value_or_the_mean_of_the_two_middle_values()
    {
        Assert.Equal(5, BenchmarkGroupReading.Median([9, 1, 5]));
        Assert.Equal(4, BenchmarkGroupReading.Median([1, 9, 3, 5]));
        Assert.Throws<ArgumentException>(() => BenchmarkGroupReading.Median([]));
    }

    [Theory]
    [InlineData(null, "Energía", true)]
    [InlineData("  ", null, true)]
    [InlineData("energía", " Energía ", true)]
    [InlineData("Energía", null, false)]
    [InlineData("Energía", "Agua", false)]
    public void A_criterion_matches_trimmed_and_case_insensitively_and_never_an_unclassified_company(
        string? criterion, string? value, bool matches)
        => Assert.Equal(matches, BenchmarkGroupReading.Matches(criterion, value));
}
