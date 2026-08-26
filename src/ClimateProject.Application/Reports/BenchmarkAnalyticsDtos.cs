namespace ClimateProject.Application.Reports;

// ---------------------------------------------------------------------------------------
// #90 -- the analytical half of the benchmark surface: compare, trends, industry,
// categories, import and validate. BenchmarkDtos.cs stores benchmarks; this file reads them
// against each other. Split rather than appended so that #89 and #90, which land in the same
// merge, do not both rewrite the tail of one file.
// ---------------------------------------------------------------------------------------

/// <summary>One component of the quality rule -- see <see cref="BenchmarkQuality"/>.</summary>
/// <param name="Weight">This component's share of the total. The five weights sum to 1.</param>
/// <param name="Score">0..1, <paramref name="Satisfied"/> over <paramref name="Total"/>.</param>
/// <param name="WeightedScore"><paramref name="Score"/> times <paramref name="Weight"/>; the five sum to the total before it is scaled to 100.</param>
/// <param name="Satisfied">How many of <paramref name="Total"/> the benchmark met. Reported so the score can be recomputed by hand from the payload.</param>
public sealed record BenchmarkQualityComponent(
    string Name, double Weight, double Score, double WeightedScore, int Satisfied, int Total);

/// <summary>What the quality rule made of a benchmark, before anything is written.</summary>
public sealed record BenchmarkQualityAssessment(
    double Score, string Status, IReadOnlyList<BenchmarkQualityComponent> Components);

/// <summary>The result of running the quality rule and storing what it said.</summary>
/// <remarks>
/// Carries the previous score and status as well as the new ones, because validating is a
/// state change: a caller that only sees the new value cannot tell a re-run that confirmed
/// the score from one that moved it.
/// </remarks>
public sealed record BenchmarkValidationResult(
    Guid BenchmarkId,
    string Status,
    double QualityScore,
    string PreviousStatus,
    double PreviousQualityScore,
    IReadOnlyList<BenchmarkQualityComponent> Components);

/// <summary>A benchmark as it appears on one side of a comparison.</summary>
public sealed record BenchmarkComparisonMember(
    Guid Id, string Name, string Category, string Type, Guid? CompanyId,
    string? Industry, string? CompanySize, string? Region);

/// <summary>
/// One metric of one benchmark read against the same metric of the comparison's baseline.
/// </summary>
/// <remarks>
/// Field-for-field the shape of <see cref="BenchmarkMetricChangeDto"/>, and deliberately NOT
/// that type. The arithmetic is the same subtraction and comes from the same function
/// (<c>BenchmarkPriorPeriod.BuildChanges</c>, so there is exactly one implementation of it and
/// one place the no-delta-across-units rule lives), but "prior" is a claim about time, and a
/// comparison between two benchmarks is not one. A payload that called the other side
/// <c>priorValue</c> would invite a reader to present a cross-sector difference as a
/// year-over-year change.
/// </remarks>
/// <param name="Delta">
/// <c>Value - BaselineValue</c>, or null when either side lacks the metric OR the two sides
/// record it in different units -- #89's rule, applied here through #89's code.
/// </param>
public sealed record BenchmarkMetricComparisonDto(
    string MetricName,
    double? Value,
    string? Unit,
    double? BaselineValue,
    string? BaselineUnit,
    double? Delta,
    double? ChangeRatio);

/// <summary>One non-baseline benchmark, differenced against the baseline.</summary>
public sealed record BenchmarkComparisonEntry(
    BenchmarkComparisonMember Benchmark, IReadOnlyList<BenchmarkMetricComparisonDto> Metrics);

/// <summary>The whole comparison: one baseline, and every other requested benchmark against it.</summary>
public sealed record BenchmarkComparisonResult(
    BenchmarkComparisonMember Baseline,
    IReadOnlyList<BenchmarkMetricDto> BaselineMetrics,
    IReadOnlyList<BenchmarkComparisonEntry> Comparisons);

/// <summary>One period of a trend.</summary>
public sealed record BenchmarkTrendPeriod(
    Guid Id, string Name, DateTimeOffset CreatedAt, string PriorPeriodStatus);

