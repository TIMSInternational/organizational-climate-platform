using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// The quality rule, exercised directly.
///
/// <para>
/// <see cref="BenchmarkQuality"/> is pure by design -- no database, no clock, no caller -- and
/// it decides a badge a client argues about. The integration suite asserts it through
/// <c>validate</c> and <c>import</c>, which is the right place to assert that the rule is
/// wired to the routes; this is the place to assert the rule itself, one component at a time,
/// without a Postgres container between the input and the answer.
/// </para>
/// <para>
/// Every expected score below is written as the sum of its weighted components in the comment
/// beside it, because a magic number here is exactly what #90 asked this rule to stop being.
/// </para>
/// </summary>
public class BenchmarkQualityTests
{
    private static BenchmarkMetricDto Metric(string name, double value, string unit, double? percentile = null, int? sampleSize = null)
        => new(Guid.NewGuid(), name, value, unit, percentile, sampleSize);

    /// <summary>
    /// The headline rule, and the one the code and its own documentation disagreed about: the
    /// <c>metrics</c> component counts DISTINCT metric names, not stored readings.
    ///
    /// <para>
    /// One measure reported at p25, p50 and p75 is the ordinary shape of a real benchmark. It
    /// is one metric. Counting it as three fills a component worth 30% of the score off a
    /// single measurement, which is the opposite of what the component is for -- "a benchmark
    /// is a profile, not a reading".
    /// </para>
    /// </summary>
    [Fact]
    public void One_metric_at_three_percentiles_counts_once_toward_the_metrics_component()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 61, "percent", percentile: 25, sampleSize: 500),
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 500),
                Metric("engagement_score", 79, "percent", percentile: 75, sampleSize: 500),
            ],
            industry: "manufacturing", companySize: null, region: null);

        var metrics = assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentMetrics);
        Assert.Equal(1, metrics.Satisfied);
        Assert.Equal(BenchmarkQuality.FullMetricCount, metrics.Total);

        // 0.10 metrics + 0.25 sample + 0.15 distribution + 0.066667 attribution + 0.10 unit.
        Assert.Equal(66.7d, assessment.Score, 10);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, assessment.Status);
    }

    /// <summary>
    /// Three DIFFERENT metrics do fill the component -- so the rule above is a rule about
    /// distinctness and not a rule that caps everything at one.
    /// </summary>
    [Fact]
    public void Three_distinct_metrics_fill_the_metrics_component()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 900),
                Metric("absence_rate", 3.4, "percent", percentile: 50, sampleSize: 900),
                Metric("turnover_rate", 11.2, "percent", percentile: 50, sampleSize: 900),
            ],
            industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        Assert.Equal(3, assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentMetrics).Satisfied);
        Assert.Equal(100d, assessment.Score, 10);
        Assert.Equal(BenchmarkValidationStatuses.Verified, assessment.Status);
    }

    /// <summary>
    /// <c>sample-size</c> and <c>distribution</c> are scored per READING, deliberately.
    ///
    /// <para>
    /// Two readings of one metric, one of which states a sample and a percentile and one of
    /// which does not. Per distinct name the answered reading would cover for the unanswered
    /// one and both components would read 1/1; per reading they read 1/2, which is the truth
    /// about what the benchmark states.
    /// </para>
    /// </summary>
    [Fact]
    public void Sample_size_and_distribution_are_scored_per_reading_not_per_distinct_metric()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 900),
                Metric("engagement_score", 79, "percent"),
            ],
            industry: "manufacturing", companySize: null, region: null);

        var sample = assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize);
        Assert.Equal(1, sample.Satisfied);
        Assert.Equal(2, sample.Total);

        var distribution = assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentDistribution);
        Assert.Equal(1, distribution.Satisfied);
        Assert.Equal(2, distribution.Total);
    }

    /// <summary>
    /// The reportable floor is thirty. Twenty-nine is not a large sample and one is not either.
    /// </summary>
    [Theory]
    [InlineData(null, 0)]
    [InlineData(1, 0)]
    [InlineData(29, 0)]
    [InlineData(30, 1)]
    [InlineData(900, 1)]
    public void A_sample_counts_only_at_or_above_the_reportable_floor(int? sampleSize, int expected)
    {
        var assessment = BenchmarkQuality.Assess(
            [Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: sampleSize)],
            industry: "manufacturing", companySize: null, region: null);

        Assert.Equal(expected, assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentSampleSize).Satisfied);
    }

    /// <summary>
    /// A fully described benchmark that states neither samples nor percentiles scores 60 --
    /// the descriptive components in full, the evidential ones at nothing.
    ///
    /// <para>
    /// Pinned because it is the second half of the fixture
    /// <c>Categories_reports_the_active_count_and_the_average_quality_score</c> is built from:
    /// 100 and 60 average to exactly 80, and an average that has to be exact cannot rest on a
    /// score nobody wrote down.
    /// </para>
    /// </summary>
    [Fact]
    public void Three_described_metrics_with_no_evidence_score_sixty()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent"),
                Metric("absence_rate", 3.4, "percent"),
                Metric("turnover_rate", 11.2, "percent"),
            ],
            industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        // 0.30 metrics + 0 sample + 0 distribution + 0.20 attribution + 0.10 unit.
        Assert.Equal(60d, assessment.Score, 10);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, assessment.Status);
    }

    /// <summary>
    /// One metric name in two units is one conflict, and it costs the unit-consistency
    /// component outright.
    /// </summary>
    [Fact]
    public void One_metric_recorded_in_two_units_is_one_conflict()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 900),
                Metric("engagement_score", 0.68, "fraction", percentile: 50, sampleSize: 900),
                Metric("engagement_score", 0.7, "fraction", percentile: 50, sampleSize: 900),
            ],
            industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        var unit = assessment.Components.Single(c => c.Name == BenchmarkQuality.ComponentUnitConsistency);
        Assert.Equal(0, unit.Satisfied);
        Assert.Equal(1, unit.Total);
    }

    /// <summary>
    /// A benchmark that measures nothing scores zero and fails, however well it describes
    /// itself. Attribution and unit consistency are both vacuously perfect on an empty list.
    /// </summary>
    [Fact]
    public void A_benchmark_with_no_metrics_fails_outright()
    {
        var assessment = BenchmarkQuality.Assess(
            [], industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        Assert.Equal(0d, assessment.Score);
        Assert.Equal(BenchmarkValidationStatuses.Failed, assessment.Status);
    }

    /// <summary>
    /// The weights sum to one and the components sum to the score, so the number can be
    /// recomputed by hand from the payload -- the property that makes this rule arguable with
    /// a client rather than a magic number.
    /// </summary>
    [Fact]
    public void The_components_sum_to_the_score()
    {
        var assessment = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 900),
                Metric("absence_rate", 3.4, "percent", sampleSize: 12),
            ],
            industry: "manufacturing", companySize: null, region: "Costa Rica");

        Assert.Equal(1d, assessment.Components.Sum(c => c.Weight), 6);
        Assert.Equal(assessment.Score, Math.Round(assessment.Components.Sum(c => c.WeightedScore) * 100d, 1), 10);
    }

    /// <summary>
    /// Each of the three statuses the rule can reach, and each is one
    /// <see cref="BenchmarkValidationStatuses.IsKnown"/> recognises.
    ///
    /// <para>
    /// The rule never returns <c>pending</c>: that status means "nobody has assessed this",
    /// which cannot be the outcome of an assessment. It is the column's default and the only
    /// value assessing a benchmark can move it away from.
    /// </para>
    /// </summary>
    [Fact]
    public void Every_status_the_rule_returns_is_a_known_one()
    {
        // Nothing measured.
        var failed = BenchmarkQuality.Assess([], "manufacturing", "201-500", "Costa Rica");

        // One metric, sampled, no percentile, one attribution field of three:
        // 0.10 + 0.25 + 0 + 0.066667 + 0.10.
        var needsReview = BenchmarkQuality.Assess(
            [Metric("engagement_score", 70, "percent", sampleSize: 900)],
            industry: "manufacturing", companySize: null, region: null);

        // Three distinct metrics, all sampled, all placed, fully attributed.
        var verified = BenchmarkQuality.Assess(
            [
                Metric("engagement_score", 70, "percent", percentile: 50, sampleSize: 900),
                Metric("absence_rate", 3.4, "percent", percentile: 50, sampleSize: 900),
                Metric("turnover_rate", 11.2, "percent", percentile: 50, sampleSize: 900),
            ],
            industry: "manufacturing", companySize: "201-500", region: "Costa Rica");

        Assert.Equal(BenchmarkValidationStatuses.Failed, failed.Status);
        Assert.Equal(51.7d, needsReview.Score, 10);
        Assert.Equal(BenchmarkValidationStatuses.NeedsReview, needsReview.Status);
        Assert.Equal(BenchmarkValidationStatuses.Verified, verified.Status);

        foreach (var assessment in new[] { failed, needsReview, verified })
        {
            Assert.True(BenchmarkValidationStatuses.IsKnown(assessment.Status));
            Assert.Contains(assessment.Status, BenchmarkValidationStatuses.All);
        }
    }
}
