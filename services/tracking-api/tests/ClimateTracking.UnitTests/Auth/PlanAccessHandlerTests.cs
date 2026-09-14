using System.Security.Claims;
using ClimateTracking.Application.Auth;
using ClimateTracking.Domain.Entities;
using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.UnitTests.Auth;

public class PlanAccessHandlerTests
{
    private static PlanDeAccion CreatePlan(string nodoExternalId = "ND-014", string responsableId = "PER-9999") => new()
    {
        PlanCode = "PA-2026-00123",
        NodoExternalId = nodoExternalId,
        LiderExternalId = "PER-0231",
        DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
        MetodologiaComo = "Nominacion por formulario simple",
        ResponsableEjecucionExternalId = responsableId,
        FechaCreacion = new DateOnly(2026, 1, 1),
        FechaCompromiso = new DateOnly(2026, 12, 31),
    };

    private static ClaimsPrincipal CreateUser(string sub, string role, string nodoId) => new(
        new ClaimsIdentity(
        [
            new Claim("sub", sub),
            new Claim("role", role),
            new Claim("nodoId", nodoId),
        ], "TestAuth"));

    private static async Task<bool> Authorize(
        ClaimsPrincipal user,
        PlanDeAccion plan,
        AccessLevel level)
    {
        var handler = new PlanAccessHandler();
        var context = new AuthorizationHandlerContext(
            [new PlanAccessRequirement(level)], user, plan);

        await handler.HandleAsync(context);

        return context.HasSucceeded;
    }

    [Theory]
    [InlineData("super_admin")]
    [InlineData("company_admin")]
    public async Task Admin_roles_always_succeed_for_read_and_write(string role)
    {
        var plan = CreatePlan(nodoExternalId: "ND-999");
        var user = CreateUser("PER-0001", role, "ND-OTHER");

        Assert.True(await Authorize(user, plan, AccessLevel.Read));
        Assert.True(await Authorize(user, plan, AccessLevel.Write));
    }

    [Fact]
    public async Task Leader_on_the_plans_own_node_succeeds_for_read_and_write()
    {
        var plan = CreatePlan(nodoExternalId: "ND-014");
        var user = CreateUser("PER-0231", "leader", "ND-014");

        Assert.True(await Authorize(user, plan, AccessLevel.Read));
        Assert.True(await Authorize(user, plan, AccessLevel.Write));
    }

    [Fact]
    public async Task Leader_on_a_different_node_fails()
    {
        var plan = CreatePlan(nodoExternalId: "ND-014");
        var user = CreateUser("PER-0231", "leader", "ND-999");

        Assert.False(await Authorize(user, plan, AccessLevel.Read));
        Assert.False(await Authorize(user, plan, AccessLevel.Write));
    }

    [Fact]
    public async Task Involved_persona_succeeds_for_read_but_not_write()
    {
        var plan = CreatePlan(nodoExternalId: "ND-014");
        plan.AgregarInvolucrado("PER-0245");
        var user = CreateUser("PER-0245", "employee", "ND-OTHER");

        Assert.True(await Authorize(user, plan, AccessLevel.Read));
        Assert.False(await Authorize(user, plan, AccessLevel.Write));
    }

    [Fact]
    public async Task Responsable_ejecucion_succeeds_for_read_but_not_write()
    {
        var plan = CreatePlan(nodoExternalId: "ND-014", responsableId: "PER-0300");
        var user = CreateUser("PER-0300", "supervisor", "ND-OTHER");

        Assert.True(await Authorize(user, plan, AccessLevel.Read));
        Assert.False(await Authorize(user, plan, AccessLevel.Write));
    }

    [Fact]
    public async Task Unrelated_user_fails_for_read_and_write()
    {
        var plan = CreatePlan(nodoExternalId: "ND-014");
        var user = CreateUser("PER-4444", "employee", "ND-OTHER");

        Assert.False(await Authorize(user, plan, AccessLevel.Read));
        Assert.False(await Authorize(user, plan, AccessLevel.Write));
    }

    /// <summary>
    /// Fulfilment is an administrator's act. Ruled 2026-09-14 from the client's "only one
    /// person marks it fulfilled", expressed as a role rather than a name.
    ///
    /// The case that carries the rule is the THIRD one: a node leader has Write on their own
    /// plan and must still be refused Approve. Without it, `Approve` would be indistinguishable
    /// from `Write` for every caller who matters -- admins pass both, strangers fail both, and
    /// the leader is the only principal whose two answers differ.
    /// </summary>
    [Theory]
    [InlineData("super_admin")]
    [InlineData("company_admin")]
    public async Task An_admin_may_declare_a_plan_fulfilled(string role)
    {
        var allowed = await Authorize(CreateUser("PER-0001", role, "ND-014"), CreatePlan(), AccessLevel.Approve);

        Assert.True(allowed);
    }

    [Fact]
    public async Task The_nodes_own_leader_may_write_the_plan_but_not_declare_it_fulfilled()
    {
        var leader = CreateUser("PER-0231", "leader", "ND-014");
        var plan = CreatePlan();

        Assert.True(await Authorize(leader, plan, AccessLevel.Write));
        Assert.False(await Authorize(leader, plan, AccessLevel.Approve));
    }

    [Fact]
    public async Task The_responsable_de_ejecucion_may_not_declare_their_own_plan_fulfilled()
    {
        // Read-only already, but stated outright: the person who reports the progress is the
        // person least able to audit it, which is the whole reason this level exists.
        var responsable = CreateUser("PER-9999", "employee", "ND-014");
        var plan = CreatePlan(responsableId: "PER-9999");

        Assert.True(await Authorize(responsable, plan, AccessLevel.Read));
        Assert.False(await Authorize(responsable, plan, AccessLevel.Approve));
    }
}