/// <summary>
/// One metric's reading in one period of a trend.
/// </summary>
/// <param name="Value">Null in a period that did not record this metric.</param>
/// <param name="Delta">
/// The change from the PRECEDING period -- null in the oldest period, null when either side
/// is missing, and null across a change of unit.
/// </param>
public sealed record BenchmarkTrendPoint(
    Guid BenchmarkId, double? Value, string? Unit, double? Delta, double? ChangeRatio);

/// <summary>
/// One metric across every period of a trend. <c>Points</c> is parallel to
/// <see cref="BenchmarkTrendResult.Periods"/> and always the same length, so a chart can index
/// the two together without matching on id.
/// </summary>
public sealed record BenchmarkTrendSeries(string MetricName, IReadOnlyList<BenchmarkTrendPoint> Points);

/// <summary>
/// A benchmark and every period behind it, walked server-side through
/// <c>prior_period_benchmark_id</c>.
/// </summary>
/// <remarks>
/// The chain endpoint #89 recorded as not existing. Until it did, the browser assembled the
/// chain itself one GET at a time (<c>followPriorPeriodChain</c>) and differenced it itself
/// (<c>benchmarkAnalysis.buildTrend</c>) -- which is why the unit rule had to be written, and
/// asserted, twice.
/// </remarks>
/// <param name="Periods">Oldest first, so a chart plots them left to right without reversing.</param>
/// <param name="StopReason">
/// Why the walk ended where it did -- one of <see cref="BenchmarkTrendStopReasons"/>. Without
/// it a two-period trend cannot be told apart from a ten-period one whose third hop this
/// caller may not read, and the second is a very different thing to put on a page.
/// </param>
public sealed record BenchmarkTrendResult(
    Guid BenchmarkId,
    string BenchmarkName,
    IReadOnlyList<BenchmarkTrendPeriod> Periods,
    IReadOnlyList<BenchmarkTrendSeries> Series,
    string StopReason);

/// <summary>Why a trend walk stopped. See <see cref="BenchmarkTrendResult.StopReason"/>.</summary>
public static class BenchmarkTrendStopReasons
{
    /// <summary>The oldest period declares that it has no prior period. The chain is complete.</summary>
    public const string None = "none";

    /// <summary>The oldest period has not been linked to anything yet. The chain may be incomplete.</summary>
    public const string Unlinked = "unlinked";

    /// <summary>
    /// The oldest period points at a row this caller may not read, or at one that is no longer
    /// there. The id is not returned, on the same terms the detail route withholds it on.
    /// </summary>
    public const string Withheld = "withheld";

    /// <summary>The chain is longer than the walk follows. What came back is its newest end.</summary>
    public const string Cap = "cap";

    /// <summary>
    /// The chain came back to a period already in it. Refused on write since #89
    /// (<c>WouldCreateCycleAsync</c>), but a link written before that could close a loop, and
    /// a read path that hangs on data the write path used to allow is not defensible.
    /// </summary>
    public const string Cycle = "cycle";
}

/// <summary>A category present in the caller's readable scope, and what is in it.</summary>
/// <param name="GlobalCount">
/// How many of them are global rows (<c>companyId == null</c>) -- readable by every tenant,
/// writable only by a SuperAdmin. A CompanyAdmin looking at a category of eight benchmarks
/// needs to know how many of them are theirs to edit.
/// </param>
public sealed record BenchmarkCategorySummary(
    string Category,
    int BenchmarkCount,
    int GlobalCount,
    int ActiveCount,
    IReadOnlyList<string> Types,
    double AverageQualityScore);

/// <summary>The filters an industry aggregate was actually computed under.</summary>
/// <remarks>
/// Echoed back because two of them can be defaulted from <c>benchmarkId</c> rather than
/// supplied, and a reader of the aggregate has to know which sector it is the aggregate OF.
/// </remarks>
public sealed record BenchmarkIndustryFilters(
    string? Industry, string? CompanySize, string? Region, string? Category, string? Type);

