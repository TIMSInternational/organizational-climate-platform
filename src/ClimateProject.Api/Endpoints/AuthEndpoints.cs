using System.Security.Claims;
using System.Text.RegularExpressions;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class AuthEndpoints
{
    // Same simple pattern used by the legacy climate-project codebase for
    // signup email-format validation.
    private const string EmailFormatPattern = @"^[^\s@]+@[^\s@]+\.[^\s@]+$";

    public static void MapAuthEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/auth");

        group.MapPost("/login", LoginAsync);
        group.MapPost("/signup", SignupAsync);
        group.MapPost("/google", GoogleLoginAsync);
        group.MapPost("/refresh", RefreshAsync).RequireAuthorization();
        group.MapPost("/admin/reset-credentials", ResetCredentialsAsync).RequireAuthorization();
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new ErrorResponse("Email and password are required"), statusCode: 400);
        }

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

        if (!Regex.IsMatch(request.Email, EmailFormatPattern))
        {
            return Results.Json(new ErrorResponse("Invalid email format"), statusCode: 400);
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

    private static async Task<IResult> GoogleLoginAsync(
        GoogleLoginRequest request,
        ClimateProjectDbContext db,
        IGoogleTokenVerifier googleTokenVerifier,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdToken))
        {
            return Results.Json(new ErrorResponse("Google ID token is required"), statusCode: 400);
        }

        var googleUser = await googleTokenVerifier.VerifyAsync(request.IdToken, cancellationToken);
        if (googleUser is null)
        {
            return Results.Json(new ErrorResponse("Google sign-in failed"), statusCode: 401);
        }

        var email = googleUser.Email.ToLowerInvariant();
        var domain = email.Split('@')[1];

        var company = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
        if (company is null)
        {
            company = new Company
            {
                Id = Guid.NewGuid(),
                Name = $"{char.ToUpperInvariant(domain[0])}{domain[1..]} Organization",
                EmailDomain = domain,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Companies.Add(company);
            await db.SaveChangesAsync(cancellationToken);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        if (user is null)
        {
            user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = company.Id,
                Email = email,
                Name = googleUser.Name,
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(user);
        }

        user.LastLoginAt = now;
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

    private static async Task<IResult> ResetCredentialsAsync(
        ResetCredentialsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        // Scoped to the admin's own company unless they're a super_admin, mirroring
        // the legacy User.canAccessCompany behavior (super_admin can access any
        // company). Returns 404 -- not 403 -- on a tenant mismatch so this endpoint
        // doesn't leak the existence of users in other companies.
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.Id == request.UserId
                && (currentUser.Role == Roles.SuperAdmin || u.CompanyId.ToString() == currentUser.CompanyId),
            cancellationToken);
        if (user is null)
        {
            return Results.Json(new ErrorResponse("User not found"), statusCode: 404);
        }

        var temporaryPassword = Guid.NewGuid().ToString("N")[..12];
        user.PasswordHash = passwordHasher.Hash(temporaryPassword);
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new ResetCredentialsResponse(user.Email, temporaryPassword));
    }
}

public sealed record LoginRequest(string Email, string Password);
public sealed record SignupRequest(string Name, string Email, string Password);
public sealed record GoogleLoginRequest(string IdToken);
public sealed record TokenResponse(string Token);
public sealed record ErrorResponse(string Message);
public sealed record ResetCredentialsRequest(Guid UserId);
public sealed record ResetCredentialsResponse(string Email, string TemporaryPassword);
