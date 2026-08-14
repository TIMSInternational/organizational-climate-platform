using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

// Contract: every `company_id` query param below must be a climate-project `Company` GUID
// (Departments.CompanyId / Users.CompanyId), never a legacy/free-form identifier.
//
// /nodos and /personas validate `company_id` and 400 on a non-GUID value -- this is the
// literal plan (Task 2 Step 4) behavior, kept as-is.
//
// /ciclos-encuesta, /hallazgos and /send-notification are stubs (surveys #51 / notifications
// #55 don't exist yet) and intentionally do NOT validate `company_id` -- the plan's Task 3
// Step 2 stub bodies are unconditional empty/no-op responses, on purpose, so a misconfigured
// caller degrades gracefully on the not-yet-real routes instead of failing loudly on them. A
// prior pass added the same 400 validation to the stub routes to "close a drift" against
// /nodos and /personas; that was an unrequested contract change nobody approved, and it made
// the failure mode worse: climate-tracking's `ClimateProjectClientOptions.ProcomerCompanyId`
// is an unconstrained `required string` that defaults to `""` in both services'
// appsettings.json, and `ClimateProjectClient` calls `response.EnsureSuccessStatusCode()` --
// so a blank/legacy company_id would throw on the stub routes too, when the plan's whole
// point of stubbing them was to not need a real company_id yet. Reverted to match the plan.
public static class TrackingInternalEndpoints
{
    /// <summary>
    /// The path prefix every route in this file hangs off. Shared with
    /// <see cref="RateLimitPolicies.PartitionGlobal"/>, which gives this surface its own
    /// ceiling because it is machine traffic gated by <see cref="InternalApiKeyFilter"/>
    /// rather than by a JWT -- a literal in both places would let the two drift silently.
    /// </summary>
    internal const string GroupPrefix = "/api/internal";

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
        var activeUsersByDepartment = await db.Users
            .Where(u => u.CompanyId == companyGuid && u.DepartmentId != null && u.IsActive)
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

    private static Task<IResult> ListCiclosAsync(
        [FromQuery(Name = "company_id")] string companyId)
    {
        // Stub: surveys domain (#51) doesn't exist yet. Always returns an empty list
        // regardless of company_id (including a blank/non-GUID value) -- see the class-level
        // contract note; #51 replaces this body with a real query once survey-cycle data
        // exists, at which point it should adopt the same company_id validation /nodos and
        // /personas use.
        return Task.FromResult(Results.Json(new Envelope<CiclosData>(true, new CiclosData([])), SnakeCaseOptions));
    }

    private static Task<IResult> ListHallazgosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        [FromQuery(Name = "ciclo_id")] string? cicloId,
        [FromQuery(Name = "hallazgo_id")] string? hallazgoId)
    {
        // Stub: surveys domain (#51) doesn't exist yet. Always returns an empty list
        // regardless of company_id or the ciclo_id/hallazgo_id filters -- see the class-level
        // contract note; #51 replaces this body with a real query and MUST honor both filters
        // at that point (the old Next.js /internal/hallazgos silently ignored ciclo_id --
        // don't repeat that here).
        return Task.FromResult(Results.Json(new Envelope<HallazgosData>(true, new HallazgosData([])), SnakeCaseOptions));
    }

    private static IResult SendNotificationAsync()
    {
        // Stub: notifications domain (#55) doesn't exist yet. No-op success response;
        // #55 replaces this body with a real send once notification infrastructure exists.
        return Results.Json(new Envelope<object?>(true, null), SnakeCaseOptions);
    }

    // Shared `company_id` validation for the two real /api/internal/* routes (/nodos,
    // /personas) -- see the class-level contract note for why the 3 stub routes below
    // deliberately do NOT call this.
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
