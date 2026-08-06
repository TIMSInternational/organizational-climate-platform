namespace ClimateProject.Application.Auth;

/// <summary>
/// Tenant-scoping decisions for a target company that may be NULL.
/// </summary>
/// <remarks>
/// Since #191 a User's CompanyId is nullable, and NULL means global scope -- no tenant.
/// The ten hand-rolled <c>CanAccessCompany(CurrentUser, Guid)</c> guards across the
/// endpoints all take a non-nullable target and are unaffected; this exists for the
/// call sites whose target is <c>Guid?</c> because it came off a User row.
///
/// The rule for a NULL target is "SuperAdmin only", and that is the conservative answer
/// rather than an arbitrary one: a NULL target is not "everyone's company", it is
/// "outside every company", so no CompanyAdmin's tenant can ever match it. It also
/// matches the escalation guard already in UserEndpoints.UpdateAsync, which reserves
/// admin-role targets to SuperAdmins.
///
/// Lives in Application (not Api) so it is directly unit-testable -- the unit test
/// project references Application/Domain/Infrastructure but not Api.
/// </remarks>
public static class CompanyScope
{
    /// <summary>
    /// True when <paramref name="currentUser"/> may act on rows scoped to
    /// <paramref name="companyId"/>. A NULL <paramref name="companyId"/> is global scope
    /// and is reachable by SuperAdmins only.
    /// </summary>
    public static bool CanAccess(CurrentUser currentUser, Guid? companyId)
    {
        if (currentUser.Role == Roles.SuperAdmin)
        {
            return true;
        }

        if (companyId is null)
        {
            return false;
        }

        return currentUser.Role == Roles.CompanyAdmin
               && currentUser.CompanyId == companyId.Value.ToString();
    }

    /// <summary>
    /// The acting user's own tenant, or null when they have none (a global super_admin,
    /// whose companyId claim is <see cref="string.Empty"/> -- see
    /// <see cref="ClaimsPrincipalExtensions.GetCurrentUser"/>). Never throws on a blank or
    /// malformed claim, unlike a bare <c>Guid.Parse</c>.
    /// </summary>
    public static Guid? OwnCompanyId(CurrentUser currentUser)
        => Guid.TryParse(currentUser.CompanyId, out var parsed) ? parsed : null;
}
