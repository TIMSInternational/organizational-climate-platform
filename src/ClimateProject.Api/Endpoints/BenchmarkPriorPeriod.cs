using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Everything that decides what a benchmark's prior period is, and what the year-over-year
/// reading against it comes to.
/// </summary>
/// <remarks>
/// <para>
/// <b>One source for the consumers that can share one.</b> #90 adds <c>compare</c> and
/// <c>trends</c>, both of which need exactly this arithmetic, and the tracking module's
/// <c>resultado_anio_anterior_pct</c> needs the same subtraction over the same pair. Each is a
/// place where "current minus prior" could be written a second time and come out different, so
/// it is written here, once.
/// </para>
/// <para>
/// <b>One consumer cannot share it, and that is worth being precise about.</b>
/// <c>benchmarkAnalysis.buildTrend</c> in the browser differences a whole CHAIN of periods,
/// which no route returns -- the page assembles it by walking
/// <c>priorPeriodBenchmarkId</c> one GET at a time -- so it is a second implementation and
/// will stay one until a chain endpoint exists. What the two must never disagree about is the
/// rule below: <b>no delta across two different units</b>. It held here and not there, and the
/// screen is the half a reader sees, so a linked benchmark recorded in <c>percent</c> one
/// period and <c>fraction</c> the next printed a 69-point collapse directly underneath an API
/// response that had correctly withheld it. Both sides now withhold it, and both sides assert
/// it (<c>A_change_is_not_computed_across_two_different_units</c> here,
/// <c>benchmarkAnalysis.test.ts</c> and <c>BenchmarksPage.test.tsx</c> there).
/// </para>
/// <para>
/// <b>Automatic matching suggests; it never writes.</b> The matching rule
/// (<see cref="CandidatesQuery"/>) is deliberately reachable only from a suggestion route
/// and from a backfill that refuses anything ambiguous. The decision and its reasoning are
/// in <c>docs/decisions/prior-period-benchmark-linkage.md</c>; the short version is the one
/// #89 gives: a wrong automatic match produces a confidently wrong comparison, which is
/// worse than a blank.
/// </para>
/// </remarks>
public static class BenchmarkPriorPeriod
{
    /// <summary>
    /// How far <see cref="WouldCreateCycleAsync"/> and any chain walk will follow links
    /// before giving up.
    /// </summary>
    /// <remarks>
    /// A bound as well as the visited set, because the visited set only terminates a walk
    /// that actually loops; a long legitimate chain would still issue a query per period. The
    /// browser's <c>followPriorPeriodChain</c> caps at 12 for the same reason.
    /// </remarks>
    public const int MaxChainLength = 32;

    /// <summary>
    /// The benchmarks that could be <paramref name="subject"/>'s prior period.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Four conditions, and each one is load-bearing:
    /// </para>
    /// <list type="bullet">
    /// <item><b>Same owner.</b> Company benchmark to company benchmark, global to global. Not
    /// merely an authorization convenience -- a company benchmark whose prior period is a
    /// global row is comparing a company against the industry and calling it a year-over-year
    /// change. Global rows are also visible to every tenant, so a company-scoped link into
    /// one would let a reader in tenant A infer movement from a row tenant B maintains.</item>
    /// <item><b>Same category.</b> The category is what the benchmark measures. "Engagement
    /// 2026" preceded by "Absenteeism 2025" is not a prior period of anything.</item>
    /// <item><b>Same type.</b> Two rows in the same category can still be different KINDS of
    /// benchmark (internal vs industry); differencing across them mixes populations.</item>
    /// <item><b>Strictly earlier.</b> A benchmark has no period field -- the trend table in
    /// the browser says so, and it is why a period is labelled with its benchmark's name
    /// rather than a date. <c>CreatedAt</c> is the only ordering signal that exists, and it
    /// is a weak one: a 2024 benchmark entered late is younger than a 2025 one entered on
    /// time. That weakness is the whole argument for suggesting rather than applying.</item>
    /// </list>
    /// <para>
    /// Inactive rows are excluded: a deactivated benchmark is one an administrator has taken
    /// out of use, and proposing it as the thing this year is measured against undoes that.
    /// An explicitly chosen link to an inactive row is still honoured -- deactivating last
    /// year's benchmark must not silently blank this year's comparison.
    /// </para>
    /// </remarks>
    public static IQueryable<Benchmark> CandidatesQuery(IQueryable<Benchmark> benchmarks, Benchmark subject)
        => benchmarks.Where(b =>
            b.Id != subject.Id
            && b.CompanyId == subject.CompanyId
            && b.Category == subject.Category
            && b.Type == subject.Type
            && b.IsActive
            && b.CreatedAt < subject.CreatedAt);

