using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

// Contract: every `company_id` query param below must be a climate-project `Company` GUID
// (Departments.CompanyId / Users.CompanyId), never a legacy/free-form identifier.
//
// /nodos, /personas, /ciclos-encuesta and /hallazgos validate `company_id` and 400 on a
// non-GUID value.
//
// **/ciclos-encuesta and /hallazgos joined that list with #385, deliberately, and the
// argument that kept them out until now is worth preserving rather than deleting.** They
// were stubs (the surveys domain, #51, did not exist), and the plan's Task 3 Step 2 made
// their bodies unconditional empty responses on purpose: a misconfigured caller should
// degrade gracefully on a route that could not answer anyway. That mattered because
// climate-tracking's `ClimateProjectClientOptions.ProcomerCompanyId` is an unconstrained
// `required string` defaulting to `""` in both services' appsettings.json, and
// `ClimateProjectClient` calls `response.EnsureSuccessStatusCode()` -- so validating would
// have thrown in a deployment that had no real company_id to give yet. A prior pass added
// the validation anyway to "close a drift", which was an unrequested contract change and
// was correctly reverted.
//
// What changed is not the taste, it is the fact: these two routes now return real survey
// data, and their empty response is no longer indistinguishable from a correct one. A blank
// ProcomerCompanyId now means the tracking module publishes an export whose "Hallazgo" column
// silently falls back to raw ids -- exactly the client-visible defect #385 exists to close --
// and a 200 with an empty list is the shape that hid it. Failing loudly on a misconfigured
// tenant key is now the safer failure, so both adopt TryParseCompanyId, as their own stub
// comments asked whoever implemented #51 to do.
//
// /send-notification remains a stub (notifications, #55) and still does NOT validate: the
// paragraph above still applies to it verbatim, because a no-op notification send tells a
// misconfigured caller nothing either way.
public static class TrackingInternalEndpoints
{
    /// <summary>
    /// The path prefix every route in this file hangs off. Shared with
    /// <see cref="RateLimitPolicies.PartitionGlobal"/>, which gives this surface its own
    /// ceiling because it is machine traffic gated by <see cref="InternalApiKeyFilter"/>
    /// rather than by a JWT -- a literal in both places would let the two drift silently.
    /// </summary>
    internal const string GroupPrefix = "/api/internal";

