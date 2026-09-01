using System.Security.Cryptography;
using System.Text;
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

    /// <summary>
    /// The <c>hallazgo_id</c> of one (survey x department x dimension) finding.
    ///
    /// **There is no hallazgo table.** A hallazgo is one cell of a survey's climate
    /// results -- one department's score for one dimension -- computed on demand by
    /// <c>TrackingHallazgos</c>. So the id cannot be read from a column; it has to be
    /// *derived*, and the derivation is the contract.
    ///
    /// **Why it must be stable, exactly.** climate-tracking's <c>PlanDeAccion</c> stores
    /// this value in <c>HallazgoExternalId</c> as a foreign reference to a row that lives
    /// in another service's database. Nothing enforces it -- there is no FK across the two
    /// -- so an id whose *shape* changed between two cache syncs would not fail: every
    /// action plan the client had already written would simply stop resolving, the
    /// tracking sheet's "Hallazgo (tema de la encuesta)" column would fall back to the raw
    /// id, and no error would be raised anywhere. Silence is the failure mode, which is why
    /// this is pinned by a test that computes the same id twice from independently
    /// constructed inputs.
    ///
    /// **The three inputs are each immutable for a survey that can have findings.**
    /// Findings are published only for a closed or archived survey (see
    /// <c>TrackingHallazgos</c>), and <c>SurveyStatuses.AllowsContentEdit</c> permits
    /// content edits in <c>draft</c> only -- so the survey id, the department id, and the
    /// question <c>Category</c> that names the dimension are all frozen by the time
    /// anything here is emitted.
    ///
    /// **<paramref name="departmentId"/>, not the nodo_id.** The emitted
    /// <c>HallazgoInternalDto.NodoId</c> is <see cref="ExternalNodoId"/>, which reads
    /// <c>Department.LegacyExternalId</c> and falls back to the GUID. That column is
    /// nullable and back-fillable: an admin setting a legacy id on a department that had
    /// none would change every nodo_id it derives, and had the hash been taken over that,
    /// it would have re-shaped every hallazgo id in the company at the same moment. The
    /// primary key never moves.
    ///
    /// **The encoding.** SHA-256 over the three parts, with the free-text one
    /// length-prefixed so no pair of dimension names can produce one input by re-cutting
    /// the other's bytes, truncated to 16 bytes and rendered lowercase hex behind a
    /// <c>hal-</c> tag: 36 characters, comfortably inside the <c>varchar(64)</c> that
    /// <c>PlanDeAccionConfiguration</c> gives <c>HallazgoExternalId</c>. A readable
    /// composite of the three parts was the alternative and does not fit -- a dimension
    /// name is free text of any length. The hash authenticates nothing; it is used purely
    /// as a fixed-width deterministic function.
    /// </summary>
    public static string ExternalHallazgoId(Guid surveyId, Guid departmentId, string dimension)
    {
        ArgumentNullException.ThrowIfNull(dimension);

        var name = $"{surveyId:D}|{departmentId:D}|{dimension.Length}:{dimension}";
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(name));

        return $"hal-{Convert.ToHexString(digest.AsSpan(0, 16)).ToLowerInvariant()}";
    }
}
