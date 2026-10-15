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
        app.MapPost("/admin/users/credentials", ResendManyAsync).RequireAuthorization();
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
        // The INVITATION copy, not the reminder: this route is one administrator fixing one
        // person, who most often never received the first message or lost it. The bulk route
        // below is the one that chases people who did receive it.
        var outcome = await credentialsSender.SendAsync(
            user.Email, user.Username, password, language, CredentialsEmailPurpose.Invitation, cancellationToken);

        return Results.Ok(new CredentialsResendResult(outcome.Delivered, outcome.Delivered ? null : outcome.FailureReason));
    }

    /// <summary>
    /// The batch an administrator chasing a launch actually needs: pick the people who have
    /// not finished and send them all their sign-in details again.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Inline, not queued, and that is the privacy decision.</b> Every other bulk mail in
    /// this product writes a <c>notifications</c> row and lets the dispatch worker drain it.
    /// This one cannot: the plaintext password exists for exactly as long as it takes to hash
    /// it, and queueing would mean writing it into a row and leaving it there until a worker
    /// ran. A password at rest in the database is a worse outcome than a slower request.
    /// </para>
    /// <para>
    /// <b>Hence the cap.</b> Sending is network-bound and holds a database connection for the
    /// length of the request, and this deployment has forty of them across four instances. The
    /// client sends <see cref="MaxBatch"/> at a time and reports progress across the chunks,
    /// which also means a failure costs one chunk rather than the whole roster.
    /// </para>
    /// <para>
    /// <b>Every person is reported, including the ones who got nothing.</b> A row that is not
    /// a mass-invite account, is deactivated, or belongs to another tenant comes back with its
    /// own code rather than silently shrinking the count -- the defect #558 exists to prevent,
    /// one layer up.
    /// </para>
    /// <para>
    /// <b>The old password dies for each person sent.</b> Same rule as the single resend, in
    /// bulk: ruled 2026-10-14 after the client asked that a reminder carry the username and
    /// password again. Someone who kept their first password and was halfway through is signed
    /// out until they read the new mail, which is why the copy says the details replace the
    /// previous ones.
    /// </para>
    /// </remarks>
    private static async Task<IResult> ResendManyAsync(
        ResendCredentialsBatchRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        ICredentialsEmailSender credentialsSender,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var requested = (request.UserIds ?? []).Distinct().ToList();
        if (requested.Count == 0)
        {
            return Results.Json(new { message = "Name at least one person to send sign-in details to." }, statusCode: 400);
        }

        if (requested.Count > MaxBatch)
        {
            return Results.Json(
                new
                {
                    message = $"Send at most {MaxBatch} at a time; this asked for {requested.Count}.",
                    code = "batch_too_large",
                    maxBatch = MaxBatch,
                },
                statusCode: 400);
        }

        var currentUser = principal.GetCurrentUser();
        var users = await db.Users
            .Where(u => requested.Contains(u.Id))
            .ToListAsync(cancellationToken);
        var byId = users.ToDictionary(u => u.Id);

        var outcomes = new List<CredentialsResendOutcome>(requested.Count);

        foreach (var userId in requested)
        {
            byId.TryGetValue(userId, out var user);

            // The same rule as the single route: a super admin anywhere, a company admin in
            // their own company. Someone else's user is "not found", so a batch cannot be used
            // to probe which ids exist in another tenant.
            var allowed = user?.CompanyId is { } companyId
                && (currentUser.Role == Roles.SuperAdmin
                    || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString()));

            if (user is null || !allowed)
            {
                outcomes.Add(new CredentialsResendOutcome(userId, null, false, "User not found", "not_found"));
                continue;
            }

            if (user.Username is null)
            {
                outcomes.Add(new CredentialsResendOutcome(
                    userId, user.Email, false, "This account signs in by email; it has no generated sign-in details to resend.", "not_mass_invite"));
                continue;
            }

            if (!user.IsActive)
            {
                outcomes.Add(new CredentialsResendOutcome(userId, user.Email, false, "This account is deactivated.", "inactive"));
                continue;
            }

            var password = MassInviteCredentials.Password();
            user.PasswordHash = passwordHasher.Hash(password);
            user.SecurityStamp = Guid.NewGuid();
            user.UpdatedAt = DateTimeOffset.UtcNow;

            // Saved per person, before their email: a password mailed to someone whose row did
            // not save would sign nobody in, and one failure must not roll back the people
            // already sent. The batch is deliberately not one transaction for that reason.
            await db.SaveChangesAsync(cancellationToken);

            var language = await db.Companies
                .Where(c => c.Id == user.CompanyId)
                .Select(c => c.Settings.Language)
                .FirstOrDefaultAsync(cancellationToken);

            // The REMINDER copy. Everyone in this batch was picked off a roster for not having
            // finished, so the message asks them to go in and finish rather than announcing an
            // account they already know about.
            var outcome = await credentialsSender.SendAsync(
                user.Email, user.Username, password, language, CredentialsEmailPurpose.Reminder, cancellationToken);
            outcomes.Add(new CredentialsResendOutcome(
                userId,
                user.Email,
                outcome.Delivered,
                outcome.Delivered ? null : outcome.FailureReason,
                outcome.Delivered ? null : "send_failed"));
        }

        return Results.Ok(new CredentialsResendBatchResult(
            requested.Count,
            outcomes.Count(o => o.Delivered),
            outcomes.Count(o => !o.Delivered),
            outcomes));
    }

    /// <summary>
    /// How many people one request may mail. See <see cref="ResendManyAsync"/> for why there is
    /// a cap at all; the number is the client's chunk size, not a limit on the roster.
    /// </summary>
    public const int MaxBatch = 100;
}

/// <param name="Delivered">Whether the email went out. The new password is already in force either way; send again to retry.</param>
public sealed record CredentialsResendResult(bool Delivered, string? FailureReason);

/// <param name="UserIds">Who to send to. Duplicates are collapsed; order is not significant.</param>
public sealed record ResendCredentialsBatchRequest(IReadOnlyList<Guid>? UserIds);

/// <param name="Code">
/// Machine-readable, and null when the send succeeded: <c>not_found</c>, <c>not_mass_invite</c>,
/// <c>inactive</c> or <c>send_failed</c>. The client renders these through its own i18n.
/// </param>
/// <param name="Email">Null only when the person could not be identified at all.</param>
public sealed record CredentialsResendOutcome(Guid UserId, string? Email, bool Delivered, string? FailureReason, string? Code);

/// <param name="Sent">People whose mail went out. Each of them has a NEW password; the old one no longer works.</param>
public sealed record CredentialsResendBatchResult(
    int Requested,
    int Sent,
    int Failed,
    IReadOnlyList<CredentialsResendOutcome> Outcomes);
