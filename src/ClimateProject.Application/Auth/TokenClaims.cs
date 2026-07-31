namespace ClimateProject.Application.Auth;

public sealed record TokenClaims(
    string Sub,
    string Role,
    string? NodoId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive);
