namespace ClimateProject.Application.Reports;

public sealed record BenchmarkMetricDto(Guid Id, string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);

public sealed record BenchmarkListItem(
    Guid Id, string Name, string Type, string Category, Guid? CompanyId, bool IsActive, double QualityScore,
    string PriorPeriodStatus);

public sealed record BenchmarkDetail(
    Guid Id, string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, bool IsActive,
    string ValidationStatus, double QualityScore, Guid? PriorPeriodBenchmarkId,
    IReadOnlyList<BenchmarkMetricDto> Metrics,
    // One of PriorPeriodStatuses. `PriorPeriodBenchmarkId is null` cannot answer the question
    // this does: see Benchmark.PriorPeriodStatus for why "no prior period exists" and "nobody
    // has linked one yet" have to be told apart by a reader.
    string PriorPeriodStatus,
    // Null unless PriorPeriodStatus is `linked` AND the caller may read the linked row. A
    // CompanyAdmin can only ever link within their own tenant, but a SuperAdmin-authored
    // global chain is readable by everyone, so the read check still runs.
    BenchmarkPriorPeriodDto? PriorPeriod);

/// <summary>
/// The prior period a benchmark links to, with this benchmark's metrics already read against
/// it.
/// </summary>
/// <remarks>
/// <para>
/// The year-over-year figure is computed once, here, on the server. It was previously not
/// computed anywhere on the server at all: the browser fetched the whole prior benchmark and
/// differenced the two metric lists itself (<c>benchmarkAnalysis.buildTrend</c>). That is
/// fine for a page with a chain in hand and useless to every non-browser consumer -- the
/// tracking module's <c>resultado_anio_anterior_pct</c>, a report section, #90's
/// <c>compare</c>/<c>trends</c> routes -- each of which would otherwise re-derive the same
/// subtraction, and the derivations would drift.
/// </para>
/// </remarks>
public sealed record BenchmarkPriorPeriodDto(
    Guid Id,
    string Name,
    IReadOnlyList<BenchmarkMetricChangeDto> Metrics);

/// <summary>
/// One metric read against the same metric in the prior period.
/// </summary>
/// <param name="Value">This period's value, or null when the prior period records a metric this one does not.</param>
/// <param name="PriorValue">The prior period's value, or null when this metric is new.</param>
/// <param name="Delta">
/// <c>Value - PriorValue</c>, or null when either side is missing OR the two sides are
/// recorded in different units. Subtracting a percentage from a point score produces a
/// confidently wrong number, which is the exact failure #89 exists to avoid; the units are
/// reported so a caller can say why the change is absent instead of printing a dash.
/// </param>
/// <param name="ChangeRatio">
/// <c>Delta / PriorValue</c> -- the fractional year-over-year change, which is the shape
/// <c>resultado_anio_anterior_pct</c>'s consumers want. Null when <paramref name="Delta"/> is
/// null, and null when <paramref name="PriorValue"/> is zero: dividing by it yields an
/// infinity that serialises as a JSON parse error, not a reading.
/// </param>
public sealed record BenchmarkMetricChangeDto(
    string MetricName,
    double? Value,
    string? Unit,
    double? PriorValue,
    string? PriorUnit,
    double? Delta,
    double? ChangeRatio);

public sealed record CreateBenchmarkRequest(
    string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, Guid? PriorPeriodBenchmarkId);

// Deliberately narrower than CreateBenchmarkRequest: Type, Category, Source, CompanyId, and
// PriorPeriodBenchmarkId are immutable after creation (they define what the benchmark IS and
// who owns it), so PUT only accepts the fields that are actually applied by UpdateAsync.
//
// PriorPeriodBenchmarkId is the one of those five that turned out NOT to be a property of what
// the benchmark IS -- it is a statement about our own knowledge, arrives later than the
// benchmark does, and for every row created before #89 can never arrive at all. It gets its
// own route (PUT /admin/benchmarks/{id}/prior-period) rather than being folded in here,
// because linking has validation this request has no business carrying: scope, category,
// type and cycle checks, plus the third state that has no pointer to put in a field.
public sealed record UpdateBenchmarkRequest(string Name, string Description, string? Industry, string? CompanySize, string? Region);

public sealed record AddBenchmarkMetricRequest(string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);

/// <summary>
/// Declares what a benchmark's prior period is, or that it has none.
/// </summary>
/// <param name="Status">One of <c>PriorPeriodStatuses</c>. <c>linked</c> requires
/// <paramref name="PriorPeriodBenchmarkId"/>; the other two forbid it.</param>
public sealed record SetPriorPeriodRequest(string Status, Guid? PriorPeriodBenchmarkId);

/// <summary>
/// A benchmark that <em>could</em> be the prior period of another, and the reason it could.
/// </summary>
/// <remarks>
/// Suggestions only. Nothing in this API applies one on its own -- see
/// <c>docs/decisions/prior-period-benchmark-linkage.md</c>.
/// </remarks>
/// <param name="Unambiguous">
/// True only when this is the sole candidate. The single signal a backfill is allowed to act
/// on, and the one a UI should use to decide whether to preselect anything.
/// </param>
public sealed record PriorPeriodCandidateDto(
    Guid Id,
    string Name,
    string Category,
    string Type,
    DateTimeOffset CreatedAt,
    int MetricCount,
    bool Unambiguous);

/// <summary>What a backfill run did, or would do.</summary>
/// <param name="Applied">False for a dry run. A dry run is the default; see the endpoint.</param>
public sealed record PriorPeriodBackfillResult(
    bool Applied,
    int Considered,
    int Linked,
    int Ambiguous,
    int NoCandidate,
    IReadOnlyList<PriorPeriodBackfillDecision> Decisions);

/// <param name="Outcome">
/// <c>linked</c>, <c>ambiguous</c> (more than one candidate -- left alone, deliberately) or
/// <c>no-candidate</c> (nothing earlier in the same scope and category).
/// </param>
public sealed record PriorPeriodBackfillDecision(
    Guid BenchmarkId,
    string BenchmarkName,
    string Outcome,
    Guid? PriorPeriodBenchmarkId,
    int CandidateCount);
