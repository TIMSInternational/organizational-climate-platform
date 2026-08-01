using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationAcceptEndpoints
{
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

            var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == invitation.CompanyId, cancellationToken);
            var candidateEmail = request.Email.ToLowerInvariant();
            var domain = candidateEmail.Contains('@') ? candidateEmail.Split('@')[1] : string.Empty;
            if (company?.EmailDomain is not null && domain != company.EmailDomain)
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

        invitation.Status = InvitationValidation.StatusAccepted;
        invitation.AcceptedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        var jwt = jwtTokenService.IssueToken(new TokenClaims(
            Sub: user.PersonaExternalId ?? user.Id.ToString(),
            Role: user.Role,
            NodoId: user.NodoId,
            Email: user.Email,
            Name: user.Name,
            CompanyId: user.CompanyId.ToString(),
            IsActive: user.IsActive));

        return Results.Json(new TokenResponse(jwt), statusCode: 201);
    }
}
