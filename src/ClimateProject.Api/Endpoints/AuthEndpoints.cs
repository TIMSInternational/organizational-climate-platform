using System.Security.Claims;
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
        group.MapPost("/signup", SignupAsync);
        group.MapPost("/refresh", RefreshAsync).RequireAuthorization();
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

    private static async Task<IResult> SignupAsync(
        SignupRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new ErrorResponse("Name, email, and password are required"), statusCode: 400);
        }

        if (request.Password.Length < 8)
        {
            return Results.Json(new ErrorResponse("Password must be at least 8 characters long"), statusCode: 400);
        }

        var email = request.Email.ToLowerInvariant();

        var existingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (existingUser is not null)
        {
            return Results.Json(new ErrorResponse("User with this email already exists"), statusCode: 409);
        }

        var domain = email.Split('@')[1];
        var company = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
        if (company is null)
        {
            return Results.Json(
                new ErrorResponse("No company found for this email domain. Please contact your administrator for an invitation."),
                statusCode: 404);
        }

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = email,
            Name = request.Name.Trim(),
            PasswordHash = passwordHasher.Hash(request.Password),
            Role = Roles.Employee,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);

        var token = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId.ToString(),
            IsActive: user.IsActive));

        return Results.Json(new TokenResponse(token), statusCode: 201);
    }

    private static async Task<IResult> RefreshAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var userId = Guid.Parse(currentUser.Sub);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null || !user.IsActive)
        {
            return Results.Json(new ErrorResponse("Account is no longer active"), statusCode: 401);
        }

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
public sealed record SignupRequest(string Name, string Email, string Password);
public sealed record TokenResponse(string Token);
public sealed record ErrorResponse(string Message);
