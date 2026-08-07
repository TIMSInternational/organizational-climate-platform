using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Tracking;

/// <summary>
/// #151: the nodoId JWT claim and /api/internal/personas must derive a user's nodo_id
/// identically. These pin the one shared derivation both now call.
/// </summary>
public class TrackingIdentifiersTests
{
    private static Department DepartmentWith(string? legacyExternalId) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        Name = "Engineering",
        LegacyExternalId = legacyExternalId,
    };

    [Fact]
    public void NodoIdForUser_uses_the_department_legacy_external_id_when_present()
    {
        var department = DepartmentWith("ND-014");

        Assert.Equal("ND-014", TrackingIdentifiers.NodoIdForUser(department, Guid.NewGuid()));
    }

    [Fact]
    public void NodoIdForUser_falls_back_to_the_department_guid_when_it_has_no_legacy_id()
    {
        var department = DepartmentWith(null);

        Assert.Equal(department.Id.ToString(), TrackingIdentifiers.NodoIdForUser(department, Guid.NewGuid()));
    }

    [Fact]
    public void NodoIdForUser_returns_the_synthetic_unassigned_nodo_when_there_is_no_department()
    {
        var companyId = Guid.NewGuid();

        Assert.Equal(
            TrackingIdentifiers.UnassignedNodoId(companyId),
            TrackingIdentifiers.NodoIdForUser(null, companyId));
    }

    [Fact]
    public void NodoIdForUser_never_returns_an_empty_string()
    {
        // climate-tracking's PersonaDto.NodoId is a non-nullable string used verbatim as an
        // authorization scoping key (`targetNodoId != currentUser.NodoExternalId`), so an
        // empty value would be a broken key rather than a harmless one.
        Assert.NotEmpty(TrackingIdentifiers.NodoIdForUser(DepartmentWith("ND-014"), Guid.NewGuid()));
        Assert.NotEmpty(TrackingIdentifiers.NodoIdForUser(DepartmentWith(null), Guid.NewGuid()));
        Assert.NotEmpty(TrackingIdentifiers.NodoIdForUser(null, Guid.NewGuid()));
    }

    [Fact]
    public void NodoIdClaimForUser_agrees_with_NodoIdForUser_for_every_tenanted_user()
    {
        // THE point of #151. The claim path (nullable CompanyId) and the /personas path
        // (non-null companyGuid) must produce the same string for the same user, because
        // climate-tracking compares one against the other: its persona cache is filled from
        // /api/internal/personas while its authorization reads the claim.
        var companyId = Guid.NewGuid();

        foreach (var department in new Department?[] { DepartmentWith("ND-014"), DepartmentWith(null), null })
        {
            Assert.Equal(
                TrackingIdentifiers.NodoIdForUser(department, companyId),
                TrackingIdentifiers.NodoIdClaimForUser(department, companyId));
        }
    }

    [Fact]
    public void NodoIdClaimForUser_is_null_for_a_company_less_user_with_no_department()
    {
        // #191 made User.CompanyId nullable; NULL means a super_admin at global scope. There
        // is no per-company synthetic nodo to place them in, and every nodo check in
        // climate-tracking short-circuits on Roles.Admin before comparing one, so null (an
        // empty claim) is correct rather than merely inert.
        Assert.Null(TrackingIdentifiers.NodoIdClaimForUser(null, null));
    }

    [Fact]
    public void NodoIdClaimForUser_still_resolves_a_department_for_a_company_less_user()
    {
        var department = DepartmentWith("ND-014");

        Assert.Equal("ND-014", TrackingIdentifiers.NodoIdClaimForUser(department, null));
    }

    [Fact]
    public void UnassignedNodoId_is_deterministic_per_company()
    {
        // /nodos and /personas are separate HTTP calls; they only agree because this is a
        // pure function of company_id and not of anything request-scoped.
        var companyId = Guid.NewGuid();

        Assert.Equal(TrackingIdentifiers.UnassignedNodoId(companyId), TrackingIdentifiers.UnassignedNodoId(companyId));
        Assert.NotEqual(TrackingIdentifiers.UnassignedNodoId(companyId), TrackingIdentifiers.UnassignedNodoId(Guid.NewGuid()));
    }
}
