using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class BenchmarkEndpoints
{
    public static void MapBenchmarkEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/benchmarks").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        // Before /{id:guid}: no ordering hazard, since "prior-period" cannot satisfy the
        // :guid constraint, but keeping the literal route above the parameterised one is the
        // habit that stays correct if the constraint is ever loosened.
        group.MapPost("/prior-period/backfill", BackfillPriorPeriodsAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/metrics", AddMetricAsync);
        group.MapPut("/{id:guid}/prior-period", SetPriorPeriodAsync);
        group.MapGet("/{id:guid}/prior-period/candidates", ListPriorPeriodCandidatesAsync);
    }

    /// <summary>
    /// The Postgres advisory-lock key every writer of a prior-period link takes before it
    /// looks at the link graph.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why a lock at all.</b> <see cref="BenchmarkPriorPeriod.WouldCreateCycleAsync"/> reads
    /// committed state and then the handler writes, so two requests arriving together --
    /// A→B and B→A -- could each walk a graph in which the other's edge did not exist yet, both
    /// pass, and both commit. The refusal is the write path's job, and a check that only holds
    /// when nobody else is writing is not a check, it is a coincidence.
    /// </para>
    /// <para>
    /// <b>Why one key for the whole table rather than one per company.</b> Writing a link is a
    /// rare, deliberate administrative act on a table with a few rows per tenant; there is
    /// nothing to gain from letting two of them proceed at once, and a single key means no
    /// argument about which tenant a global benchmark belongs to. It is also the shape that
    /// stays correct when #90 adds bulk and import writers.
    /// </para>
    /// <para>
    /// <b>Why the transaction-scoped variant.</b> Same reason as
    /// <c>PostgresAdvisoryJobLease</c>: a session lock outlives the transaction, and under a
    /// pooled connection -- or Supabase's transaction pooler, which production points at --
    /// "the session" is not a thing that survives. <c>pg_advisory_xact_lock</c> is released by
    /// commit, by rollback, and by the connection dropping, with nothing to clean up. Blocking
    /// rather than <c>try</c>, because unlike a scheduled job this is somebody waiting on a
    /// button: the correct answer is "in a moment", not "no".
    /// </para>
    /// </remarks>
    public const long PriorPeriodLinkLockKey = 89_0089_0089;

    // Read access: a CompanyAdmin may view global benchmarks (CompanyId == null, visible to
    // every tenant for comparison purposes -- see ListAsync) as well as their own company's.
    private static bool CanReadBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return benchmarkCompanyId is null || currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
    }

    // Write access: a CompanyAdmin may only create/update/add-metrics-to benchmarks scoped to
    // their OWN company. Global benchmarks (CompanyId == null) are visible to every tenant
    // (CanReadBenchmark), so allowing CompanyAdmin writes there would let any tenant tamper
    // with data every other tenant sees -- global benchmarks are SuperAdmin-only to write.
    private static bool CanWriteBenchmark(CurrentUser currentUser, Guid? benchmarkCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return benchmarkCompanyId is not null && currentUser.CompanyId == benchmarkCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListAsync(Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.Benchmarks.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            query = query.Where(b => b.CompanyId == null || b.CompanyId == ownCompanyId);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(b => b.CompanyId == companyId.Value);
        }

        var benchmarks = await query
            .OrderBy(b => b.Name)
            .Select(b => new BenchmarkListItem(
                b.Id, b.Name, b.Type, b.Category, b.CompanyId, b.IsActive, b.QualityScore, b.PriorPeriodStatus))
            .ToListAsync(cancellationToken);

        return Results.Ok(benchmarks);
    }

    private static async Task<IResult> CreateAsync(CreateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanWriteBenchmark(currentUser, request.CompanyId)) return Results.Forbid();

        var name = request.Name?.Trim();
        var description = request.Description?.Trim();
        var type = request.Type?.Trim();
        var category = request.Category?.Trim();
        var source = request.Source?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description)
            || string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(category) || string.IsNullOrWhiteSpace(source))
        {
            return Results.Json(new { message = "Name, Description, Type, Category, and Source are required" }, statusCode: 400);
        }

        // A link supplied at create time goes through exactly the checks the dedicated
        // prior-period route applies. It used to be checked only for existence, which let a
        // CompanyAdmin point their new benchmark at another tenant's row, or at a benchmark
        // measuring something else entirely, purely by choosing the slower of two doors.
        // Nothing about a link is safer for having arrived with the row it belongs to.
        if (request.PriorPeriodBenchmarkId.HasValue)
        {
            var priorAtCreate = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == request.PriorPeriodBenchmarkId.Value, cancellationToken);
            var linkError = ValidateLinkTarget(
                subjectCompanyId: request.CompanyId, subjectCategory: category, subjectType: type, prior: priorAtCreate);
            if (linkError is not null) return linkError;
        }

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var benchmark = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = description,
            Type = type,
            Category = category,
            Source = source,
            Industry = request.Industry,
            CompanySize = request.CompanySize,
            Region = request.Region,
            CreatedBy = createdBy,
            CompanyId = request.CompanyId,
            IsActive = true,
            ValidationStatus = "pending",
            QualityScore = 0,
            PriorPeriodBenchmarkId = request.PriorPeriodBenchmarkId,
            // Kept in step with the pointer by the ck_benchmarks_prior_period_status check
            // constraint, which rejects the insert outright if these two disagree.
            PriorPeriodStatus = request.PriorPeriodBenchmarkId.HasValue
                ? PriorPeriodStatuses.Linked
                : PriorPeriodStatuses.Unlinked,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Benchmarks.Add(benchmark);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, benchmark.Id, currentUser, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanReadBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, currentUser, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(Guid id, UpdateBenchmarkRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var name = request.Name?.Trim();
        var description = request.Description?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description))
        {
            return Results.Json(new { message = "Name and Description are required" }, statusCode: 400);
        }

        benchmark.Name = name;
        benchmark.Description = description;
        benchmark.Industry = request.Industry;
        benchmark.CompanySize = request.CompanySize;
        benchmark.Region = request.Region;
        benchmark.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, currentUser, cancellationToken));
    }

    private static async Task<IResult> AddMetricAsync(Guid id, AddBenchmarkMetricRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var metric = new BenchmarkMetric
        {
            Id = Guid.NewGuid(),
            BenchmarkId = id,
            MetricName = request.MetricName,
            Value = request.Value,
            Unit = request.Unit,
            Percentile = request.Percentile,
            SampleSize = request.SampleSize,
        };
        db.BenchmarkMetrics.Add(metric);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, currentUser, cancellationToken), statusCode: 201);
    }

    /// <summary>
    /// Declares a benchmark's prior period, or declares that it has none.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The route #89 turns on. Before it, a link could only be set at create time, so every
    /// benchmark already in the database was unlinkable forever and
    /// <c>resultado_anio_anterior_pct</c> had nothing to resolve from -- populating it was
    /// pencilled in against the Mongo ETL (#154), which was deleted outright
    /// (<c>docs/decisions/no-data-migration.md</c>), taking the only planned backfill with
    /// it. Linking has to be an in-product action because there is no import to do it in.
    /// </para>
    /// <para>
    /// It is a PUT and not part of the benchmark PUT because the third state has no field to
    /// live in: "there is no prior period" is an answer, and an answer cannot be represented
    /// by leaving an id null in a body that also uses null for "do not change this".
    /// </para>
    /// </remarks>
    private static async Task<IResult> SetPriorPeriodAsync(
        Guid id, SetPriorPeriodRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        if (!CanWriteBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var status = request.Status?.Trim();
        if (!PriorPeriodStatuses.IsKnown(status))
        {
            return Results.Json(
                new { message = $"Status must be one of: {string.Join(", ", PriorPeriodStatuses.All)}" },
                statusCode: 400);
        }

        // Taken after the authorization and status checks -- a caller who is not allowed to
        // write, or who sent a status that is not a status, should not queue behind anybody --
        // and held until the commit below, so the cycle walk and the write it authorises are
        // one indivisible act. See PriorPeriodLinkLockKey.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})", [PriorPeriodLinkLockKey], cancellationToken);

        if (status == PriorPeriodStatuses.Linked)
        {
            if (!request.PriorPeriodBenchmarkId.HasValue)
            {
                return Results.Json(new { message = "PriorPeriodBenchmarkId is required when Status is 'linked'" }, statusCode: 400);
            }

            var priorId = request.PriorPeriodBenchmarkId.Value;
            var prior = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == priorId, cancellationToken);

            var linkError = ValidateLinkTarget(benchmark.CompanyId, benchmark.Category, benchmark.Type, prior);
            if (linkError is not null) return linkError;

            if (await BenchmarkPriorPeriod.WouldCreateCycleAsync(db, benchmark.Id, priorId, cancellationToken))
            {
                return Results.Json(new { message = "That link would make a benchmark its own prior period" }, statusCode: 400);
            }

            benchmark.PriorPeriodBenchmarkId = priorId;
        }
        else
        {
            // Both `unlinked` and `none` clear the pointer, and they are not the same act:
            // `none` records that an administrator looked and there was nothing before this,
            // `unlinked` puts the row back to nobody-has-said. The check constraint requires
            // the pointer gone either way.
            if (request.PriorPeriodBenchmarkId.HasValue)
            {
                return Results.Json(
                    new { message = $"PriorPeriodBenchmarkId must be omitted when Status is '{status}'" },
                    statusCode: 400);
            }

            benchmark.PriorPeriodBenchmarkId = null;
        }

        benchmark.PriorPeriodStatus = status!;
        benchmark.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, currentUser, cancellationToken));
    }

    /// <summary>
    /// The benchmarks that could be this one's prior period, newest first.
    /// </summary>
    /// <remarks>
    /// A suggestion route, and only that. It applies nothing; <c>Unambiguous</c> is true only
    /// when there is exactly one candidate, which is the single case a caller -- or the
    /// backfill below -- is allowed to treat as an answer rather than as a shortlist.
    /// </remarks>
    private static async Task<IResult> ListPriorPeriodCandidatesAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var benchmark = await db.Benchmarks.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
        if (benchmark is null) return Results.Json(new { message = "Benchmark not found" }, statusCode: 404);
        // Read, not write: seeing what a benchmark could be compared against reveals nothing
        // a caller who can already read the benchmark cannot read directly, and a
        // CompanyAdmin looking at a global benchmark they may not edit still benefits from
        // knowing the chain is there.
        if (!CanReadBenchmark(currentUser, benchmark.CompanyId)) return Results.Forbid();

        var candidates = await BenchmarkPriorPeriod.CandidatesQuery(db.Benchmarks, benchmark)
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => new
            {
                b.Id,
                b.Name,
                b.Category,
                b.Type,
                b.CreatedAt,
                MetricCount = db.BenchmarkMetrics.Count(m => m.BenchmarkId == b.Id),
            })
            .ToListAsync(cancellationToken);

        var unambiguous = candidates.Count == 1;
        return Results.Ok(candidates
            .Select(c => new PriorPeriodCandidateDto(c.Id, c.Name, c.Category, c.Type, c.CreatedAt, c.MetricCount, unambiguous))
            .ToList());
    }

    /// <summary>
    /// Links every benchmark in the caller's scope that has exactly one possible prior
    /// period. Reports without writing unless <paramref name="apply"/> is explicitly true.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the backfill #89 assigns to the #154 ETL plan. That plan no longer exists --
    /// the ETL was deleted and there is no legacy data to carry -- so the benchmarks needing
    /// a link are the ones this product created itself, before a link could be set after the
    /// fact. They are reachable only from inside the product, so the backfill lives here.
    /// </para>
    /// <para>
    /// <b>It refuses every judgement call.</b> A benchmark with two or more candidates is
    /// reported as <c>ambiguous</c> and left alone; one with none is reported as
    /// <c>no-candidate</c> and left alone; one already carrying any status other than
    /// <c>unlinked</c> is not considered at all, so a run cannot overwrite an administrator's
    /// answer -- including a deliberate "there is no prior period". That leaves it acting
    /// only where there is nothing to choose between, which is the narrowest reading of #89's
    /// "no incorrect automatic matches" that still does useful work.
    /// </para>
    /// <para>
    /// <b>Dry run by default.</b> <c>apply</c> must be sent as true. A backfill whose default
    /// is to write is one that gets run once to see what it would do.
    /// </para>
    /// </remarks>
    private static async Task<IResult> BackfillPriorPeriodsAsync(
        bool? apply, Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        // The same lock the single-link route takes, for the same reason and against the same
        // hazard: this run reads every candidate graph it is about to write into. A dry run
        // takes it too -- it is reporting what it WOULD write, and a report computed against a
        // graph somebody is halfway through changing is the thing an administrator then
        // approves.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})", [PriorPeriodLinkLockKey], cancellationToken);

        var scope = db.Benchmarks.AsQueryable();
        if (currentUser.Role == Roles.SuperAdmin)
        {
            if (companyId.HasValue) scope = scope.Where(b => b.CompanyId == companyId.Value);
        }
        else
        {
            // A CompanyAdmin's own company only -- never the global rows they can read.
            // CanWriteBenchmark says a CompanyAdmin may not write a benchmark with a null
            // company, and a bulk path that quietly widened that is the exact hole #84
            // closed on create.
            var ownCompanyId = Guid.Parse(currentUser.CompanyId);
            scope = scope.Where(b => b.CompanyId == ownCompanyId);
        }

        var subjects = await scope
            .Where(b => b.PriorPeriodStatus == PriorPeriodStatuses.Unlinked)
            .OrderBy(b => b.CreatedAt)
            .ToListAsync(cancellationToken);

        var decisions = new List<PriorPeriodBackfillDecision>(subjects.Count);
        var linked = 0;
        var ambiguous = 0;
        var noCandidate = 0;

        foreach (var subject in subjects)
        {
            var candidates = await BenchmarkPriorPeriod.CandidatesQuery(db.Benchmarks, subject)
                .OrderByDescending(b => b.CreatedAt)
                .Select(b => b.Id)
                .ToListAsync(cancellationToken);

            if (candidates.Count == 0)
            {
                noCandidate++;
                decisions.Add(new PriorPeriodBackfillDecision(subject.Id, subject.Name, "no-candidate", null, 0));
                continue;
            }

            if (candidates.Count > 1)
            {
                ambiguous++;
                decisions.Add(new PriorPeriodBackfillDecision(subject.Id, subject.Name, "ambiguous", null, candidates.Count));
                continue;
            }

            var priorId = candidates[0];
            if (await BenchmarkPriorPeriod.WouldCreateCycleAsync(db, subject.Id, priorId, cancellationToken))
            {
                ambiguous++;
                decisions.Add(new PriorPeriodBackfillDecision(subject.Id, subject.Name, "ambiguous", null, candidates.Count));
                continue;
            }

            linked++;
            decisions.Add(new PriorPeriodBackfillDecision(subject.Id, subject.Name, "linked", priorId, 1));

            if (apply == true)
            {
                subject.PriorPeriodBenchmarkId = priorId;
                subject.PriorPeriodStatus = PriorPeriodStatuses.Linked;
                subject.UpdatedAt = DateTimeOffset.UtcNow;
            }
        }

        if (apply == true) await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return Results.Ok(new PriorPeriodBackfillResult(
            Applied: apply == true,
            Considered: subjects.Count,
            Linked: linked,
            Ambiguous: ambiguous,
            NoCandidate: noCandidate,
            Decisions: decisions));
    }

    /// <summary>
    /// The things that make a proposed prior period the wrong benchmark, whichever route
    /// proposed it. See <see cref="BenchmarkPriorPeriod.CandidatesQuery"/> for why each one is
    /// here; this is the write-side half of the same rule.
    /// </summary>
    /// <param name="prior">
    /// The proposed row, or null when no benchmark carries that id. Null is handled here and
    /// not by the callers because the answer has to be the same either way -- see below.
    /// </param>
    /// <remarks>
    /// <para>
    /// <b>"Not a benchmark" and "not one of yours" are one answer.</b> They used to be two
    /// different messages, which made the route an existence oracle: a CompanyAdmin who put an
    /// arbitrary GUID in the body learned from the wording alone whether it was a benchmark
    /// somewhere in the platform. That is not much on its own, and it is exactly what an
    /// attacker with a handful of ids does first. The scope check already declines to
    /// distinguish another tenant's row from a global one, for the same reason; a row that is
    /// not there at all belongs in the same bucket.
    /// </para>
    /// <para>
    /// <b>What is deliberately NOT checked: that the prior period is older.</b>
    /// <see cref="BenchmarkPriorPeriod.CandidatesQuery"/> requires
    /// <c>CreatedAt &lt; subject.CreatedAt</c> and this does not, and the asymmetry is the
    /// whole decision (<c>docs/decisions/prior-period-benchmark-linkage.md</c>) rather than an
    /// oversight. A benchmark has no period field; <c>CreatedAt</c> records when somebody
    /// typed the row in, which is a usable hint for a SHORTLIST and a falsehood as a rule.
    /// Entering 2024's figures after 2025's are already in is ordinary, and it makes the 2024
    /// row the younger of the two. Enforcing the ordering here would refuse the one case the
    /// explicit mechanism exists to serve -- an administrator who knows which year is which
    /// saying so -- and would refuse it with a message about creation timestamps that no
    /// reader can act on. A period that precedes itself is still refused, by
    /// <see cref="BenchmarkPriorPeriod.WouldCreateCycleAsync"/>, which asks about the link
    /// graph rather than about the clock.
    /// </para>
    /// </remarks>
    private static IResult? ValidateLinkTarget(Guid? subjectCompanyId, string subjectCategory, string subjectType, Benchmark? prior)
    {
        if (prior is null || prior.CompanyId != subjectCompanyId)
        {
            // Deliberately the same message for "no such benchmark", "another tenant's
            // benchmark" and "a global benchmark": a CompanyAdmin probing ids must not learn
            // which of the three an unknown id is.
            return Results.Json(
                new { message = "A prior period must be an existing benchmark in the same company scope as the benchmark" },
                statusCode: 400);
        }

        if (!string.Equals(prior.Category, subjectCategory, StringComparison.Ordinal)
            || !string.Equals(prior.Type, subjectType, StringComparison.Ordinal))
        {
            return Results.Json(
                new { message = "A prior period must have the same category and type as the benchmark" },
                statusCode: 400);
        }

        return null;
    }

    // PersonaExternalId first, then Id -- see ActingUserResolver for why the order is
    // load-bearing. The Guid.Empty fallback for an unresolvable caller is pre-existing
    // behaviour, deliberately left alone by #285: `benchmarks.created_by` is a required FK
    // to `users` (BenchmarkConfiguration), so it fails the insert rather than filing the row
    // against a real account.
    private static async Task<Guid> ResolveCurrentUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty;

    private static async Task<BenchmarkDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var b = await db.Benchmarks.FirstAsync(x => x.Id == id, cancellationToken);
        var metrics = await db.BenchmarkMetrics
            .Where(m => m.BenchmarkId == id)
            // Ordered so the same benchmark reads the same way twice; see
            // BenchmarkPriorPeriod.LoadMetricsAsync for why an unordered projection is worse
            // than untidy once these values are being differenced.
            .OrderBy(m => m.MetricName).ThenBy(m => m.Id)
            .Select(m => new BenchmarkMetricDto(m.Id, m.MetricName, m.Value, m.Unit, m.Percentile, m.SampleSize))
            .ToListAsync(cancellationToken);

        // `metrics` is handed over rather than re-read: this benchmark's readings are already
        // in hand and LoadPriorPeriodAsync would otherwise issue the identical query, with the
        // identical ORDER BY, on every read of a linked benchmark.
        var priorPeriod = await BenchmarkPriorPeriod.LoadPriorPeriodAsync(
            db, b, metrics, companyId => CanReadBenchmark(currentUser, companyId), cancellationToken);

        // The POINTER is withheld on the same terms as the comparison it points at. Omitting
        // the rich DTO while returning the id kept the promise only in the part a reader would
        // notice: the id is the thing that says "a benchmark with this id exists in a tenant
        // you cannot see", it turns an unguessable GUID into a known one, and the browser then
        // spends a doomed cross-tenant request on it in followPriorPeriodChain. `linked` with
        // nothing attached is still distinguishable from `unlinked` -- that is what
        // PriorPeriodStatus is for, and it is a fact about this row rather than about another
        // tenant's.
        var visiblePriorPeriodId = priorPeriod?.Id;

        return new BenchmarkDetail(
            b.Id, b.Name, b.Description, b.Type, b.Category, b.Source, b.Industry, b.CompanySize,
            b.Region, b.CompanyId, b.IsActive, b.ValidationStatus, b.QualityScore, visiblePriorPeriodId, metrics,
            b.PriorPeriodStatus, priorPeriod);
    }
}