    /// <summary>
    /// Whether pointing <paramref name="subjectId"/> at <paramref name="priorId"/> would
    /// close a loop.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Before #89 the only check on a link was "does that row exist", so A→B→A was
    /// creatable and the browser had to carry a visited set to keep the benchmarks page from
    /// hanging on it. The write path is the place to refuse it: a cycle is not a chain with
    /// an awkward shape, it is a claim that a period precedes itself.
    /// </para>
    /// <para>
    /// Walks forward from the proposed prior and returns true if it arrives back at the
    /// subject. Self-links are the length-zero case and are caught by the same walk.
    /// </para>
    /// </remarks>
    public static async Task<bool> WouldCreateCycleAsync(
        ClimateProjectDbContext db, Guid subjectId, Guid priorId, CancellationToken cancellationToken)
    {
        var cursor = (Guid?)priorId;
        var visited = new HashSet<Guid> { subjectId };

        for (var step = 0; step < MaxChainLength && cursor.HasValue; step++)
        {
            if (!visited.Add(cursor.Value)) return cursor.Value == subjectId;
            if (cursor.Value == subjectId) return true;

            cursor = await db.Benchmarks
                .Where(b => b.Id == cursor.Value)
                .Select(b => b.PriorPeriodBenchmarkId)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return false;
    }

    /// <summary>
    /// Loads the prior period of <paramref name="benchmark"/> with this period's metrics
    /// already read against it, or null when there is nothing to read.
    /// </summary>
    /// <param name="currentMetrics">
    /// <paramref name="benchmark"/>'s own metrics, in the order
    /// <see cref="LoadMetricsAsync"/> produces. Passed in rather than read again because the
    /// only caller has just read them; the ordering is part of the contract, since the pairing
    /// below matches on name and an unordered list pairs a different duplicate each time.
    /// </param>
    /// <param name="canRead">
    /// The caller's read check, applied to the prior row's owner. A CompanyAdmin can only
    /// create links inside their own tenant, but rows predating #89 and rows written by a
    /// SuperAdmin carry no such promise, so the link is re-checked on the way out rather than
    /// trusted because of how it was made.
    /// </param>
    public static async Task<BenchmarkPriorPeriodDto?> LoadPriorPeriodAsync(
        ClimateProjectDbContext db,
        Benchmark benchmark,
        IReadOnlyList<BenchmarkMetricDto> currentMetrics,
        Func<Guid?, bool> canRead,
        CancellationToken cancellationToken)
    {
        if (benchmark.PriorPeriodStatus != PriorPeriodStatuses.Linked || !benchmark.PriorPeriodBenchmarkId.HasValue)
        {
            return null;
        }

        var priorId = benchmark.PriorPeriodBenchmarkId.Value;
        var prior = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == priorId, cancellationToken);
        if (prior is null || !canRead(prior.CompanyId)) return null;

        var priorMetrics = await LoadMetricsAsync(db, prior.Id, cancellationToken);

        return new BenchmarkPriorPeriodDto(prior.Id, prior.Name, BuildChanges(currentMetrics, priorMetrics));
    }

    /// <summary>
    /// A benchmark's metrics in a stable order.
    /// </summary>
    /// <remarks>
    /// Ordered because nothing else was. <c>benchmark_metrics</c> has no ordering column and
    /// the detail projection carried no <c>ORDER BY</c>, so Postgres was free to return the
    /// same benchmark's metrics in a different order on two consecutive requests. That is
    /// merely untidy for a list, and wrong for a comparison: the pairing below matches on
    /// name, so a benchmark carrying the same metric name twice would pair a different one
    /// each time and the year-over-year figure would change without the data changing.
    /// </remarks>
    public static Task<List<BenchmarkMetricDto>> LoadMetricsAsync(
        ClimateProjectDbContext db, Guid benchmarkId, CancellationToken cancellationToken)
        => db.BenchmarkMetrics
            .Where(m => m.BenchmarkId == benchmarkId)
            .OrderBy(m => m.MetricName).ThenBy(m => m.Id)
            .Select(m => new BenchmarkMetricDto(m.Id, m.MetricName, m.Value, m.Unit, m.Percentile, m.SampleSize))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Pairs two periods' metrics by name and computes the change.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every metric named by either side gets a row, this period's first and then any the
    /// prior period had and this one dropped -- a metric that stopped being recorded is
    /// itself worth seeing, and a consumer that only wants the current ones can filter on a
    /// non-null <c>Value</c>.
    /// </para>
    /// <para>
    /// <b>Units are compared before values are.</b> <c>BenchmarkMetric.Unit</c> is a free
    /// string, so the same metric name can arrive as <c>s</c> one year and <c>ms</c> the
    /// next; 1.2 against 1200 then reads as a catastrophe rather than as the same number
    /// twice. Both units are reported and the delta withheld, so a caller can say why. Exact
    /// string comparison, matching what the browser's comparison matrix already treats as
    /// "units differ".
    /// </para>
    /// </remarks>
    public static IReadOnlyList<BenchmarkMetricChangeDto> BuildChanges(
        IReadOnlyList<BenchmarkMetricDto> current, IReadOnlyList<BenchmarkMetricDto> prior)
    {
        var names = new List<string>();
        foreach (var metric in current)
        {
            if (!names.Contains(metric.MetricName, StringComparer.Ordinal)) names.Add(metric.MetricName);
        }
        foreach (var metric in prior)
        {
            if (!names.Contains(metric.MetricName, StringComparer.Ordinal)) names.Add(metric.MetricName);
        }

        var changes = new List<BenchmarkMetricChangeDto>(names.Count);
        foreach (var name in names)
        {
            var now = current.FirstOrDefault(m => string.Equals(m.MetricName, name, StringComparison.Ordinal));
            var then = prior.FirstOrDefault(m => string.Equals(m.MetricName, name, StringComparison.Ordinal));

            double? delta = null;
            double? changeRatio = null;
            if (now is not null && then is not null && string.Equals(now.Unit, then.Unit, StringComparison.Ordinal))
            {
                delta = now.Value - then.Value;
                if (then.Value != 0) changeRatio = delta / then.Value;
            }

            changes.Add(new BenchmarkMetricChangeDto(
                MetricName: name,
                Value: now?.Value,
                Unit: now?.Unit,
                PriorValue: then?.Value,
                PriorUnit: then?.Unit,
                Delta: delta,
                ChangeRatio: changeRatio));
        }

        return changes;
    }
}
