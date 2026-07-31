using System.Security.Claims;

namespace ClimateProject.Application.Auth;

public sealed record CurrentUser(
    string Sub,
    string Role,
    string? NodoId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive);

public static class ClaimsPrincipalExtensions
{
    public static CurrentUser GetCurrentUser(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirst("sub")?.Value
            ?? throw new InvalidOperationException("Token is missing the required 'sub' claim.");

        var nodoId = principal.FindFirst("nodoId")?.Value;

        return new CurrentUser(
            Sub: sub,
            Role: principal.FindFirst("role")?.Value ?? string.Empty,
            NodoId: string.IsNullOrEmpty(nodoId) ? null : nodoId,
            Email: principal.FindFirst("email")?.Value ?? string.Empty,
            Name: principal.FindFirst("name")?.Value ?? string.Empty,
            CompanyId: principal.FindFirst("companyId")?.Value ?? string.Empty,
            IsActive: bool.TryParse(principal.FindFirst("isActive")?.Value, out var isActive) && isActive);
    }
}
