using ClimateProject.Application.Reports;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The benchmark comparison section of a generated report (#88's third follow-up).
///
/// <para><b>Nothing here computes a comparison.</b> #61's boundary says a report is a
/// presentation over somebody else's derivation, and the derivation for benchmarks
/// already exists: <see cref="BenchmarkPriorPeriod.LoadMetricsAsync"/> owns the stable
/// metric ordering, <see cref="BenchmarkPriorPeriod.BuildChanges"/> owns the pairing and
/// the refusal to subtract across a change of unit, and
/// <see cref="BenchmarkPriorPeriod.LoadPriorPeriodAsync"/> owns re-checking the link on
/// the way out. This class calls those three and shapes the rows. A subtraction written
/// here would be a second implementation of the year-over-year figure, and the copy that
/// drifted would be the one arriving by email where nobody can diff it against the
/// benchmarks page.</para>
///
/// <para><b>Scope.</b> A report has no signed-in principal -- the scheduled runner (#91)
/// generates with nobody logged in -- so the tenant half of the read rule is applied
/// directly, through <see cref="BenchmarkEndpoints.ReadableBy"/> and
/// <see cref="BenchmarkEndpoints.CanCompanyReadBenchmark"/> rather than through a copy of
/// "own or global". A company's report therefore carries exactly the benchmarks a
/// CompanyAdmin of that company can read, and a prior period pointing outside that scope
/// is withheld here on the same terms the detail route withholds it on.</para>
///
/// <para><b>Cost.</b> Two queries per linked benchmark, over a table holding a handful of
/// rows per tenant plus the global set -- the same shape as generation's per-survey
/// aggregation, and bounded by the same thing: a company with enough benchmarks for this
/// to hurt is the trigger for making generation a background job, not for a cheaper
/// comparison.</para>
/// </summary>
internal static class ReportBenchmarks
{
    /// <summary>
    /// The benchmark sections for <paramref name="companyId"/>'s report, by name.
    /// </summary>
    /// <remarks>
    /// Inactive benchmarks are left out. <c>IsActive</c> is how a benchmark is retired
    /// without deleting the readings behind it, and the sector aggregate
    /// (<c>BenchmarkEndpoints.IndustryAsync</c>) already reads only active rows; a report
    /// that printed a retired benchmark beside the live ones would be presenting, as this
    /// quarter's comparison, a row somebody deliberately took out of circulation.
    /// </remarks>
    public static async Task<IReadOnlyList<ReportBenchmarkComparison>> LoadAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var benchmarks = await BenchmarkEndpoints
            .ReadableBy(db.Benchmarks.AsNoTracking(), companyId)
            .Where(b => b.IsActive)
            // Name then Id: the list route orders by name alone, which leaves two
            // same-named benchmarks free to swap places between two generations of the
            // same report. A document that gets diffed against last month's copy must not
            // move its own rows around.
            .OrderBy(b => b.Name)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);

        var sections = new List<ReportBenchmarkComparison>(benchmarks.Count);
        foreach (var benchmark in benchmarks)
        {
            var metrics = (await BenchmarkPriorPeriod.LoadMetricsAsync(db, benchmark.Id, cancellationToken))
                .ToList();

            // `metrics` is handed over rather than re-read, exactly as LoadDetailAsync does
            // it: this benchmark's readings are already in hand, and the comparison must be
            // computed over the same list the section prints.
            var priorPeriod = await BenchmarkPriorPeriod.LoadPriorPeriodAsync(
                db,
                benchmark,
                metrics,
                priorCompanyId => BenchmarkEndpoints.CanCompanyReadBenchmark(companyId, priorCompanyId),
                cancellationToken);

            sections.Add(new ReportBenchmarkComparison(
                benchmark.Id,
                benchmark.Name,
                benchmark.Category,
                benchmark.Type,
                benchmark.CompanyId,
                benchmark.PriorPeriodStatus,
                metrics,
                priorPeriod));
        }

        return sections;
    }
}
