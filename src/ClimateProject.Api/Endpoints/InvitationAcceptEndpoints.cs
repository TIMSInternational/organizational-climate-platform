using System.Text.RegularExpressions;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
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
        app.MapPost("/invitations/{token}/accept", AcceptAsync);
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

        if (request.Password.Length < 8)
        {
            return Results.Json(new { message = "Password must be at least 8 characters long" }, statusCode: 400);
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

        var jwt = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId?.ToString() ?? string.Empty,
            IsActive: user.IsActive));

        return Results.Json(new TokenResponse(jwt), statusCode: 201);
    }
}