/// <summary>
/// One metric aggregated across a sector, in one unit.
/// </summary>
/// <remarks>
/// Grouped by name AND unit. Averaging a metric recorded as <c>percent</c> in one benchmark
/// and as <c>fraction</c> in another produces a mean that is true of neither -- the same
/// failure the delta rule refuses one level down. There the answer is to withhold the number;
/// here it is that the two are simply different rows.
/// </remarks>
/// <param name="SubjectValue">The subject benchmark's own value, when a <c>benchmarkId</c> was supplied and it records this metric in this unit.</param>
/// <param name="SubjectDelta"><c>SubjectValue - Mean</c>: how far this benchmark sits from its sector.</param>
/// <param name="SubjectPercentileRank">
/// The share of peer benchmarks reading strictly below the subject, 0..100. Null when there
/// are no peers -- a percentile against nobody is not a small sample, it is not a percentile.
/// </param>
public sealed record BenchmarkIndustryMetric(
    string MetricName,
    string Unit,
    int BenchmarkCount,
    int TotalSampleSize,
    double Mean,
    double Median,
    double Min,
    double Max,
    double? SubjectValue,
    double? SubjectDelta,
    double? SubjectChangeRatio,
    double? SubjectPercentileRank);

/// <summary>A sector aggregate, and optionally where one benchmark sits inside it.</summary>
/// <param name="BenchmarkCount">
/// How many benchmarks the aggregate is over, EXCLUDING the subject. A caller has to be able
/// to see that a "sector" of one is not a sector, and a subject counted into its own mean
/// pulls the mean toward itself and shrinks the very gap the reading is about.
/// </param>
/// <param name="SubjectMetrics">
/// The subject's own readings, empty when no <c>benchmarkId</c> was supplied. Present even
/// when <paramref name="Metrics"/> is empty, and that is the point of the field: a company
/// first in its sector has no peers, so every aggregate is empty, and without this the
/// response could not be told apart from one for a benchmark that records nothing at all. The
/// first case is worth a page saying "nothing to compare against yet, here is your reading";
/// the second is not.
/// </param>
public sealed record BenchmarkIndustryResult(
    BenchmarkIndustryFilters Filters,
    int BenchmarkCount,
    BenchmarkComparisonMember? Subject,
    IReadOnlyList<BenchmarkIndustryMetric> Metrics,
    IReadOnlyList<BenchmarkMetricDto> SubjectMetrics);

/// <summary>One metric of one benchmark being imported.</summary>
public sealed record ImportBenchmarkMetricItem(
    string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);

/// <summary>
/// One benchmark being imported, with its metrics in the same request.
/// </summary>
/// <remarks>
/// <c>CompanyId</c> is nullable and the null is the dangerous one: it creates a GLOBAL
/// benchmark, which every tenant reads. The import path applies <c>CanWriteBenchmark</c> to
/// every item for exactly that reason -- a bulk path that checked the caller once and then
/// trusted the payload reopens the hole #84 closed on create.
/// </remarks>
public sealed record ImportBenchmarkItem(
    string Name,
    string Description,
    string Type,
    string Category,
    string Source,
    string? Industry,
    string? CompanySize,
    string? Region,
    Guid? CompanyId,
    IReadOnlyList<ImportBenchmarkMetricItem>? Metrics);

/// <param name="ValidateOnly">
/// True checks and scores every item and writes nothing. Defaults to false: unlike the
/// prior-period backfill, an import is a thing the caller asked for by name, and defaulting
/// it to a no-op would be surprising rather than safe.
/// </param>
public sealed record ImportBenchmarksRequest(
    IReadOnlyList<ImportBenchmarkItem> Benchmarks, bool? ValidateOnly);

/// <param name="Index">Position in the request, so a result ties back to a row of the caller's file.</param>
/// <param name="Id">Null on a validate-only run -- nothing was created, so there is no id to give.</param>
public sealed record ImportedBenchmarkSummary(
    int Index, Guid? Id, string Name, Guid? CompanyId, int Metrics, double QualityScore, string ValidationStatus);

/// <param name="Applied">False on a validate-only run.</param>
public sealed record ImportBenchmarksResult(
    bool Applied, int Benchmarks, int Metrics, IReadOnlyList<ImportedBenchmarkSummary> Created);

/// <param name="Index">Position in the request of the item that was rejected.</param>
public sealed record ImportBenchmarkError(int Index, string Message);
