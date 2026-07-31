using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/auth");

        group.MapPost("/login", LoginAsync);
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        var email = request.Email.ToLowerInvariant();
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Email == email && u.IsActive, cancellationToken);

        if (user is null)
        {
            return Results.Json(new ErrorResponse("Invalid email or password"), statusCode: 401);
        }

        if (user.PasswordHash is null)
        {
            return Results.Json(new ErrorResponse("This account uses Google sign-in"), statusCode: 401);
        }

        if (!passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            return Results.Json(new ErrorResponse("Invalid email or password"), statusCode: 401);
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var token = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId.ToString(),
            IsActive: user.IsActive));

        return Results.Ok(new TokenResponse(token));
    }
}

public sealed record LoginRequest(string Email, string Password);
public sealed record TokenResponse(string Token);
public sealed record ErrorResponse(string Message);
