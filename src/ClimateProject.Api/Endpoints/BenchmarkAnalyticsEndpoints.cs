using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The analytical half of <c>/admin/benchmarks</c>: compare, trends, industry, categories,
/// import and validate.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a second file and not a second class.</b> These routes need the same two
/// authorization helpers as the storage routes (<c>CanReadBenchmark</c>,
/// <c>CanWriteBenchmark</c>) and the same acting-user resolution. A separate class would mean
/// widening those from private, and the multi-tenant rule they encode -- global rows are
/// readable by everyone and writable only by a SuperAdmin -- is the one thing in this file
/// that must not acquire a second implementation. So this is the same class, split across two
/// files, with one <c>MapGroup</c> and one registration in <c>Program.cs</c>.
/// </para>
/// <para>
/// <b>What was NOT ported, and why.</b> #90 lists ten legacy routes. The legacy application
/// lived in the retired <c>TIMSInternational/climate-project</c> repository and its source is
/// not in this repo or its history -- only the issue archive under <c>docs/legacy-issues/</c>
/// survives -- so "read each legacy route before porting" could not be done literally. The
/// decisions were taken against what the product needs and are written down in
/// <c>docs/decisions/benchmark-analytics-endpoints.md</c>; the short version:
/// <c>bulk</c> is the same act as <c>import</c> and is that one route, <c>similar</c> is
/// <c>industry</c> with the subject's own attributes as the filter and is reached that way,
/// <c>analysis</c> is the union of <c>trends</c>, <c>compare</c> and <c>validate</c> and would
/// only re-derive them, and <c>recommendations</c> needs the AI work in #67 and is not built
/// here.
/// </para>
/// </remarks>
public static partial class BenchmarkEndpoints
{
    /// <summary>
    /// How many benchmarks one <c>compare</c> call may name.
    /// </summary>
    /// <remarks>
    /// Ten is a screen, not a limit anybody will meet by accident. The cap exists because the
    /// route loads every named benchmark's metrics, so an unbounded id list is an unbounded
    /// query; refusing at the door is cheaper than discovering it in production.
    /// </remarks>
    public const int MaxComparisonMembers = 10;

    /// <summary>How many benchmarks one <c>import</c> call may carry.</summary>
    /// <remarks>
    /// The whole import is one transaction, so this is also the size of the longest write the
    /// route can hold a connection for.
    /// </remarks>
    public const int MaxImportItems = 200;

