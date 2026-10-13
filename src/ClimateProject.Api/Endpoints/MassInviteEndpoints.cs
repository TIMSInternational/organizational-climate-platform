using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>POST /admin/users/{userId}/credentials</c>: send a mass-invite account a fresh password
/// (ruled 2026-10-13: "resend issues a new password, the username is kept").
///
/// <para>
/// A resend cannot repeat the old password, because only its hash was ever stored. So it
/// replaces it, ends every session the old one opened (the security stamp, as
/// <c>/auth/admin/reset-credentials</c> does), and emails the new pair. The response says
/// whether the email went out and never carries the password: the person it belongs to reads
/// it in their inbox, not the administrator on a screen.
/// </para>
/// </summary>
public static class MassInviteEndpoints
{
    public static void MapMassInviteEndpoints(this WebApplication app)
    {
        app.MapPost("/admin/users/{userId:guid}/credentials", ResendAsync).RequireAuthorization();
    }

    private static async Task<IResult> ResendAsync(
        Guid userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        ICredentialsEmailSender credentialsSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

        // The same rule as the import that created the account: a super admin anywhere, a company
        // admin in their own company. Someone else's user is a 404, not a 403, so this route does
        // not confirm which ids exist in another tenant.
        var allowed = user?.CompanyId is { } companyId
            && (currentUser.Role == Roles.SuperAdmin
                || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString()));
        if (user is null || !allowed)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (user.Username is null)
        {
            return Results.Json(
                new { message = "This account signs in by email; it has no generated sign-in details to resend.", code = "not_mass_invite" },
                statusCode: 409);
        }

        if (!user.IsActive)
        {
            return Results.Json(new { message = "This account is deactivated.", code = "inactive" }, statusCode: 409);
        }

        var password = MassInviteCredentials.Password();
        user.PasswordHash = passwordHasher.Hash(password);
        user.SecurityStamp = Guid.NewGuid();
        user.UpdatedAt = DateTimeOffset.UtcNow;

        // Saved before the email, as every invitation is: an email whose password no row backs
        // would sign nobody in, and the person could not tell that from a typo.
        await db.SaveChangesAsync(cancellationToken);

        var language = await db.Companies
            .Where(c => c.Id == user.CompanyId)
            .Select(c => c.Settings.Language)
            .FirstOrDefaultAsync(cancellationToken);
        var outcome = await credentialsSender.SendAsync(user.Email, user.Username, password, language, cancellationToken);

        return Results.Ok(new CredentialsResendResult(outcome.Delivered, outcome.Delivered ? null : outcome.FailureReason));
    }
}

/// <param name="Delivered">Whether the email went out. The new password is already in force either way; send again to retry.</param>
public sealed record CredentialsResendResult(bool Delivered, string? FailureReason);
