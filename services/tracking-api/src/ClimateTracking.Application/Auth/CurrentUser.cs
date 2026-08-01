using System.Security.Claims;

namespace ClimateTracking.Application.Auth;

public sealed record CurrentUser(
    string PersonaExternalId,
    string Role,
    string NodoExternalId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive);

public static class ClaimsPrincipalExtensions
{
    public static CurrentUser GetCurrentUser(this ClaimsPrincipal principal)
    {
        var personaExternalId = principal.FindFirst("sub")?.Value
            ?? throw new InvalidOperationException("Token is missing the required 'sub' claim.");

        return new CurrentUser(
            PersonaExternalId: personaExternalId,
            Role: principal.FindFirst("role")?.Value ?? string.Empty,
            NodoExternalId: principal.FindFirst("nodoId")?.Value ?? string.Empty,
            Email: principal.FindFirst("email")?.Value ?? string.Empty,
            Name: principal.FindFirst("name")?.Value ?? string.Empty,
            CompanyId: principal.FindFirst("companyId")?.Value ?? string.Empty,
            IsActive: bool.TryParse(principal.FindFirst("isActive")?.Value, out var isActive) && isActive);
    }
}