    // -----------------------------------------------------------------------------------
    // compare
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// Reads two or more benchmarks against one of them.
    /// </summary>
    /// <param name="ids">
    /// Comma-separated benchmark ids, in the order the caller wants them back. A single
    /// repeated query parameter would also have bound, but one string means one place to
    /// produce a clear 400 for a malformed id instead of the framework's binding failure, and
    /// it survives being pasted into a URL bar.
    /// </param>
    /// <param name="baselineId">
    /// Which of <paramref name="ids"/> everything else is differenced against. Defaults to the
    /// first. It has to be nameable: for a year-over-year reading the baseline is last year,
    /// for a sector reading it is the industry row, and the caller is the only one who knows
    /// which question is being asked.
    /// </param>
    /// <remarks>
    /// Every named benchmark is authorized individually. Naming several ids in one request is
    /// not a way to read one the caller could not read alone.
    /// </remarks>
    private static async Task<IResult> CompareAsync(
        string? ids, Guid? baselineId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var requested = new List<Guid>();
        foreach (var raw in (ids ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!Guid.TryParse(raw, out var parsed))
            {
                return Results.Json(new { message = $"'{raw}' is not a benchmark id" }, statusCode: 400);
            }
            // Deduplicated rather than refused: a benchmark compared against itself is a
            // column of zeroes, which is noise, not an error worth failing a request over.
            if (!requested.Contains(parsed)) requested.Add(parsed);
        }

        if (requested.Count < 2)
        {
            return Results.Json(new { message = "Comparing needs at least two distinct benchmark ids in 'ids'" }, statusCode: 400);
        }

        if (requested.Count > MaxComparisonMembers)
        {
            return Results.Json(new { message = $"At most {MaxComparisonMembers} benchmarks can be compared at once" }, statusCode: 400);
        }

        var baseline = baselineId ?? requested[0];
        if (!requested.Contains(baseline))
        {
            return Results.Json(new { message = "baselineId must be one of the ids being compared" }, statusCode: 400);
        }

        var loaded = await db.Benchmarks.Where(b => requested.Contains(b.Id)).ToListAsync(cancellationToken);
        var byId = loaded.ToDictionary(b => b.Id);

        foreach (var id in requested)
        {
            if (!byId.TryGetValue(id, out var benchmark))
            {
                return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
            }
            if (!CanReadBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();
        }

        var metricsById = new Dictionary<Guid, IReadOnlyList<BenchmarkMetricDto>>();
        foreach (var id in requested)
        {
            metricsById[id] = await BenchmarkPriorPeriod.LoadMetricsAsync(db, id, cancellationToken);
        }

        var baselineMetrics = metricsById[baseline];
        var comparisons = new List<BenchmarkComparisonEntry>(requested.Count - 1);
        foreach (var id in requested)
        {
            if (id == baseline) continue;
            // The one subtraction, from #89's function, so the no-delta-across-units rule
            // holds here without being written a second time.
            var changes = BenchmarkPriorPeriod.BuildChanges(metricsById[id], baselineMetrics);
            comparisons.Add(new BenchmarkComparisonEntry(Member(byId[id]), changes.Select(ToComparison).ToList()));
        }

        return Results.Ok(new BenchmarkComparisonResult(Member(byId[baseline]), baselineMetrics, comparisons));
    }

    /// <summary>
    /// Renames a <see cref="BenchmarkMetricChangeDto"/>'s "prior" side to "baseline".
    /// </summary>
    /// <remarks>
    /// A pure rename, and the only thing that separates the two records. It is worth the
    /// twelve lines: the alternative is either a second implementation of the subtraction, or
    /// a comparison payload that tells the reader a sector gap is a change over time.
    /// </remarks>
    private static BenchmarkMetricComparisonDto ToComparison(BenchmarkMetricChangeDto change)
        => new(change.MetricName, change.Value, change.Unit, change.PriorValue, change.PriorUnit, change.Delta, change.ChangeRatio);

    private static BenchmarkComparisonMember Member(Benchmark benchmark)
        => new(benchmark.Id, benchmark.Name, benchmark.Category, benchmark.Type, benchmark.CompanyId,
            benchmark.Industry, benchmark.CompanySize, benchmark.Region);

    // -----------------------------------------------------------------------------------
    // trends
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// Every period behind a benchmark, oldest first, with each period read against the one
    /// before it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The chain endpoint #89 recorded as missing. It is what makes year-over-year available
    /// to a consumer that is not the benchmarks page: a report section, the tracking module's
    /// <c>resultado_anio_anterior_pct</c>, an export. Each hop is authorized, so a chain that
    /// leaves the caller's scope stops there and says so through <c>StopReason</c> rather than
    /// returning a shorter trend that looks complete.
    /// </para>
    /// <para>
    /// The walk carries a visited set as well as the length cap. Cycles are refused on write
    /// (<c>WouldCreateCycleAsync</c>), but only since #89 -- a row linked before that could
    /// close a loop, and a read path that hangs on data the write path used to allow is not
    /// defensible.
    /// </para>
    /// </remarks>
    private static async Task<IResult> TrendsAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var subject = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (subject is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanReadBenchmark(currentUser, subject.CompanyId)) return Results.Forbid();

        // Newest first while walking; reversed once at the end.
        var chain = new List<Benchmark> { subject };
        var visited = new HashSet<Guid> { subject.Id };
        var stopReason = BenchmarkTrendStopReasons.Unlinked;

        while (true)
        {
            var last = chain[^1];

            if (last.PriorPeriodStatus == PriorPeriodStatuses.None)
            {
                stopReason = BenchmarkTrendStopReasons.None;
                break;
            }

            if (last.PriorPeriodStatus != PriorPeriodStatuses.Linked || !last.PriorPeriodBenchmarkId.HasValue)
            {
                stopReason = BenchmarkTrendStopReasons.Unlinked;
                break;
            }

            if (chain.Count >= BenchmarkPriorPeriod.MaxChainLength)
            {
                stopReason = BenchmarkTrendStopReasons.Cap;
                break;
            }

            var priorId = last.PriorPeriodBenchmarkId.Value;
            if (!visited.Add(priorId))
            {
                stopReason = BenchmarkTrendStopReasons.Cycle;
                break;
            }

            var prior = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == priorId, cancellationToken);
            // A missing row and an unreadable one are one answer on purpose. Telling them
            // apart would confirm that a benchmark with that id exists in a tenant the caller
            // cannot see, which is the oracle #89 closed on the detail route.
            if (prior is null || !CanReadBenchmark(currentUser, prior.CompanyId))
            {
                stopReason = BenchmarkTrendStopReasons.Withheld;
                break;
            }

            chain.Add(prior);
        }

