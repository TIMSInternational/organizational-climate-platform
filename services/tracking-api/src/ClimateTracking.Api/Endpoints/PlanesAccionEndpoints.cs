using System.Security.Claims;
using ClimateTracking.Application.Auth;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Application.PlanesAccion;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Api.Endpoints;

public static class PlanesAccionEndpoints
{
    public static void MapPlanesAccionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/planes-accion").RequireAuthorization();

        group.MapPost("/", CreateAsync);
        group.MapGet("/", ListAsync);
        group.MapGet("/{id:guid}", GetByIdAsync);
        group.MapPost("/{id:guid}/avance", RegistrarAvanceAsync);
        group.MapPost("/{id:guid}/cumplir", MarcarCumplidoAsync);
        group.MapPost("/{id:guid}/involucrados", AgregarInvolucradoAsync);
    }

    private static async Task<IResult> CreateAsync(
        CreatePlanRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IClimateProjectClient climateProjectClient,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();
        if (!Roles.PlanCreator.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        // A leader can only create plans for their own node — without this check, any
        // leader could create (and assign) plans on a node they have no authority over.
        var isAdmin = Roles.Admin.Contains(currentUser.Role);
        if (!isAdmin && currentUser.NodoExternalId != request.NodoExternalId)
        {
            return Results.Forbid();
        }

        var nodo = await db.Nodos.FirstOrDefaultAsync(n => n.ExternalId == request.NodoExternalId, cancellationToken);
        if (nodo is null)
        {
            return Results.BadRequest(new { error = $"Nodo '{request.NodoExternalId}' not found in cache." });
        }

        string? cicloExternalId = null;
        if (request.HallazgoExternalId is not null)
        {
            // Enrichment only, not required for plan creation to succeed: if climate-project
            // is briefly unreachable (retries exhausted, or the Polly circuit breaker is open),
            // fall back to no cicloExternalId rather than failing the whole request with a 500.
            try
            {
                var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
                cicloExternalId = hallazgo?.CicloId;
            }
            // Catch everything the lookup can throw, not just connection/5xx failures:
            // ClimateProjectClient.GetAsync does `ReadFromJsonAsync<T>(...)!` and this method
            // immediately dereferences envelope.Data.Hallazgos, so a reachable-but-misbehaving
            // climate-project can throw well past HttpRequestException/BrokenCircuitException —
            // a 200 whose body omits "data" throws NullReferenceException, a non-JSON response
            // (e.g. a proxy/HTML interstitial) throws NotSupportedException, and a truncated
            // body throws JsonException. cicloExternalId is enrichment only, so none of these
            // should turn into a 500 for plan creation.
            // The one exception we let through is a genuine caller-initiated cancellation
            // (client disconnect): OperationCanceledException/TaskCanceledException raised
            // because cancellationToken itself was signaled must still propagate instead of
            // being swallowed here — HttpClient's own request-timeout TaskCanceledException
            // (token not signaled) is still caught like any other lookup failure.
            catch (Exception ex) when (
                !(ex is OperationCanceledException && cancellationToken.IsCancellationRequested))
            {
                logger.LogError(
                    ex, "Hallazgo lookup failed for {HallazgoExternalId}; creating plan without cicloExternalId",
                    request.HallazgoExternalId);
            }
        }

        var fechaCreacion = DateOnly.FromDateTime(DateTime.UtcNow);
        var plan = new PlanDeAccion
        {
            // Sequential per-year numbering is generated from a Postgres sequence
            // (GeneratePlanCodeAsync) precisely to avoid the race window a naive
            // COUNT(*)-based approach would have under concurrent creates.
            PlanCode = await GeneratePlanCodeAsync(db, cancellationToken),
            NodoExternalId = request.NodoExternalId,
            LiderExternalId = nodo.LiderExternalId,
            HallazgoExternalId = request.HallazgoExternalId,
            DescripcionQue = request.DescripcionQue,
            MetodologiaComo = request.MetodologiaComo,
            ResponsableEjecucionExternalId = request.ResponsableEjecucionExternalId,
            FechaCreacion = fechaCreacion,
            FechaCompromiso = request.FechaCompromiso,
            CicloEncuestaExternalId = cicloExternalId,
        };

        foreach (var involucrado in request.Involucrados ?? [])
        {
            plan.AgregarInvolucrado(involucrado);
        }

        // FechaUltimaActualizacion has no public setter — RegistrarAvance is the domain's
        // only way to initialize it (and it also runs the initial semaforo calculation).
        var config = await db.SemaforoThresholdConfigs.SingleAsync(
            c => c.Id == SemaforoThresholdConfig.DefaultConfigId, cancellationToken);
        plan.RegistrarAvance(0m, currentUser.PersonaExternalId, "Plan creado", fechaCreacion, config);

        db.PlanesDeAccion.Add(plan);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/planes-accion/{plan.Id}", PlanResponse.From(plan));
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        string? nodoId,
        string? estado,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();

        var plans = await Visible(db.PlanesDeAccion, currentUser, nodoId, estado).ToListAsync(cancellationToken);
        return Results.Ok(plans.Select(PlanResponse.From));
    }

    /// <summary>
    /// The plans <paramref name="currentUser"/> is allowed to see, narrowed by the optional
    /// nodo and estado filters.
    /// </summary>
    /// <remarks>
    /// Shared with the Excel export (<see cref="TrackingSheetExportEndpoints"/>) rather than
    /// restated there: a caller must never be able to read through a spreadsheet a row that the
    /// list endpoint would have withheld, and the cheapest way to guarantee that is for both to
    /// be the same predicate.
    /// </remarks>
    internal static IQueryable<PlanDeAccion> Visible(
        IQueryable<PlanDeAccion> query, CurrentUser currentUser, string? nodoId, string? estado)
    {
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            // InvolucradosExternalIds is Ignore()'d in EF config (it's a read-only wrapper
            // over the private "_involucradosExternalIds" field, which is what's actually
            // mapped) — querying the wrapper isn't translatable, so go through EF.Property.
            query = query.Where(p =>
                p.NodoExternalId == currentUser.NodoExternalId ||
                p.ResponsableEjecucionExternalId == currentUser.PersonaExternalId ||
                EF.Property<List<string>>(p, "_involucradosExternalIds").Contains(currentUser.PersonaExternalId));
        }

        if (!string.IsNullOrEmpty(nodoId))
        {
            query = query.Where(p => p.NodoExternalId == nodoId);
        }

        if (!string.IsNullOrEmpty(estado) && Enum.TryParse<Domain.Enums.EstadoSemaforo>(estado, true, out var parsedEstado))
        {
            query = query.Where(p => p.EstadoSemaforo == parsedEstado);
        }

        return query;
    }

    private static async Task<IResult> GetByIdAsync(
        Guid id,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Read));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> RegistrarAvanceAsync(
        Guid id,
        RegistrarAvanceRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        var config = await db.SemaforoThresholdConfigs.SingleAsync(
            c => c.Id == SemaforoThresholdConfig.DefaultConfigId, cancellationToken);

        var currentUser = user.GetCurrentUser();
        try
        {
            plan.RegistrarAvance(request.PorcentajeAvance, currentUser.PersonaExternalId, request.Comentario, request.Fecha, config);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> MarcarCumplidoAsync(
        Guid id,
        MarcarCumplidoRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        var currentUser = user.GetCurrentUser();
        plan.MarcarCumplido(request.Fecha, currentUser.PersonaExternalId);

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> AgregarInvolucradoAsync(
        Guid id,
        AgregarInvolucradoRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        plan.AgregarInvolucrado(request.PersonaExternalId);

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    /// <summary>
    /// The advisory-lock key every request takes before it may create or seed a year's plan-code
    /// sequence. The year is added so two years' first requests never queue behind each other.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The race this closes.</b> The previous implementation used the error from a bare
    /// <c>CREATE SEQUENCE</c> as its "did I create this?" signal, and only the winner seeded the
    /// sequence with <c>setval(max(existing suffix))</c>. Every loser skipped the seeding block
    /// and called <c>nextval()</c> immediately -- so the winner's <c>setval</c> could land AFTER
    /// losers had already consumed 1..N and committed plans with those codes, REWINDING the
    /// sequence underneath them. The next <c>nextval()</c> then reissued a code that already
    /// existed and Postgres refused the insert: <c>23505 duplicate key value violates unique
    /// constraint "IX_planes_de_accion_PlanCode"</c>, surfacing to the caller as a 500.
    /// <c>PlanCodeConcurrencyTests.Concurrent_plan_creation_never_produces_duplicate_plan_codes</c>
    /// is the test written to catch exactly this; it caught it on CI on 2026-09-03.
    /// </para>
    /// <para>
    /// <b>Why the lock rather than a cleverer sequence dance.</b> Creating the sequence and
    /// seeding it are two statements that must be one act with respect to every other request's
    /// <c>nextval()</c>. Nothing in Postgres makes that atomic on its own, because
    /// <c>nextval</c> deliberately ignores transactions. Serialising the create-and-seed is the
    /// whole fix, and it costs one lock acquisition on the first request of a year; every
    /// request after that finds the sequence present and does no work inside the lock.
    /// </para>
    /// <para>
    /// <b>Why the transaction-scoped variant.</b> Same reason as
    /// <c>BenchmarkEndpoints.PriorPeriodLinkLockKey</c>: a session lock outlives the
    /// transaction, and under a pooled connection "the session" is not a thing that survives.
    /// <c>pg_advisory_xact_lock</c> is released by commit, by rollback, and by the connection
    /// dropping, with nothing to clean up. Blocking rather than <c>try</c>, because this is
    /// somebody waiting on a button: the right answer is "in a moment", not "no".
    /// </para>
    /// </remarks>
    private const long PlanCodeSequenceLockKeyBase = 71_0071_0000;

    private static async Task<string> GeneratePlanCodeAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        // Sequence name is built from a server-side int (DateTime.UtcNow.Year), never
        // user input -- safe to interpolate directly; Postgres identifiers can't be
        // bound as query parameters anyway. Created lazily on first use per year rather
        // than pre-migrated, since future years aren't known in advance.
        var sequenceName = $"plan_code_seq_{year}";
        var prefix = $"PA-{year}-";

#pragma warning disable EF1002
        // Everything that can create or move the sequence happens under the lock, so a
        // concurrent caller either does the work or waits for whoever is doing it -- and by
        // the time it proceeds the sequence exists AND has been seeded. `nextval` itself is
        // atomic and is deliberately left outside.
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0})",
                [PlanCodeSequenceLockKeyBase + year],
                cancellationToken);

            // Under the lock this read is trustworthy, which is what lets the whole
            // CREATE-SEQUENCE-error-as-a-signal dance go away: nobody else can be creating it
            // between this check and the CREATE below.
            var exists = await db.Database
                .SqlQueryRaw<bool>($"SELECT to_regclass('{sequenceName}') IS NOT NULL AS \"Value\"")
                .SingleAsync(cancellationToken);

            if (!exists)
            {
                await db.Database.ExecuteSqlRawAsync($"CREATE SEQUENCE {sequenceName}", cancellationToken);

                // A brand-new sequence starts at 1, but this database may already hold plans
                // for this year created before it existed (the old COUNT(*)-based scheme, a
                // prior deploy, or a restore from an environment that already has data). Seed
                // from the highest existing suffix so nextval() cannot collide with one.
                //
                // The suffix-is-all-digits check guards a legacy or malformed PlanCode that
                // matches the '{prefix}%' filter but is not purely numeric after the prefix --
                // without it CAST(... AS bigint) would throw for that row rather than simply
                // being excluded from the max.
                var maxExisting = await db.Database.SqlQueryRaw<long>(
                    $"""
                    SELECT COALESCE(MAX(CAST(SUBSTRING("PlanCode" FROM {prefix.Length + 1}) AS bigint)), 0) AS "Value"
                    FROM planes_de_accion
                    WHERE "PlanCode" LIKE '{prefix}%'
                      AND SUBSTRING("PlanCode" FROM {prefix.Length + 1}) ~ '^[0-9]+$'
                    """).SingleAsync(cancellationToken);

                if (maxExisting > 0)
                {
                    await db.Database.ExecuteSqlRawAsync(
                        $"SELECT setval('{sequenceName}', {maxExisting})",
                        cancellationToken);
                }
            }

            // Commit releases the advisory lock and makes the CREATE visible. DDL is
            // transactional in Postgres, so a rollback here takes the sequence with it and
            // the next request simply creates it again.
            await transaction.CommitAsync(cancellationToken);
        }

        // EF Core's scalar SqlQueryRaw<T> wraps the raw SQL as
        // `SELECT s."Value" FROM (<sql>) AS s`, so the inner query's column must be
        // aliased "Value" -- nextval(...) alone produces a column literally named
        // "nextval", which makes Postgres raise 42703 (column s.Value does not exist).
        var nextVal = await db.Database.SqlQueryRaw<long>($"SELECT nextval('{sequenceName}') AS \"Value\"").SingleAsync(cancellationToken);
#pragma warning restore EF1002
        return $"PA-{year}-{nextVal:D5}";
    }
}
