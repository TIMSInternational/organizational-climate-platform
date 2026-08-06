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

        var gate = await CheckSystemSettingsGateAsync(db, user.Role, cancellationToken);
        if (gate is not null)
        {
            return gate;
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var token = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
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

        // Signup has no existing user yet to check for a SuperAdmin bypass -- a fresh
        // signup is always minted as Roles.Employee below, so the platform-wide kill
        // switches apply unconditionally here (unlike LoginAsync/GoogleLoginAsync).
        var signupGate = await CheckSystemSettingsGateAsync(db, currentUserRole: null, cancellationToken);
        if (signupGate is not null)
        {
            return signupGate;
        }

        var minPasswordLength = await GetMinPasswordLengthAsync(db, cancellationToken);
        if (request.Password.Length < minPasswordLength)
        {
            return Results.Json(new ErrorResponse($"Password must be at least {minPasswordLength} characters long"), statusCode: 400);
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
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
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

        // Read-only lookup (AsNoTracking) purely to resolve a SuperAdmin bypass for the
        // kill-switch gate below, before any company/user rows get written. A tracked
        // re-fetch happens further down for the actual create-or-update.
        var existingUserForGate = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        var googleGate = await CheckSystemSettingsGateAsync(db, existingUserForGate?.Role, cancellationToken);
        if (googleGate is not null)
        {
            return googleGate;
        }

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
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
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
        var sub = currentUser.Sub;

        // Sub is minted as PersonaExternalId when set, otherwise the user's own Guid Id
        // (see LoginAsync/SignupAsync/GoogleLoginAsync/RefreshAsync). It is not always a
        // parseable Guid, so match on PersonaExternalId first and only attempt an Id match
        // when the value does parse as one — never let a non-Guid Sub throw here.
        var user = Guid.TryParse(sub, out var userId)
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == userId || u.PersonaExternalId == sub, cancellationToken)
            : await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == sub, cancellationToken);
        if (user is null || !user.IsActive)
        {
            return Results.Json(new ErrorResponse("Account is no longer active"), statusCode: 401);
        }

        var token = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
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
        //
        // Compares Guids, not strings. This used to read `u.CompanyId.ToString() ==
        // currentUser.CompanyId`; once User.CompanyId became Guid? (#191) that receiver is
        // Nullable<Guid>, whose ToString() is a DIFFERENT method that EF cannot translate --
        // it would have thrown "could not be translated" at runtime, not compile time.
        // Parsing the claim up front also means a company-less super_admin (claim is
        // string.Empty) yields null here, so the tenant branch matches nothing at all
        // instead of matching every company-less row.
        var actingCompanyId = CompanyScope.OwnCompanyId(currentUser);
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.Id == request.UserId
                && (currentUser.Role == Roles.SuperAdmin
                    || (actingCompanyId != null && u.CompanyId == actingCompanyId)),
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

    // Platform-wide incident-response kill switches (SystemSettings.LoginEnabled /
    // MaintenanceMode). Read-only -- deliberately does NOT call
    // SystemSettingsEndpoints.GetOrCreateAsync, so a login/signup attempt never
    // has the side effect of creating the singleton row; a missing row is treated
    // as "defaults" (LoginEnabled=true, MaintenanceMode=false), i.e. no gating.
    // currentUserRole is null for a brand-new signup (no existing user yet) or an
    // unresolved Google sign-in -- in both cases there is no SuperAdmin to bypass
    // the gate with.
    private static async Task<IResult?> CheckSystemSettingsGateAsync(
        ClimateProjectDbContext db,
        string? currentUserRole,
        CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is null || currentUserRole == Roles.SuperAdmin)
        {
            return null;
        }

        if (settings.MaintenanceMode)
        {
            return Results.Json(
                new ErrorResponse(settings.MaintenanceMessage ?? "The system is currently under maintenance. Please try again later."),
                statusCode: 503);
        }

        if (!settings.LoginEnabled)
        {
            return Results.Json(new ErrorResponse("Login is currently disabled by an administrator."), statusCode: 403);
        }

        return null;
    }

    // Falls back to the same default (8) as SystemSettings.PasswordPolicy.MinLength
    // when no settings row exists yet, matching the hardcoded rule this replaces.
    private static async Task<int> GetMinPasswordLengthAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
        return settings?.PasswordPolicy.MinLength ?? 8;
    }
}

public sealed record LoginRequest(string Email, string Password);
public sealed record SignupRequest(string Name, string Email, string Password);
public sealed record GoogleLoginRequest(string IdToken);
public sealed record TokenResponse(string Token);
public sealed record ErrorResponse(string Message);
public sealed record ResetCredentialsRequest(Guid UserId);
public sealed record ResetCredentialsResponse(string Email, string TemporaryPassword);
