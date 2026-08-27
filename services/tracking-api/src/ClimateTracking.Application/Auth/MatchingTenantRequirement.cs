using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

/// <summary>
/// Authenticated but wrong-tenant tokens must fail as 403 (authorization), not 401
/// (authentication) — JwtBearerEvents.OnTokenValidated calling context.Fail() would
/// produce a 401 instead, conflating "bad token" with "wrong tenant".
/// </summary>
/// <remarks>
/// Deliberately does NOT reject a blank <paramref name="expectedCompanyId"/> in the
/// constructor. Program.cs refuses to start on one, which is where that belongs; keeping the
/// type constructible with a blank value is what lets the handler's own fail-closed rule
/// below be tested rather than asserted (#153).
/// </remarks>
public sealed class MatchingTenantRequirement(string expectedCompanyId) : IAuthorizationRequirement
{
    public string ExpectedCompanyId { get; } = expectedCompanyId;
}

public sealed class MatchingTenantHandler : AuthorizationHandler<MatchingTenantRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        MatchingTenantRequirement requirement)
    {
        // #153 FIRST, and structurally rather than as one clause among several: with no
        // tenant configured this handler can never succeed, so every rule below it may
        // assume there IS one. The old shape repeated `!IsNullOrWhiteSpace(Expected)` inside
        // a single condition, which worked but meant a second arm added later — this one —
        // had to remember to repeat it too. Returning early makes forgetting impossible.
        if (string.IsNullOrWhiteSpace(requirement.ExpectedCompanyId))
        {
            return Task.CompletedTask;
        }

        var companyId = context.User.FindFirst("companyId")?.Value;
        var role = context.User.FindFirst("role")?.Value;

        // THE PLATFORM OPERATOR, and only them.
        //
        // This service is single-tenant by construction: nothing in ClimateTracking.Domain
        // carries a company column, and ProcomerCompanyId pins the whole deployment. So a
        // super_admin cannot be "scoped" to a company here — there is exactly one, and the
        // only question is whether they reach it.
        //
        // The rest of the service already answered that. PlanAccessHandler says "Admin roles
        // (company_admin, super_admin) always pass", and every plan-level decision honours
        // it. What kept them out was this gate: climate-project-api mints
        // `companyId: user.CompanyId?.ToString() ?? string.Empty`, and a global super_admin
        // has no company since #191, so their claim is blank and blank never matches. That
        // was a side effect of closing the blank==blank hole in #153, not a decision to
        // exclude them.
        //
        // `Roles.SuperAdmin`, NOT `Roles.Admin.Contains(role)`. The latter also holds
        // company_admin, and a company_admin belongs to exactly one tenant — admitting them
        // on the strength of the role alone would hand this deployment's data to the
        // administrator of a DIFFERENT company. That is the whole property this gate exists
        // to hold, and `A_company_admin_from_another_tenant_still_does_not_pass` is the test
        // that keeps the two apart.
        if (role == Roles.SuperAdmin)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        // Everyone else: their own tenant, and only if they name it. A blank claim is
        // refused rather than compared — see above.
        if (!string.IsNullOrWhiteSpace(companyId) && companyId == requirement.ExpectedCompanyId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
