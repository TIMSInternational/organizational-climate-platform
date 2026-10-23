using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The directories climate-tracking's plan forms pick from: nodos, personas and hallazgos.
/// climate-tracking holds only opaque external ids; the names behind them are this database's
/// <c>Department</c>, <c>User</c> and survey rows, which is why these live here.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is answered, and with what (G25).</b> An administrator of the company — a
/// <c>super_admin</c>, or a <c>company_admin</c> whose claim names it — gets the whole company,
/// as before. A <c>leader</c> of the company gets <b>exactly what climate-tracking lets them
/// act on</b> and nothing wider: <c>PlanAccessHandler</c> grants a leader write access to a plan
/// when <c>role == "leader" &amp;&amp; NodoExternalId == plan.NodoExternalId</c>, and
/// <c>PlanesAccionEndpoints.CreateAsync</c> refuses them any other node. That is one node, the
/// one their <c>nodoId</c> claim names — not its descendants, because the handler does not
/// reach them, and a picker that offered a child node would offer a plan the service then
/// refuses. So a leader's nodos are that one department, and their personas the active members
/// of it. Everyone else — <c>supervisor</c>, <c>employee</c>, any role of another company — is
/// refused, as before.
/// </para>
/// <para>
/// The scope is read from the <c>nodoId</c> claim, not from the user's current department row,
/// on purpose: climate-tracking authorises on the claim, and the two disagreeing (a department
/// changed after sign-in) must not let the picker offer a node the service would refuse.
/// A leader whose claim is blank or the synthetic <c>unassigned-&lt;companyId&gt;</c> leads no
/// department, and is answered with empty lists rather than with everyone who has no
/// department — that population is most of a tenant's sign-ups, and listing it to one leader
/// would be the widening this rule exists to prevent.
/// </para>
/// </remarks>
public static class TrackingPickerEndpoints
{
    public static void MapTrackingPickerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/tracking/picker").RequireAuthorization();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
        group.MapGet("/hallazgos", ListHallazgosAsync);
    }

    /// <summary>
    /// What a caller may pick from in one company: the whole company, or one nodo
    /// (<see cref="NodoId"/> null meaning a leader who leads no real department).
    /// </summary>
    internal sealed record PickerScope(bool WholeCompany, string? NodoId)
    {
        public static readonly PickerScope Company = new(true, null);

        public bool Includes(string nodoId) => WholeCompany || (NodoId is not null && NodoId == nodoId);
    }

    /// <summary>
    /// The caller's scope in <paramref name="companyId"/>, or null when they are refused.
    /// </summary>
    internal static PickerScope? ScopeFor(CurrentUser currentUser, Guid companyId)
    {
        var ownCompany = currentUser.CompanyId == companyId.ToString();

        if (currentUser.Role == Roles.SuperAdmin || (currentUser.Role == Roles.CompanyAdmin && ownCompany))
        {
            return PickerScope.Company;
        }

        if (currentUser.Role == Roles.Leader && ownCompany)
        {
            return new PickerScope(false, LeadsARealNodo(currentUser.NodoId, companyId) ? currentUser.NodoId : null);
        }

        return null;
    }

    private static bool LeadsARealNodo(string? nodoId, Guid companyId)
        => !string.IsNullOrEmpty(nodoId) && nodoId != TrackingIdentifiers.UnassignedNodoId(companyId);

    private static async Task<List<Domain.Entities.Department>> DepartmentsInScopeAsync(
        ClimateProjectDbContext db, Guid companyId, PickerScope scope, CancellationToken cancellationToken)
    {
        if (!scope.WholeCompany && scope.NodoId is null)
        {
            return [];
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId && d.IsActive)
            .OrderBy(d => d.Name)
            .ToListAsync(cancellationToken);

        // In memory: the external nodo id is LegacyExternalId-or-GUID, a derivation that lives
        // in one C# method (TrackingIdentifiers.ExternalNodoId) and is not restated as SQL.
        return departments
            .Where(d => scope.Includes(TrackingIdentifiers.ExternalNodoId(d)))
            .ToList();
    }

    private static async Task<IResult> ListNodosAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var scope = ScopeFor(principal.GetCurrentUser(), companyId);
        if (scope is null)
        {
            return Results.Forbid();
        }

        var departments = await DepartmentsInScopeAsync(db, companyId, scope, cancellationToken);

        var items = departments
            .Select(d => new NodoPickerItem(TrackingIdentifiers.ExternalNodoId(d), d.Name))
            .ToList();

        return Results.Ok(new NodoPickerResponse(items));
    }

    private static async Task<IResult> ListPersonasAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var scope = ScopeFor(principal.GetCurrentUser(), companyId);
        if (scope is null)
        {
            return Results.Forbid();
        }

        var users = db.Users.Where(u => u.CompanyId == companyId && u.IsActive);

        if (!scope.WholeCompany)
        {
            var departmentIds = (await DepartmentsInScopeAsync(db, companyId, scope, cancellationToken))
                .Select(d => d.Id)
                .ToList();
            users = users.Where(u => u.DepartmentId.HasValue && departmentIds.Contains(u.DepartmentId.Value));
        }

        var items = (await users.OrderBy(u => u.Name).ToListAsync(cancellationToken))
            .Select(u => new PersonaPickerItem(TrackingIdentifiers.ExternalPersonaId(u), u.Name, u.Email))
            .ToList();

        return Results.Ok(new PersonaPickerResponse(items));
    }

    /// <summary>
    /// The findings a plan on <paramref name="nodoId"/> can be written against, newest survey
    /// first. The same computation <c>/api/internal/hallazgos</c> serves climate-tracking
    /// (<see cref="TrackingInternalEndpoints.ComputeHallazgosAsync"/>), narrowed to one nodo,
    /// with the score left out (<see cref="HallazgoPickerItem"/>).
    /// </summary>
    /// <remarks>
    /// <c>nodoId</c> is required: a plan belongs to one nodo, and a finding of another
    /// department is not one it can answer. A leader naming a nodo they do not lead is refused,
    /// exactly as <c>CreateAsync</c> would refuse the plan.
    /// </remarks>
    private static async Task<IResult> ListHallazgosAsync(
        Guid companyId,
        string? nodoId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var scope = ScopeFor(principal.GetCurrentUser(), companyId);
        if (scope is null)
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(nodoId))
        {
            return Results.BadRequest(new { error = "nodoId is required." });
        }

        if (!scope.Includes(nodoId))
        {
            return Results.Forbid();
        }

        var (surveys, hallazgos) = await TrackingInternalEndpoints.ComputeHallazgosAsync(
            db, companyId, cicloGuid: null, cancellationToken);
        var surveysById = surveys.ToDictionary(s => s.Id.ToString());

        var items = hallazgos
            .Where(h => h.NodoId == nodoId && h.CicloId is not null && surveysById.ContainsKey(h.CicloId))
            .Select(h =>
            {
                var survey = surveysById[h.CicloId!];
                var title = LocalizedContent.Resolve(survey.TitleEn, survey.TitleEs, lang, survey.Language).Text ?? string.Empty;
                return new HallazgoPickerItem(h.HallazgoId, h.CicloId!, title, survey.EndDate, h.Categoria);
            })
            .ToList();

        return Results.Ok(new HallazgoPickerResponse(items));
    }
}
