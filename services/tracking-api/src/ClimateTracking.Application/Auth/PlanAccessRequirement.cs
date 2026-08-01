using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.Application.Auth;

public enum AccessLevel
{
    Read,
    Write,
}

public sealed class PlanAccessRequirement(AccessLevel level) : IAuthorizationRequirement
{
    public AccessLevel Level { get; } = level;
}
