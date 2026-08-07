using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Tracking;

public static class TrackingIdentifiers
{
    public static string ExternalNodoId(Department department) => department.LegacyExternalId ?? department.Id.ToString();

    public static string ExternalPersonaId(User user) => user.PersonaExternalId ?? user.Id.ToString();

    // Synthetic nodo_id for personas whose User.DepartmentId is null. DepartmentId is only
    // ever written by BulkImportEndpoints, UserEndpoints, InvitationEndpoints and
    // InvitationAcceptEndpoints -- plain /auth/signup and Google login never set it, so most
    // real users have no department. climate-tracking's PersonaDto.NodoId is a non-nullable
    // string used for tablero authorization scoping (`targetNodoId != currentUser.NodoExternalId`),
    // so it must never be empty, and it must resolve to a nodo_id actually present in the
    // /api/internal/nodos response for the same company_id -- both endpoints derive this id
    // the same deterministic way (per company_id, not per-request), so a separate /nodos call
    // and /personas call always agree on it.
    public static string UnassignedNodoId(Guid companyId) => $"unassigned-{companyId}";

    /// <summary>
    /// The single derivation of a user's nodo_id, shared by <c>/api/internal/personas</c> and by
    /// the <c>nodoId</c> JWT claim so the two can never drift (#151).
    ///
    /// They used to disagree: /personas resolved through <c>User.DepartmentId</c> (correct),
    /// while the claim was minted from the <c>User.NodoId</c> column, which no code path in
    /// this repo ever wrote -- so the claim was always the empty string. climate-tracking
    /// authorizes tablero and plan-de-accion scoping on that claim
    /// (<c>CurrentUser.NodoExternalId</c>, read from <c>nodoId</c>), while its persona cache is
    /// filled from /personas, so a non-admin's scoping key never matched their own cached
    /// nodo. Both sides now call this method.
    /// </summary>
    /// <param name="department">
    /// The user's department, already loaded, or null when <c>User.DepartmentId</c> is unset.
    /// </param>
    /// <param name="companyId">The user's tenant. Never null on this overload.</param>
    public static string NodoIdForUser(Department? department, Guid companyId)
        => department is not null ? ExternalNodoId(department) : UnassignedNodoId(companyId);

    /// <summary>
    /// <see cref="NodoIdForUser(Department?, Guid)"/> for the claim-minting path, where the
    /// tenant is <c>Guid?</c> since #191 made <c>User.CompanyId</c> nullable.
    ///
    /// A company-less user is by definition a super_admin operating at global scope, and there
    /// is no per-company synthetic nodo to place them in. They get null -- rendered as the
    /// empty claim value <c>JwtTokenService</c> already emits for null -- which is correct
    /// rather than merely inert: every nodo check in climate-tracking
    /// (<c>DashboardEndpoints.TableroAsync</c>, <c>PlanesAccionEndpoints</c>,
    /// <c>PlanAccessHandler</c>) short-circuits on <c>Roles.Admin.Contains(role)</c> before it
    /// ever compares a nodo, so a super_admin's scoping never reads this value at all.
    /// </summary>
    public static string? NodoIdClaimForUser(Department? department, Guid? companyId)
    {
        if (department is not null)
        {
            return ExternalNodoId(department);
        }

        return companyId.HasValue ? UnassignedNodoId(companyId.Value) : null;
    }
}
