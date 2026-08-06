using ClimateProject.Application.Auth;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// Guards the #191 rule: User.CompanyId is nullable and NULL means global scope.
/// </summary>
public class CompanyScopeTests
{
    private static readonly Guid CompanyA = Guid.NewGuid();
    private static readonly Guid CompanyB = Guid.NewGuid();

    private static CurrentUser UserWith(string role, Guid? companyId) => new(
        Sub: Guid.NewGuid().ToString(),
        Role: role,
        NodoId: null,
        Email: "person@acme.test",
        Name: "Person One",
        // Mirrors ClaimsPrincipalExtensions.GetCurrentUser, which defaults a missing
        // companyId claim to string.Empty rather than null.
        CompanyId: companyId?.ToString() ?? string.Empty,
        IsActive: true);

    [Fact]
    public void SuperAdmin_with_no_company_can_access_a_company_scoped_target()
    {
        // The whole point of #191: the super_admin's own CompanyId is never read,
        // because the role check short-circuits before it.
        var superAdmin = UserWith(Roles.SuperAdmin, companyId: null);

        Assert.True(CompanyScope.CanAccess(superAdmin, CompanyA));
        Assert.True(CompanyScope.CanAccess(superAdmin, CompanyB));
    }

    [Fact]
    public void SuperAdmin_can_access_the_null_global_scope()
    {
        Assert.True(CompanyScope.CanAccess(UserWith(Roles.SuperAdmin, companyId: null), null));
        Assert.True(CompanyScope.CanAccess(UserWith(Roles.SuperAdmin, CompanyA), null));
    }

    [Fact]
    public void CompanyAdmin_cannot_access_the_null_global_scope()
    {
        // NULL is not "everyone's company", it is "outside every company". A CompanyAdmin
        // reaching a company-less user would be reaching a super_admin's own record.
        Assert.False(CompanyScope.CanAccess(UserWith(Roles.CompanyAdmin, CompanyA), null));
    }

    [Fact]
    public void A_blank_companyId_claim_never_matches_the_null_global_scope()
    {
        // The failure mode this rules out: treating "" and NULL as the same value, so a
        // claim-less CompanyAdmin token would authorize against every company-less row.
        var claimlessCompanyAdmin = UserWith(Roles.CompanyAdmin, companyId: null);

        Assert.Equal(string.Empty, claimlessCompanyAdmin.CompanyId);
        Assert.False(CompanyScope.CanAccess(claimlessCompanyAdmin, null));
        Assert.False(CompanyScope.CanAccess(claimlessCompanyAdmin, CompanyA));
    }

    [Fact]
    public void CompanyAdmin_can_access_only_their_own_company()
    {
        // Companion check: the guard still detects what it always detected. Widening the
        // parameter to Guid? must not have loosened the non-null path.
        var companyAdmin = UserWith(Roles.CompanyAdmin, CompanyA);

        Assert.True(CompanyScope.CanAccess(companyAdmin, CompanyA));
        Assert.False(CompanyScope.CanAccess(companyAdmin, CompanyB));
    }

    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public void Non_admin_roles_are_denied_even_for_their_own_company(string role)
    {
        Assert.False(CompanyScope.CanAccess(UserWith(role, CompanyA), CompanyA));
        Assert.False(CompanyScope.CanAccess(UserWith(role, CompanyA), null));
    }

    [Fact]
    public void OwnCompanyId_parses_a_real_claim()
    {
        Assert.Equal(CompanyA, CompanyScope.OwnCompanyId(UserWith(Roles.CompanyAdmin, CompanyA)));
    }

    [Fact]
    public void OwnCompanyId_returns_null_rather_than_throwing_on_a_blank_or_malformed_claim()
    {
        // AuthEndpoints.ResetCredentialsAsync used to embed the raw claim string in an EF
        // query. It now parses up front, and a global super_admin's blank claim must yield
        // null here instead of throwing the way a bare Guid.Parse would.
        Assert.Null(CompanyScope.OwnCompanyId(UserWith(Roles.SuperAdmin, companyId: null)));
        Assert.Null(CompanyScope.OwnCompanyId(UserWith(Roles.SuperAdmin, companyId: null) with { CompanyId = "not-a-guid" }));
    }
}
