using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

/// <summary>
/// Authenticated but wrong-tenant tokens must fail as 403 (authorization), not 401
/// (authentication) — JwtBearerEvents.OnTokenValidated calling context.Fail() would
/// produce a 401 instead, conflating "bad token" with "wrong tenant".
/// </summary>
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
        if (companyId == requirement.ExpectedCompanyId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
