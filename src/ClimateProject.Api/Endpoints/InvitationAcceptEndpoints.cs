using System.Text.RegularExpressions;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationAcceptEndpoints
{
    // Same pattern used by AuthEndpoints for /auth/signup -- this endpoint is
    // unauthenticated, so the shareable-link email it's handed needs the same
    // format validation a self-signup email gets, not just a `Contains('@')` check.
    private const string EmailFormatPattern = @"^[^\s@]+@[^\s@]+\.[^\s@]+$";

    public static void MapInvitationAcceptEndpoints(this WebApplication app)
    {
        // Unauthenticated and token-addressed, so it is rate limited per token rather than
        // per caller (#146): the attack this bounds is one invitation being replayed or
        // brute-forced, which a botnet would otherwise spread across enough addresses that a
        // caller-keyed limit never fires. See RateLimitPolicies.PartitionPublicToken.
        app.MapPost("/invitations/{token}/accept", AcceptAsync)
            .RequireRateLimiting(RateLimitPolicies.PublicToken);
    }

    private static async Task<IResult> AcceptAsync(
        string token,
        AcceptInvitationRequest request,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenService jwtTokenService,
        CancellationToken cancellationToken)
    {
        var invitation = await db.UserInvitations.FirstOrDefaultAsync(i => i.InvitationToken == token, cancellationToken);
        if (invitation is null)
        {
            return Results.Json(new { message = "Invitation not found" }, statusCode: 404);
        }

        if (invitation.Status == InvitationValidation.StatusAccepted)
        {
            return Results.Json(new { message = "Invitation has already been accepted" }, statusCode: 409);
        }

        if (invitation.ExpiresAt < DateTimeOffset.UtcNow)
        {
            return Results.Json(new { message = "Invitation has expired" }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Password))
        {
            return Results.Json(new { message = "Name and password are required" }, statusCode: 400);
        }

        // The configured policy -- this used to be a hardcoded 8 that read no setting at all,
        // so an administrator's MinLength of 12 was honoured on the profile page and ignored
        // on the one screen where most accounts are created.
        var passwordPolicy = await PasswordPolicies.LoadAsync(db, cancellationToken);
        if (PasswordPolicyValidation.Validate(request.Password, passwordPolicy) is { } passwordError)
        {
            return Results.Json(new { message = passwordError }, statusCode: 400);
        }

        string email;
        if (invitation.Email is not null)
        {
            email = invitation.Email;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(request.Email))
            {
                return Results.Json(new { message = "Email is required for a shareable-link invitation" }, statusCode: 400);
            }

            var candidateEmail = request.Email.ToLowerInvariant();
            if (!Regex.IsMatch(candidateEmail, EmailFormatPattern))
            {
                return Results.Json(new { message = "Invalid email format" }, statusCode: 400);
            }

            var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == invitation.CompanyId, cancellationToken);
            var domain = candidateEmail.Split('@')[1];

            // Require an actual match against the company's configured domain -- a null
            // company.EmailDomain must NOT be treated as "skip the check". Every company
            // reachable through the current API surface has a non-null EmailDomain, but a
            // future null-domain company (e.g. a legacy import) must not silently accept
            // any string as a valid email on this unauthenticated endpoint.
            if (company?.EmailDomain is null || domain != company.EmailDomain)
            {
                return Results.Json(new { message = "Email domain does not match this company" }, statusCode: 400);
            }

            email = candidateEmail;
        }

        var existingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        if (existingUser is not null)
        {
            return Results.Json(new { message = "A user with this email already exists" }, statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = invitation.CompanyId,
            Email = email,
            Name = request.Name.Trim(),
            PasswordHash = passwordHasher.Hash(request.Password),
            Role = invitation.Role,
            DepartmentId = invitation.DepartmentId,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);

        // Carry the demographics pre-assigned on the invitation across to the new
        // user. They were already validated against the company's demographic fields
        // when the invitation was created, so they are copied verbatim -- re-running
        // validation here would strand a member whose company deactivated a field
        // between invitation and acceptance, and their next profile update reconciles
        // it anyway.
        var preassigned = await db.UserInvitationDemographics
            .Where(d => d.InvitationId == invitation.Id)
            .ToListAsync(cancellationToken);

        foreach (var value in preassigned)
        {
            db.UserDemographics.Add(new UserDemographic
            {
                UserId = user.Id,
                DemographicFieldId = value.DemographicFieldId,
                Value = value.Value,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        invitation.Status = InvitationValidation.StatusAccepted;
        invitation.AcceptedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        // Minted through AuthEndpoints.IssueTokenForAsync, not by hand. This path used to
        // build its own TokenClaims, which is why #280's "the single place this API mints a
        // token" was not actually true of it. Nothing was exploitable here -- the row above
        // is always created with IsActive = true and an existing email 409s before we get
        // here -- but the point of the shared helper is that the deactivation guard is
        // unavoidable, and a path that bypasses it cannot deliver that.
        return await AuthEndpoints.IssueTokenForAsync(
            user, db, jwtTokenService,
            Results.Json(new { message = "Account is not active" }, statusCode: 401),
            cancellationToken,
            successStatusCode: 201);
    }
}
