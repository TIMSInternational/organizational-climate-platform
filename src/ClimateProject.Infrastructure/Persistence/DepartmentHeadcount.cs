using ClimateProject.Domain.Entities;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// The one definition of "the people a department has", shared by every surface that
/// prints or divides by that number.
///
/// **Why this exists as a type rather than as a repeated <c>Where</c>.** It used to be a
/// repeated <c>Where</c>, and the three copies drifted: <c>DepartmentEndpoints</c> counted
/// active members while both projections behind
/// <see cref="ClimateProject.Application.Surveys.AggregationDepartment"/> counted everyone
/// whose user row still pointed at the department. A comment in
/// <c>DepartmentEndpoints</c> asserted the two matched "exactly"; they did not, and
/// nothing failed when they stopped, because no test ever compared the two surfaces.
/// Deactivating 2 of 9 members made the Departments page read 7 while the participation
/// denominator on the results screen stayed 9. A predicate that must be identical in
/// three places is one predicate in one place.
///
/// **Why <see cref="User.IsActive"/> is part of it.** A deactivated user cannot obtain a
/// token -- <c>AuthEndpoints</c> refuses login on exactly this flag -- so they can never
/// appear in the numerator of a participation rate. Leaving them in the denominator makes
/// every department's participation drift permanently downward as staff turn over, and no
/// amount of chasing brings it back. Counting active members only is also what the
/// anonymity floor on the write path already does
/// (<c>SurveyResponseEndpoints.CaptureDemographicsAsync</c>), which is the most
/// consequential department headcount in the system.
///
/// The honest cost, stated because it is real: a member who completes a survey and is
/// deactivated afterwards stays in the numerator (their response row keeps its own
/// department id) and leaves the denominator, so a department's participation can read
/// above 100%. That is bounded by the leavers of one survey window and self-corrects; the
/// alternative is a denominator that is wrong for every department, permanently, in the
/// direction that flatters nobody.
///
/// **Not every department headcount in this codebase is this one.**
/// <see cref="DashboardQueries.DepartmentSummaries"/> and
/// <c>DepartmentAdminDashboard.MemberCount</c> deliberately count members active or not
/// and say so in their own docs -- an org chart is not a participation denominator. Those
/// are a different question, not a fourth copy of this one.
/// </summary>
public static class DepartmentHeadcount
{
    /// <summary>
    /// The users one company's department headcounts are counted over. Compose a
    /// department predicate on top -- <c>Population(users, companyId).Count(u =&gt;
    /// u.DepartmentId == d.Id)</c> for a correlated count, or a <c>GroupBy</c> for all
    /// departments at once.
    /// </summary>
    /// <remarks>
    /// The company predicate is applied here rather than left to the caller for the reason
    /// <see cref="DashboardQueries.DepartmentSummaries"/> states: department ids are
    /// globally unique, but relying on that to enforce a tenant boundary makes the boundary
    /// an accident of the id scheme.
    /// </remarks>
    public static IQueryable<User> Population(IQueryable<User> users, Guid companyId)
        => users.Where(u => u.CompanyId == companyId && u.DepartmentId != null && u.IsActive);
}