    /// <summary>
    /// The most surveys <c>/hallazgos</c> will aggregate for one request.
    ///
    /// Each one costs a full <see cref="SurveyAggregateLoader"/> pass -- every answer of
    /// every completed response -- so an unbounded scan of a company's whole survey history
    /// is an unbounded request. With a <c>ciclo_id</c> this never binds (one survey); it is
    /// the ceiling on the <c>hallazgo_id</c>-only path, which cannot narrow by query because
    /// the id is a hash (see <see cref="TrackingIdentifiers.ExternalHallazgoId"/>).
    ///
    /// Deliberately NOT bound to <see cref="SurveyClimateTrendsEndpoints.MaxSurveys"/>, which
    /// happens to be the same number today for the same cost reason. That one is a display
    /// window a product decision may widen or narrow; tuning it must not silently change how
    /// far back an action plan can resolve the finding it was written against.
    ///
    /// <c>internal</c> so the integration fixture can seed exactly enough of a rival tenant's
    /// history to fill this window. A copy of the literal 12 in the test would keep passing
    /// after this number was raised, while quietly no longer proving the thing it was written
    /// for -- which is how a test rots into a weaker test without ever going red.
    /// </summary>
    internal const int MaxSurveysAggregated = 12;

    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static void MapTrackingInternalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup(GroupPrefix).AddEndpointFilter<InternalApiKeyFilter>();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
        group.MapGet("/ciclos-encuesta", ListCiclosAsync);
        group.MapGet("/hallazgos", ListHallazgosAsync);
        group.MapPost("/send-notification", SendNotificationAsync);
    }

    private static async Task<IResult> ListNodosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!TryParseCompanyId(companyId, out var companyGuid, out var error))
        {
            return error;
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var departmentsById = departments.ToDictionary(d => d.Id);
        var managerIds = departments.Where(d => d.ManagerId.HasValue).Select(d => d.ManagerId!.Value).ToList();
        var managers = await db.Users
            .Where(u => managerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        // Headcount is COUNTED, not read from `departments.employee_count`. Nothing in this
        // codebase has ever written that column, so this feed reported
        // `cantidad_colaboradores: 0` for every nodo it has ever published -- to an EXTERNAL
        // consumer, which had no way to tell a genuinely empty team from the column never
        // having been maintained. One grouped query rather than a count per department, so
        // the shape of this endpoint's database work does not change with the org chart.
        //
        // The population is `DepartmentHeadcount.Population` -- active members only -- not a
        // predicate written out here. This line used to carry a byte-identical hand-written
        // copy of that predicate, which is exactly the state that let the product's own
        // surfaces drift apart before #310; the feed now publishes the same number the
        // Departments page prints as EMPLOYEES ASSIGNED and the results screens divide by,
        // by construction. Pinned by `Returns_nodos_with_snake_case_envelope_shape`, whose
        // fixture seeds a deactivated member that must not be counted.
        var activeUsersByDepartment = await DepartmentHeadcount
            .Population(db.Users, companyGuid)
            .GroupBy(u => u.DepartmentId!.Value)
            .Select(g => new { DepartmentId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.DepartmentId, x => x.Count, cancellationToken);

        var nodos = departments.Select(d => new NodoInternalDto(
            NodoId: TrackingIdentifiers.ExternalNodoId(d),
            Nombre: d.Name,
            NodoPadreId: d.ParentDepartmentId.HasValue && departmentsById.TryGetValue(d.ParentDepartmentId.Value, out var parent)
                ? TrackingIdentifiers.ExternalNodoId(parent)
                : null,
            LiderId: d.ManagerId.HasValue && managers.TryGetValue(d.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            CantidadColaboradores: activeUsersByDepartment.TryGetValue(d.Id, out var headcount) ? headcount : 0,
            Activo: d.IsActive,
            CompanyId: d.CompanyId.ToString()))
            .ToList();

        // Plain /auth/signup and Google login never set User.DepartmentId (only bulk-import,
        // admin user-create/invitation flows do), so most companies have at least some users
        // with no department. /personas resolves those users' nodo_id to
        // TrackingIdentifiers.UnassignedNodoId(companyId) -- surface that synthetic nodo here
        // too (only when it's actually in use) so it always resolves to a real entry in this
        // response, exactly like every other nodo_id /personas can emit.
        //
        // Counted active or not, unlike the department headcounts above, and deliberately so:
        // /personas emits every user row of the company, deactivated ones included (with
        // `activo: false`), so this nodo must exist for exactly the rows that will reference
        // it. An active-only count would read 0 for a company whose only department-less
        // users are deactivated, drop the nodo, and leave those personas pointing at a
        // nodo_id absent from this response. Not a department headcount -- it is the
        // complement of `DepartmentHeadcount.Population`'s department predicate.
        var unassignedUserCount = await db.Users
            .CountAsync(u => u.CompanyId == companyGuid && u.DepartmentId == null, cancellationToken);
        if (unassignedUserCount > 0)
        {
            nodos.Add(new NodoInternalDto(
                NodoId: TrackingIdentifiers.UnassignedNodoId(companyGuid),
                Nombre: "Sin nodo asignado",
                NodoPadreId: null,
                LiderId: null,
                CantidadColaboradores: unassignedUserCount,
                Activo: true,
                CompanyId: companyGuid.ToString()));
        }

        return Results.Json(new Envelope<NodosData>(true, new NodosData(nodos)), SnakeCaseOptions);
    }

    private static async Task<IResult> ListPersonasAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!TryParseCompanyId(companyId, out var companyGuid, out var error))
        {
            return error;
        }

        var users = await db.Users
            .Where(u => u.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var usersById = users.ToDictionary(u => u.Id);

        // The real user->department link is User.DepartmentId. The User.NodoId column this
        // used to be tempting to read was never written by any code path and has now been
        // dropped outright (#151). Resolve nodo_id via the department the user belongs to,
        // using the same TrackingIdentifiers convention the /nodos endpoint uses, so a
        // persona's nodo_id always joins to a nodo_id present in that endpoint's response.
        // Users with no DepartmentId (the common case for plain /auth/signup and Google
        // login, which never set it) fall back to a deterministic per-company synthetic
        // nodo_id, rather than an empty string: climate-tracking's PersonaDto.NodoId is
        // non-nullable and used for tablero authorization scoping, so it must never be empty.
        //
        // The call below is deliberately TrackingIdentifiers.NodoIdForUser rather than an
        // inline conditional: the nodoId JWT claim is minted from the very same method (via
        // NodoClaimResolver), and climate-tracking compares the two against each other --
        // its persona cache is filled from this endpoint while its authorization reads the
        // claim. Sharing one method is what makes that comparison sound; two copies of the
        // same conditional is exactly how they drifted apart in the first place.
        var departmentIds = users
            .Where(u => u.DepartmentId.HasValue)
            .Select(u => u.DepartmentId!.Value)
            .Distinct()
            .ToList();
        var departmentsById = await db.Departments
            .Where(d => departmentIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, cancellationToken);

        var personas = users.Select(u => new PersonaInternalDto(
            PersonaId: TrackingIdentifiers.ExternalPersonaId(u),
            NombreCompleto: u.Name,
            Correo: u.Email,
            NodoId: TrackingIdentifiers.NodoIdForUser(
                u.DepartmentId.HasValue && departmentsById.TryGetValue(u.DepartmentId.Value, out var department) ? department : null,
                companyGuid),
            ManagerId: u.ManagerId.HasValue && usersById.TryGetValue(u.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            Rol: u.Role,
            Activo: u.IsActive,
            // companyGuid, not u.CompanyId. Since #191 User.CompanyId is nullable, and
            // `u.CompanyId?.ToString() ?? ""` would emit an empty company_id -- which
            // climate-tracking's MatchingTenantHandler compares verbatim against its
            // configured ExpectedCompanyId, so a blank value is a broken tenant key, not a
            // harmless one. It cannot arise anyway: the Where above filters on
            // `u.CompanyId == companyGuid`, which excludes NULL, so every row here provably
            // belongs to companyGuid. Company-less super_admins are therefore absent from
            // the persona sync entirely -- correct, they are platform operators, not survey
            // participants of any tenant.
            CompanyId: companyGuid.ToString()))
            .ToList();

        return Results.Json(new Envelope<PersonasData>(true, new PersonasData(personas)), SnakeCaseOptions);
    }

    /// <summary>
    /// A ciclo de encuesta IS a <c>Survey</c> (#385, closing the #51 dependency). One row
    /// per survey the company has actually run.
    ///
    /// **Drafts are excluded.** A draft has never been shown to anyone, its window and its
    /// content are still being edited, and publishing it to an external system would
    /// advertise an unfinished instrument as a survey cycle that exists.
    ///
    /// Every other status is published, because climate-tracking wants the open ones too:
    /// its <c>CacheSyncWorker</c> maps <c>estado</c> onto its two-valued
    /// <c>EstadoCicloEncuesta</c>, and its <c>FechaApertura</c>/<c>FechaCierre</c> are
    /// non-nullable <c>DateOnly</c> columns -- which <c>Survey.StartDate</c>/<c>EndDate</c>
    /// satisfy by being non-nullable here too.
    /// </summary>
    private static async Task<IResult> ListCiclosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!TryParseCompanyId(companyId, out var companyGuid, out var error))
        {
            return error;
        }

        var rows = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == companyGuid && s.Status != SurveyStatuses.Draft)
            .OrderByDescending(s => s.EndDate)
            .ThenByDescending(s => s.Id)
            .Select(s => new
            {
                s.Id,
                s.StartDate,
                s.EndDate,
                s.Status,
                NumeroPreguntas = db.Questions.Count(q => q.SurveyId == s.Id),
            })
            .ToListAsync(cancellationToken);

        var ciclos = rows.Select(s => new CicloInternalDto(
            CicloId: s.Id.ToString(),
            FechaApertura: s.StartDate,
            FechaCierre: s.EndDate,
            NumeroPreguntas: s.NumeroPreguntas,
            Estado: CicloEstado(s.Status),
            CompanyId: companyGuid.ToString()))
            .ToList();

        return Results.Json(new Envelope<CiclosData>(true, new CiclosData(ciclos)), SnakeCaseOptions);
    }

    /// <summary>
    /// A hallazgo is one (department x dimension) score of one closed survey. The mapping,
    /// the anonymity ruling and the id derivation all live in
    /// <see cref="TrackingHallazgos"/> and <see cref="TrackingIdentifiers.ExternalHallazgoId"/>;
    /// this method's job is to decide WHICH surveys to aggregate and to apply the filters.
    ///
    /// **Both filters are honoured, and that is the point of the route.** The legacy Next.js
    /// <c>/internal/hallazgos</c> accepted <c>ciclo_id</c> and silently ignored it -- a filter
    /// accepted and ignored is worse than one rejected, because the caller reads the
    /// unfiltered answer as the filtered one. <c>ciclo_id</c> narrows to a single survey
    /// before any aggregation runs (so the export's per-ciclo lookup costs one aggregation,
    /// not twelve), and <c>hallazgo_id</c> filters the computed set.
    ///
    /// **Why <c>hallazgo_id</c> filters after the fact rather than before.** The id is a hash
    /// of (survey, department, dimension) -- see
    /// <see cref="TrackingIdentifiers.ExternalHallazgoId"/> for why it has to be -- so it
    /// cannot be inverted into a query. <c>GetHallazgoByIdAsync</c>, the caller that passes
    /// it alone, runs at plan-creation time against a finding the user just picked, so the
    /// surveys it needs are the recent ones; <see cref="MaxSurveysAggregated"/> bounds the
    /// scan.
    ///
    /// **An unknown <c>ciclo_id</c> is an empty 200, not a 400** -- unlike a malformed
    /// <c>company_id</c>. company_id is this endpoint's tenant key and a caller sending a
    /// non-GUID one is misconfigured; ciclo_id is a reference to a row that may legitimately
    /// not exist (a survey deleted, or a plan carrying a ciclo from another deployment), and
    /// "no findings for that cycle" is the true answer rather than a caller error.
    /// </summary>
    private static async Task<IResult> ListHallazgosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        [FromQuery(Name = "ciclo_id")] string? cicloId,
        [FromQuery(Name = "hallazgo_id")] string? hallazgoId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!TryParseCompanyId(companyId, out var companyGuid, out var error))
        {
            return error;
        }

        // Closed and archived only. An active survey's scores move under the reader between
        // two loads, and a plan de accion is a commitment written against one finding on one
        // day -- the same argument the leader dashboard's team-climate panel makes for
        // reading the last CLOSED survey rather than the live one.
        var surveys = db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == companyGuid
                        && (s.Status == SurveyStatuses.Closed || s.Status == SurveyStatuses.Archived));

        if (!string.IsNullOrWhiteSpace(cicloId))
        {
            if (!Guid.TryParse(cicloId, out var cicloGuid))
            {
                return EmptyHallazgos();
            }

            surveys = surveys.Where(s => s.Id == cicloGuid);
        }

        var candidates = await surveys
            .OrderByDescending(s => s.EndDate)
            .ThenByDescending(s => s.Id)
            .Take(MaxSurveysAggregated)
            .ToListAsync(cancellationToken);

        if (candidates.Count == 0)
        {
            return EmptyHallazgos();
        }

        // Loaded once for the whole request, not per survey: nodo_id is a property of the
        // department, and the same departments answer every survey of the company.
        var departments = await db.Departments
            .AsNoTracking()
            .Where(d => d.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);
        var nodoIdByDepartmentId = departments.ToDictionary(d => d.Id, TrackingIdentifiers.ExternalNodoId);

        var hallazgos = new List<HallazgoInternalDto>();
        foreach (var survey in candidates)
        {
            // Sequential, for the reason the climate-trends route gives: a DbContext is not
            // thread-safe, and N is capped.
            //
            // The locale is the survey's own. Nothing in a hallazgo is localised --
            // `Question.Category`, which names the dimension, is a single unlocalised column
            // -- so the resolver's answer cannot reach the response; it is required only
            // because the shared loader resolves question text on the way through. The
            // fallback fields it collects are for an author editing one survey and mean
            // nothing here.
            var locale = SurveyContent.ResolveRequestLocale(null, survey.Language);
            var aggregate = await SurveyAggregateLoader.ComputeAsync(
                db, survey, locale, [], cancellationToken);

            hallazgos.AddRange(TrackingHallazgos.ForSurvey(survey.Id, aggregate, nodoIdByDepartmentId));
        }

        if (!string.IsNullOrWhiteSpace(hallazgoId))
        {
            hallazgos = hallazgos
                .Where(h => string.Equals(h.HallazgoId, hallazgoId, StringComparison.Ordinal))
                .ToList();
        }

        return Results.Json(new Envelope<HallazgosData>(true, new HallazgosData(hallazgos)), SnakeCaseOptions);
    }

    private static IResult EmptyHallazgos()
        => Results.Json(new Envelope<HallazgosData>(true, new HallazgosData([])), SnakeCaseOptions);

    /// <summary>
    /// climate-tracking's two-valued vocabulary, which its <c>CacheSyncWorker</c> reads as
    /// <c>dto.Estado == "cerrado" ? Cerrado : Abierto</c>. Five survey statuses fold onto it:
    /// closed and archived are both "no longer collecting", and scheduled and active are both
    /// "this cycle is live" from a tracking module's point of view. Draft never reaches here.
    /// </summary>
    private const string EstadoAbierto = "abierto";

    /// <inheritdoc cref="EstadoAbierto"/>
    private const string EstadoCerrado = "cerrado";

    private static string CicloEstado(string status)
        => status is SurveyStatuses.Closed or SurveyStatuses.Archived ? EstadoCerrado : EstadoAbierto;

    private static IResult SendNotificationAsync()
    {
        // Stub: notifications domain (#55) doesn't exist yet. No-op success response;
        // #55 replaces this body with a real send once notification infrastructure exists.
        return Results.Json(new Envelope<object?>(true, null), SnakeCaseOptions);
    }

    // Shared `company_id` validation for the four data routes (/nodos, /personas,
    // /ciclos-encuesta, /hallazgos) -- see the class-level contract note for why
    // /send-notification, still a stub, deliberately does NOT call this.
    private static bool TryParseCompanyId(string companyId, out Guid companyGuid, out IResult error)
    {
        if (Guid.TryParse(companyId, out companyGuid))
        {
            error = null!;
            return true;
        }

        error = Results.Json(new { message = "company_id must be a valid GUID." }, statusCode: 400);
        return false;
    }
}