        chain.Reverse();

        var metrics = new List<IReadOnlyList<BenchmarkMetricDto>>(chain.Count);
        foreach (var period in chain)
        {
            metrics.Add(await BenchmarkPriorPeriod.LoadMetricsAsync(db, period.Id, cancellationToken));
        }

        // Period-over-period changes, one BuildChanges call per adjacent pair, so the trend
        // and the detail route's single-step comparison cannot disagree.
        // Index 0 is the oldest period, which has nothing before it, so it holds an empty list
        // and every later index lines up with `chain`.
        var changes = new List<IReadOnlyList<BenchmarkMetricChangeDto>>(chain.Count);
        changes.Add(Array.Empty<BenchmarkMetricChangeDto>());
        for (var i = 1; i < chain.Count; i++)
        {
            changes.Add(BenchmarkPriorPeriod.BuildChanges(metrics[i], metrics[i - 1]));
        }

        // Ordinal sort rather than encounter order: a metric that only the newest period
        // records would otherwise land at the end of the list on one request and in the
        // middle on the next, and a chart legend that reorders itself between refreshes reads
        // as data changing.
        var names = metrics
            .SelectMany(list => list.Select(m => m.MetricName))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        var series = new List<BenchmarkTrendSeries>(names.Count);
        foreach (var name in names)
        {
            var points = new List<BenchmarkTrendPoint>(chain.Count);
            for (var i = 0; i < chain.Count; i++)
            {
                var own = metrics[i].FirstOrDefault(m => string.Equals(m.MetricName, name, StringComparison.Ordinal));
                var change = i == 0
                    ? null
                    : changes[i].FirstOrDefault(c => string.Equals(c.MetricName, name, StringComparison.Ordinal));

                points.Add(new BenchmarkTrendPoint(
                    chain[i].Id, own?.Value, own?.Unit, change?.Delta, change?.ChangeRatio));
            }
            series.Add(new BenchmarkTrendSeries(name, points));
        }

