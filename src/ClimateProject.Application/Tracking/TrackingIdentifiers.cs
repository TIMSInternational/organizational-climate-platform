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
}
