using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Reports;

/// <summary>
/// The rule that decides a benchmark's <c>quality_score</c> and <c>validation_status</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists as a named rule.</b> <c>benchmarks.quality_score</c> and
/// <c>benchmarks.validation_status</c> have been columns since the table was created, and
/// nothing ever wrote anything but <c>0</c> and <c>"pending"</c> into them. The benchmarks
/// page nevertheless charts the average score per category
/// (<c>averageQualityByCategory</c>), so it was drawing a chart of a constant. #90 asks for
/// <c>validate</c> to "enforce the quality score already on the entity" and to "make the
/// scoring rule explicit"; a rule that lives inside one endpoint handler is not explicit,
/// so it lives here, is pure, and is the single thing both <c>validate</c> and the import
/// path call.
/// </para>
/// <para>
/// <b>Why these five components.</b> A benchmark is a claim that some number is normal.
/// What makes that claim trustworthy is: that it measures anything at all
/// (<see cref="ComponentMetrics"/>); that each measurement rests on enough observations to
/// be a mean rather than an anecdote (<see cref="ComponentSampleSize"/>); that it says where
/// in the distribution the number sits rather than only its centre
/// (<see cref="ComponentDistribution"/>); that it says who it is a benchmark FOR
/// (<see cref="ComponentAttribution"/> -- an "industry benchmark" with no industry is not
/// comparable to anything); and that it does not record the same metric in two different
/// units (<see cref="ComponentUnitConsistency"/>), which is the same failure #89 spent its
/// delta rule on, one level up.
/// </para>
/// <para>
/// <b>Why the weights are constants and the response carries them.</b> The client will argue
/// with this rule -- it encodes a judgement, not a fact -- and an argument about a number
/// nobody can see the derivation of is unwinnable. The validate response returns every
/// component with its weight, its raw 0..1 score and the counts behind it, so the total can
/// be recomputed by hand from the payload.
/// </para>
/// </remarks>
public static class BenchmarkQuality
{
    /// <summary>Component name: does it measure anything, and enough things.</summary>
    public const string ComponentMetrics = "metrics";

    /// <summary>Component name: how many of the metrics rest on a reportable sample.</summary>
    public const string ComponentSampleSize = "sample-size";

    /// <summary>Component name: how many of the metrics place themselves in a distribution.</summary>
    public const string ComponentDistribution = "distribution";

    /// <summary>Component name: how much of industry / company size / region is filled in.</summary>
    public const string ComponentAttribution = "attribution";

    /// <summary>Component name: whether any metric name is recorded in two different units.</summary>
    public const string ComponentUnitConsistency = "unit-consistency";

    /// <summary>
    /// The number of distinct metrics at which <see cref="ComponentMetrics"/> is fully
    /// satisfied. Three, because a single number is a reading and a benchmark is a profile;
    /// beyond three the marginal metric says little about trustworthiness.
    /// </summary>
    public const int FullMetricCount = 3;

    /// <summary>
    /// The sample size at or above which a metric counts toward
    /// <see cref="ComponentSampleSize"/>. Thirty is the conventional floor for treating a
    /// sample mean as reportable, and it is also the floor this product already uses for
    /// nothing else -- it is a judgement, stated here so it can be argued with.
    /// </summary>
    /// <remarks>
    /// A metric with <c>SampleSize == null</c> does NOT count. An unstated sample is not a
    /// large one, and scoring it as if it were is how a benchmark built from six responses
    /// ends up labelled <c>verified</c>.
    /// </remarks>
    public const int ReportableSampleSize = 30;

    /// <summary>At or above this score a benchmark is <c>verified</c>.</summary>
    public const double VerifiedThreshold = 70d;

    /// <summary>Below this score a benchmark is <c>failed</c>.</summary>
    public const double FailedThreshold = 40d;

    private const double WeightMetrics = 0.30d;
    private const double WeightSampleSize = 0.25d;
    private const double WeightDistribution = 0.15d;
    private const double WeightAttribution = 0.20d;
    private const double WeightUnitConsistency = 0.10d;

    /// <summary>
    /// Scores <paramref name="metrics"/> and the benchmark's attribution fields, and says
    /// which status that score means.
    /// </summary>
    /// <remarks>
    /// Pure: no database, no clock, no caller identity. The endpoint decides whether to
    /// persist what this returns.
    /// </remarks>
    public static BenchmarkQualityAssessment Assess(
        IReadOnlyList<BenchmarkMetricDto> metrics, string? industry, string? companySize, string? region)
    {
        var metricCount = metrics.Count;

        var withSample = metrics.Count(m => m.SampleSize.HasValue && m.SampleSize.Value >= ReportableSampleSize);
        var withPercentile = metrics.Count(m => m.Percentile.HasValue);

        var attributionPresent = 0;
        if (!string.IsNullOrWhiteSpace(industry)) attributionPresent++;
        if (!string.IsNullOrWhiteSpace(companySize)) attributionPresent++;
        if (!string.IsNullOrWhiteSpace(region)) attributionPresent++;

        // One metric name recorded in two different units. Grouped by name rather than
        // compared pairwise so a name appearing three times with two units is one conflict,
        // not three.
        var conflictingNames = metrics
            .GroupBy(m => m.MetricName, StringComparer.Ordinal)
            .Count(g => g.Select(m => m.Unit).Distinct(StringComparer.Ordinal).Count() > 1);
        var distinctNames = metrics.Select(m => m.MetricName).Distinct(StringComparer.Ordinal).Count();

        var components = new List<BenchmarkQualityComponent>
        {
            Component(ComponentMetrics, WeightMetrics, Math.Min(metricCount, FullMetricCount), FullMetricCount),
            Component(ComponentSampleSize, WeightSampleSize, withSample, metricCount),
            Component(ComponentDistribution, WeightDistribution, withPercentile, metricCount),
            Component(ComponentAttribution, WeightAttribution, attributionPresent, 3),
            Component(ComponentUnitConsistency, WeightUnitConsistency, distinctNames - conflictingNames, distinctNames),
        };

        // A benchmark with no metrics measures nothing. Attribution and unit consistency are
        // both vacuously perfect on an empty metric list, which would carry it to 30 -- above
        // FailedThreshold with nothing behind it -- so the short circuit is not a nicety.
        var score = metricCount == 0 ? 0d : Math.Round(components.Sum(c => c.WeightedScore) * 100d, 1);

        var status = metricCount == 0 || score < FailedThreshold
            ? BenchmarkValidationStatuses.Failed
            : score < VerifiedThreshold
                ? BenchmarkValidationStatuses.NeedsReview
                : BenchmarkValidationStatuses.Verified;

        return new BenchmarkQualityAssessment(score, status, components);
    }

    /// <summary>
    /// One component, scored as <paramref name="satisfied"/> out of <paramref name="total"/>.
    /// </summary>
    /// <remarks>
    /// <c>total == 0</c> scores 1, not 0: every zero-total case here is vacuous truth ("none
    /// of the zero metrics conflict"), and the metric-count short circuit in
    /// <see cref="Assess"/> is what keeps that from being generous. Reporting it as 0 would
    /// instead make an empty benchmark look like it had failed five checks it never took.
    /// </remarks>
    private static BenchmarkQualityComponent Component(string name, double weight, int satisfied, int total)
    {
        var score = total == 0 ? 1d : (double)satisfied / total;
        return new BenchmarkQualityComponent(name, weight, Math.Round(score, 4), Math.Round(score * weight, 6), satisfied, total);
    }
}
