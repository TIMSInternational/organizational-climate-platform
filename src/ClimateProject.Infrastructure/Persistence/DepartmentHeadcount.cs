using ClimateProject.Domain.Entities;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// The population a department's <b>per-survey</b> participation is measured over: the
/// active members -- the people who can still answer. Every counter that divides one
/// survey's respondents by a department headcount, or prints the number such a rate is
/// divided by, reads this definition rather than spelling the predicate out:
///
/// <list type="bullet">
/// <item><c>DepartmentEndpoints</c> -- the Departments page's EMPLOYEES ASSIGNED and the
/// single-department detail.</item>
/// <item><c>SurveyResultsEndpoints.LoadDepartmentsAsync</c> and
/// <see cref="DashboardQueries.AggregationDepartments"/> -- the two builders of
/// <see cref="ClimateProject.Application.Surveys.AggregationDepartment"/>, whose
/// <c>Headcount</c> is the denominator of per-department participation on every results
/// surface.</item>
/// <item><c>SurveyResponseEndpoints.CaptureDemographicsAsync</c> -- the anonymity floor on
/// the write path, the most consequential department headcount in the system.</item>
/// <item><c>TrackingInternalEndpoints.ListNodosAsync</c> -- the
/// <c>cantidad_colaboradores</c> the <c>/api/internal/nodos</c> feed publishes to an
/// external consumer.</item>
/// </list>
///
/// **Why this exists as a type rather than as a repeated <c>Where</c>.** It used to be a
/// repeated <c>Where</c>, and the copies drifted: <c>DepartmentEndpoints</c> counted
/// active members while both projections behind <c>AggregationDepartment</c> counted
/// everyone whose user row still pointed at the department. A comment in
/// <c>DepartmentEndpoints</c> asserted the two matched "exactly"; they did not, and
/// nothing failed when they stopped, because no test ever compared the two surfaces.
/// Deactivating 2 of 9 members made the Departments page read 7 while the participation
/// denominator on the results screen stayed 9. A predicate that must be identical in
/// several places is one predicate in one place.
///
/// **Why <see cref="User.IsActive"/> is part of it.** A deactivated user cannot obtain a
/// token -- <c>AuthEndpoints</c> refuses login on exactly this flag -- so they can never
/// appear in the numerator of a single survey's participation. Leaving them in the
/// denominator makes every department's participation drift permanently downward as staff
/// turn over, and no amount of chasing brings it back.
///
/// The honest cost, stated because it is real: a member who completes a survey and is
/// deactivated afterwards stays in the numerator (their response row keeps its own
/// department id) and leaves the denominator, so a department's participation can read
/// above 100%. That is a <em>true</em> reading of a team that shrank mid-window, it is
/// reported raw -- no surface clamps it, see the note in
/// <c>SurveyAggregation.DepartmentBreakdown</c> and the pin in
/// <c>SurveyAggregationTests.Participation_above_100_is_reported_raw_not_clamped</c> --
/// and it is bounded by the leavers of one survey window. The alternative is a
/// denominator that is wrong for every department, permanently, in the direction that
/// flatters nobody.
///
/// **Not every department count in this codebase is this population.** The exceptions are
/// deliberate, for reasons their own docs state:
///
/// <list type="bullet">
/// <item><see cref="DashboardQueries.DepartmentSummaries"/> and
/// <c>DepartmentAdminDashboard.MemberCount</c> count members <em>active or not</em>. They
/// are not org-chart trivia -- they are denominators too, of the dashboards' all-time
/// completed-responses-per-person reading -- but that reading's numerator spans every
/// survey the tenant has ever run and keeps the responses of members deactivated since,
/// and the company-level target it is read against divides by every user row
/// (<see cref="DashboardQueries.UserCounts"/>' total). A denominator counts the
/// population its numerator draws from: theirs draws from the department's whole history,
/// this one from its present.</item>
/// <item><c>DepartmentAdminDashboard.ActiveMemberCount</c> reports <em>this</em>
/// population's size, but is computed by <see cref="DashboardQueries.UserCounts"/>'
/// conditional count in the same single statement as the all-members total beside it,
/// rather than through this type. If <see cref="Population"/> ever gains a term beyond
/// <see cref="User.IsActive"/>, that surface must be revisited.</item>
/// <item>The synthetic "Sin nodo asignado" bucket in <c>TrackingInternalEndpoints</c>
/// counts users with <em>no</em> department, active or not -- the complement of this
/// population, kept whole so that every persona the feed emits (deactivated ones
/// included) resolves to a nodo.</item>
/// </list>
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
