namespace ClimateProject.Application.Search;

/// <summary>
/// The tenant boundary a search runs inside, as a value rather than a convention.
///
/// A nullable <c>Guid?</c> passed straight into the query layer would mean an
/// unfiltered cross-tenant search is what you get by forgetting to set something --
/// the silent failure this issue exists to prevent. Going through a named factory makes
/// the unrestricted case impossible to reach by omission and trivial to grep for:
/// <see cref="CrossTenant"/> has exactly one legitimate caller, the SuperAdmin branch of
/// <c>SearchEndpoints</c>.
/// </summary>
public sealed record SearchScope
{
    private SearchScope(Guid? companyId) => CompanyId = companyId;

    /// <summary>The single tenant to search, or null when the search is cross-tenant.</summary>
    public Guid? CompanyId { get; }

    /// <summary>True only for a SuperAdmin searching every company at once.</summary>
    public bool IsCrossTenant => CompanyId is null;

    /// <summary>Restrict every query to one company. The only scope a CompanyAdmin can ever get.</summary>
    public static SearchScope ForCompany(Guid companyId) => new(companyId);

    /// <summary>
    /// No company filter at all. SuperAdmin only -- see <c>SearchEndpoints.ResolveScope</c>,
    /// which is the one place allowed to call this.
    /// </summary>
    public static SearchScope CrossTenant() => new(companyId: null);
}
