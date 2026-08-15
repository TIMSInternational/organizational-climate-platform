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
        var companyId = context.User.FindFirst("companyId")?.Value;

        // A blank tenant on either side is refused before the comparison, not compared (#153).
        // Plain string equality made "" == "" a match, and both blanks are reachable: the
        // claim is blank for every company-less super_admin climate-project-api mints a token
        // for (`user.CompanyId?.ToString() ?? string.Empty`), and the expectation was blank in
        // any deployment that left appsettings.json's `"ProcomerCompanyId": ""` alone. The two
        // meeting granted the API to a user belonging to no tenant at all -- the one caller
        // whose token says, in as many words, that it carries no claim to this one.
        if (!string.IsNullOrWhiteSpace(companyId)
            && !string.IsNullOrWhiteSpace(requirement.ExpectedCompanyId)
            && companyId == requirement.ExpectedCompanyId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