        return Results.Ok(new BenchmarkTrendResult(
            subject.Id,
            subject.Name,
            chain.Select(b => new BenchmarkTrendPeriod(b.Id, b.Name, b.CreatedAt, b.PriorPeriodStatus)).ToList(),
            series,
            stopReason));
    }

    // -----------------------------------------------------------------------------------
    // industry
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// Aggregates a sector's benchmarks, and says where one benchmark sits inside it.
    /// </summary>
    /// <param name="benchmarkId">
    /// The benchmark to place inside the sector. Supplying it also defaults
    /// <paramref name="industry"/> and <paramref name="category"/> from that benchmark, which
    /// is what the legacy <c>similar</c> route was: the peers of this row. Company size and
    /// region are NOT defaulted -- they narrow a sector rather than define one, and a caller
    /// who wants "manufacturers of our size in Central America" has to say so. Type is not
    /// defaulted either, and that one matters: an internal benchmark's sector is made of
    /// <c>industry</c>-type rows, so defaulting type from the subject would compare a company
    /// only against other companies' internal numbers and never against the industry.
    /// </param>
    /// <remarks>
    /// <para>
    /// <b>The subject is excluded from its own sector.</b> A benchmark counted into the mean it
    /// is being measured against pulls that mean toward itself and shrinks the gap the reading
    /// exists to show -- most of all when the sector is small, which is when the reading is
    /// most likely to be quoted.
    /// </para>
    /// <para>
    /// <b>Inactive benchmarks are excluded.</b> Deactivating a benchmark is an administrator
    /// saying it is no longer in use; leaving it in the sector average would keep it in use.
    /// </para>
    /// <para>
    /// <b>One benchmark, one vote.</b> A benchmark recording the same metric twice in the same
    /// unit contributes its own average of those, not two observations, so a row with a
    /// duplicated metric cannot outweigh the rest of the sector.
    /// </para>
    /// </remarks>
    private static async Task<IResult> IndustryAsync(
        string? industry,
        string? companySize,
        string? region,
        string? category,
        string? type,
        Guid? benchmarkId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        Benchmark? subject = null;
        if (benchmarkId.HasValue)
        {
            subject = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == benchmarkId.Value, cancellationToken);
            if (subject is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
            if (!CanReadBenchmark(currentUser, subject.CompanyId)) return Results.Forbid();

            industry ??= subject.Industry;
            category ??= subject.Category;
        }

        industry = Blank(industry);
        companySize = Blank(companySize);
        region = Blank(region);
        category = Blank(category);
        type = Blank(type);

        var scope = db.Benchmarks.Where(b => b.IsActive);
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            scope = scope.Where(b => b.CompanyId == null || b.CompanyId == ownCompanyId);
        }

        if (subject is not null) scope = scope.Where(b => b.Id != subject.Id);
        if (industry is not null) scope = scope.Where(b => b.Industry == industry);
        if (companySize is not null) scope = scope.Where(b => b.CompanySize == companySize);
        if (region is not null) scope = scope.Where(b => b.Region == region);
        if (category is not null) scope = scope.Where(b => b.Category == category);
        if (type is not null) scope = scope.Where(b => b.Type == type);

        var peerIds = await scope.Select(b => b.Id).ToListAsync(cancellationToken);

        var readings = await db.BenchmarkMetrics
            .Where(m => peerIds.Contains(m.BenchmarkId))
            .Select(m => new { m.BenchmarkId, m.MetricName, m.Value, m.Unit, m.SampleSize })
            .ToListAsync(cancellationToken);

        var subjectMetrics = subject is null
            ? []
            : await BenchmarkPriorPeriod.LoadMetricsAsync(db, subject.Id, cancellationToken);

        var groups = readings
            .GroupBy(r => (r.MetricName, r.Unit))
            .OrderBy(g => g.Key.MetricName, StringComparer.Ordinal)
            .ThenBy(g => g.Key.Unit, StringComparer.Ordinal);

        var aggregates = new List<BenchmarkIndustryMetric>();
        foreach (var group in groups)
        {
            var perBenchmark = group
                .GroupBy(r => r.BenchmarkId)
                .Select(g => g.Average(r => r.Value))
                .OrderBy(v => v)
                .ToList();

            var mean = perBenchmark.Average();
            var median = Median(perBenchmark);

            double? subjectValue = null;
            var own = subjectMetrics
                .Where(m => string.Equals(m.MetricName, group.Key.MetricName, StringComparison.Ordinal)
                    && string.Equals(m.Unit, group.Key.Unit, StringComparison.Ordinal))
                .ToList();
            if (own.Count > 0) subjectValue = own.Average(m => m.Value);

            double? subjectDelta = subjectValue.HasValue ? subjectValue.Value - mean : null;
            double? subjectChangeRatio = subjectDelta.HasValue && mean != 0 ? subjectDelta.Value / mean : null;
            double? percentileRank = subjectValue.HasValue
                ? 100d * perBenchmark.Count(v => v < subjectValue.Value) / perBenchmark.Count
                : null;

            aggregates.Add(new BenchmarkIndustryMetric(
                MetricName: group.Key.MetricName,
                Unit: group.Key.Unit,
                BenchmarkCount: perBenchmark.Count,
                TotalSampleSize: group.Sum(r => r.SampleSize ?? 0),
                Mean: mean,
                Median: median,
                Min: perBenchmark[0],
                Max: perBenchmark[^1],
                SubjectValue: subjectValue,
                SubjectDelta: subjectDelta,
                SubjectChangeRatio: subjectChangeRatio,
                SubjectPercentileRank: percentileRank));
        }

        return Results.Ok(new BenchmarkIndustryResult(
            new BenchmarkIndustryFilters(industry, companySize, region, category, type),
            peerIds.Count,
            subject is null ? null : Member(subject),
            aggregates));
    }

    /// <summary>The middle value, or the mean of the middle two. <paramref name="sorted"/> must already be sorted and non-empty.</summary>
    private static double Median(IReadOnlyList<double> sorted)
        => sorted.Count % 2 == 1
            ? sorted[sorted.Count / 2]
            : (sorted[(sorted.Count / 2) - 1] + sorted[sorted.Count / 2]) / 2d;

    /// <summary>Treats an empty or whitespace query value as absent.</summary>
    /// <remarks>
    /// <c>?industry=</c> is what a form submits for a field the user cleared, and reading it
    /// as a filter for the empty-string industry would return an empty sector rather than the
    /// unfiltered one the user just asked for.
    /// </remarks>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // -----------------------------------------------------------------------------------
    // categories
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// The categories present in the caller's readable scope.
    /// </summary>
    /// <remarks>
    /// The category is a free string typed by whoever creates the benchmark -- there is no
    /// catalogue, which is why <c>benchmarkQuality.ts</c> uses category values verbatim as
    /// axis labels. This route is how a form offers what already exists instead of inviting a
    /// fourteenth spelling of "engagement".
    /// </remarks>
    private static async Task<IResult> ListCategoriesAsync(
        ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.Benchmarks.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            query = query.Where(b => b.CompanyId == null || b.CompanyId == ownCompanyId);
        }

        var rows = await query
            .Select(b => new { b.Category, b.Type, b.CompanyId, b.IsActive, b.QualityScore })
            .ToListAsync(cancellationToken);

        var summaries = rows
            .GroupBy(r => r.Category, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new BenchmarkCategorySummary(
                Category: g.Key,
                BenchmarkCount: g.Count(),
                GlobalCount: g.Count(r => r.CompanyId is null),
                ActiveCount: g.Count(r => r.IsActive),
                Types: g.Select(r => r.Type).Distinct(StringComparer.Ordinal).OrderBy(t => t, StringComparer.Ordinal).ToList(),
                AverageQualityScore: Math.Round(g.Average(r => r.QualityScore), 1)))
            .ToList();

        return Results.Ok(summaries);
    }

    // -----------------------------------------------------------------------------------
    // validate
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// Runs the quality rule against a benchmark and stores what it said.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A WRITE, authorized as one. It moves <c>quality_score</c> and <c>validation_status</c>,
    /// and those are read by every tenant on a global benchmark, so validating one is
    /// SuperAdmin-only for the same reason creating one is. A caller who may only read a
    /// benchmark can still see the rule's inputs on the detail route and apply
    /// <see cref="BenchmarkQuality"/>'s published weights themselves.
    /// </para>
    /// <para>
    /// The rule itself is in <see cref="BenchmarkQuality"/> -- pure, weighted, and returned
    /// component by component so the total can be recomputed by hand from the response.
    /// </para>
    /// </remarks>
    private static async Task<IResult> ValidateAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var metrics = await BenchmarkPriorPeriod.LoadMetricsAsync(db, id, cancellationToken);
        var assessment = BenchmarkQuality.Assess(metrics, benchmark.Industry, benchmark.CompanySize, benchmark.Region);

        var previousStatus = benchmark.ValidationStatus;
        var previousScore = benchmark.QualityScore;

        benchmark.ValidationStatus = assessment.Status;
        benchmark.QualityScore = assessment.Score;
        benchmark.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new BenchmarkValidationResult(
            benchmark.Id, assessment.Status, assessment.Score, previousStatus, previousScore, assessment.Components));
    }

    // -----------------------------------------------------------------------------------
    // import (and bulk -- they are one route; see the class remarks)
    // -----------------------------------------------------------------------------------

    /// <summary>
    /// The first field of <paramref name="item"/> that is longer than its column, or null.
    /// </summary>
    /// <remarks>
    /// The widths are <c>BenchmarkConfiguration</c>'s. They are stated again here rather than
    /// read from the model because the point is to answer the caller BEFORE the insert: a
    /// length that only the database knows about can only be reported as a failed request.
    /// </remarks>
    private static string? TooLongField(ImportBenchmarkItem item)
    {
        if (item.Name?.Trim().Length > 200) return "Name must be 200 characters or fewer";
        if (item.Description?.Trim().Length > 2000) return "Description must be 2000 characters or fewer";
        if (item.Type?.Trim().Length > 20) return "Type must be 20 characters or fewer";
        if (item.Category?.Trim().Length > 100) return "Category must be 100 characters or fewer";
        if (item.Source?.Trim().Length > 200) return "Source must be 200 characters or fewer";
        if (item.Industry?.Length > 100) return "Industry must be 100 characters or fewer";
        if (item.CompanySize?.Length > 50) return "CompanySize must be 50 characters or fewer";
        if (item.Region?.Length > 100) return "Region must be 100 characters or fewer";
        return null;
    }

    /// <summary>
    /// Creates many benchmarks, with their metrics, in one transaction.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Every item is authorized on its own.</b> This is the whole reason #90 calls the
    /// import path out: <c>companyId</c> is per item, a null one means a GLOBAL benchmark that
    /// every tenant reads, and a bulk route that authorized the CALLER once and then trusted
    /// the payload would let any CompanyAdmin write global rows -- the exact hole #84 closed
    /// on create, reopened through a second door. So <c>CanWriteBenchmark</c> runs per item,
    /// before any validation and before any write.
    /// </para>
    /// <para>
    /// <b>All or nothing.</b> One transaction, and a single rejected item fails the request.
    /// A partial import leaves the caller's file and the database disagreeing about what
    /// happened, and the natural fix -- re-running the file -- then duplicates everything that
    /// did land.
    /// </para>
    /// <para>
    /// <b>Every imported benchmark is scored on the way in.</b> Same rule as <c>validate</c>,
    /// same function, so an imported row does not sit at <c>pending</c>/0 waiting for someone
    /// to notice it needs validating.
    /// </para>
    /// </remarks>
    private static async Task<IResult> ImportAsync(
        ImportBenchmarksRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var items = request?.Benchmarks;

        if (items is null || items.Count == 0)
        {
            return Results.Json(new { message = "Benchmarks is required and must contain at least one item" }, statusCode: 400);
        }

        if (items.Count > MaxImportItems)
        {
            return Results.Json(new { message = $"At most {MaxImportItems} benchmarks can be imported at once" }, statusCode: 400);
        }

        // Authorization first, over the whole payload, before anything is validated or
        // written. A caller who may not write an item must be refused whether or not that
        // item is also malformed -- otherwise the validation errors become a way to probe.
        var refused = new List<ImportBenchmarkError>();
        for (var i = 0; i < items.Count; i++)
        {
            if (!CanWriteBenchmark(currentUser, items[i].CompanyId))
            {
                refused.Add(new ImportBenchmarkError(
                    i,
                    items[i].CompanyId is null
                        ? "Only a SuperAdmin may import a global benchmark (companyId null)"
                        : "You may not import a benchmark for that company"));
            }
        }

        if (refused.Count > 0)
        {
            // A JSON body on a 403, where the rest of this file uses a bare Results.Forbid().
            // Deliberate and narrow: an import of two hundred rows that comes back as an empty
            // 403 leaves the caller with no way to find the row that did it, and the indexes
            // disclose nothing the caller did not send.
            return Results.Json(
                new { message = "Some benchmarks in this import are outside your write scope", errors = refused },
                statusCode: 403);
        }

        var errors = new List<ImportBenchmarkError>();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (string.IsNullOrWhiteSpace(item.Name) || string.IsNullOrWhiteSpace(item.Description)
                || string.IsNullOrWhiteSpace(item.Type) || string.IsNullOrWhiteSpace(item.Category)
                || string.IsNullOrWhiteSpace(item.Source))
            {
                errors.Add(new ImportBenchmarkError(i, "Name, Description, Type, Category, and Source are required"));
            }

            // Lengths are checked HERE and not left to the column widths. A vendor file with a
            // three-hundred-character benchmark name is an ordinary thing to be sent, and
            // Postgres answers it with a 22001 that surfaces as a 500 -- which tells the person
            // holding the file that the product is broken rather than that row 47 is too long.
            // The limits are BenchmarkConfiguration's and BenchmarkMetricConfiguration's; they
            // are repeated because the alternative is discovering them one production error at
            // a time.
            var tooLong = TooLongField(item);
            if (tooLong is not null)
            {
                errors.Add(new ImportBenchmarkError(i, tooLong));
            }

            foreach (var metric in item.Metrics ?? [])
            {
                if (string.IsNullOrWhiteSpace(metric.MetricName) || string.IsNullOrWhiteSpace(metric.Unit))
                {
                    errors.Add(new ImportBenchmarkError(i, "Every metric needs a MetricName and a Unit"));
                    break;
                }

                if (metric.MetricName.Trim().Length > 200 || metric.Unit.Trim().Length > 50)
                {
                    errors.Add(new ImportBenchmarkError(i, "MetricName must be 200 characters or fewer and Unit 50 or fewer"));
                    break;
                }

                if (double.IsNaN(metric.Value) || double.IsInfinity(metric.Value))
                {
                    // Not pedantry: these serialise as `NaN`/`Infinity`, which is not JSON, so
                    // one imported row would make every later read of that benchmark fail to
                    // parse in the browser.
                    errors.Add(new ImportBenchmarkError(i, "A metric value must be a finite number"));
                    break;
                }
            }
        }

        if (errors.Count > 0)
        {
            return Results.Json(new { message = "This import was rejected", errors }, statusCode: 400);
        }

        var validateOnly = request!.ValidateOnly == true;
        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;

        var summaries = new List<ImportedBenchmarkSummary>(items.Count);
        var benchmarks = new List<Benchmark>(items.Count);
        var metrics = new List<BenchmarkMetric>();

        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            var id = Guid.NewGuid();
            var itemMetrics = (item.Metrics ?? []).Select(m => new BenchmarkMetric
            {
                Id = Guid.NewGuid(),
                BenchmarkId = id,
                MetricName = m.MetricName.Trim(),
                Value = m.Value,
                Unit = m.Unit.Trim(),
                Percentile = m.Percentile,
                SampleSize = m.SampleSize,
            }).ToList();

            var assessment = BenchmarkQuality.Assess(
                itemMetrics.Select(m => new BenchmarkMetricDto(m.Id, m.MetricName, m.Value, m.Unit, m.Percentile, m.SampleSize)).ToList(),
                item.Industry, item.CompanySize, item.Region);

            benchmarks.Add(new Benchmark
            {
                Id = id,
                Name = item.Name.Trim(),
                Description = item.Description.Trim(),
                Type = item.Type.Trim(),
                Category = item.Category.Trim(),
                Source = item.Source.Trim(),
                Industry = item.Industry,
                CompanySize = item.CompanySize,
                Region = item.Region,
                CreatedBy = createdBy,
                CompanyId = item.CompanyId,
                IsActive = true,
                ValidationStatus = assessment.Status,
                QualityScore = assessment.Score,
                // An imported benchmark carries no prior-period claim. `unlinked`, not `none`:
                // the file said nothing about last year, and saying nothing is not the same as
                // saying there was nothing -- the distinction #89 exists for. The check
                // constraint requires the pointer to stay null alongside it.
                PriorPeriodStatus = PriorPeriodStatuses.Unlinked,
                PriorPeriodBenchmarkId = null,
                CreatedAt = now,
                UpdatedAt = now,
            });
            metrics.AddRange(itemMetrics);

            summaries.Add(new ImportedBenchmarkSummary(
                i, validateOnly ? null : id, item.Name.Trim(), item.CompanyId, itemMetrics.Count,
                assessment.Score, assessment.Status));
        }

        if (validateOnly)
        {
            return Results.Ok(new ImportBenchmarksResult(false, benchmarks.Count, metrics.Count, summaries));
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.Benchmarks.AddRange(benchmarks);
        db.BenchmarkMetrics.AddRange(metrics);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return Results.Json(new ImportBenchmarksResult(true, benchmarks.Count, metrics.Count, summaries), statusCode: 201);
    }
}
