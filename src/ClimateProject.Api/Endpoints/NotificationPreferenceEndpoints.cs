using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Self-service notification preferences (#103).
///
/// Mounted at <c>/me/notification-preferences</c> with **no user id in the route**. That is
/// the authorization design, not a shortcut: the acceptance criterion is that no user can
/// read or write another user's preferences, and an endpoint that takes no target cannot be
/// pointed at one. The alternative -- <c>/admin/users/{id}/notification-preferences</c> plus
/// a "is this me?" guard -- makes the safe behaviour depend on a check that a later edit can
/// drop. Note this is a *per-user* rule, not the per-company rule the rest of the codebase
/// uses: a CompanyAdmin must not read a colleague's opt-outs either, so
/// <c>CompanyScope.CanAccess</c> is deliberately not consulted anywhere in this file.
///
/// Lives in its own file rather than in the <c>NotificationEndpoints.cs</c> that #97 will
/// add, so the two land without touching each other.
/// </summary>
public static class NotificationPreferenceEndpoints
{
    public static void MapNotificationPreferenceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/me/notification-preferences").RequireAuthorization();

        group.MapGet("", GetAsync);
        group.MapPut("", UpdateAsync);
    }

    /// <summary>
    /// Resolves the caller's own row from their token.
    ///
    /// Sub is minted as <c>PersonaExternalId</c> when set and the user's Guid Id otherwise
    /// (see <c>AuthEndpoints</c>), so it is not always a parseable Guid -- match on
    /// PersonaExternalId first and only attempt an Id match when the value does parse.
    /// </summary>
    private static Task<User?> FindSelfAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var sub = currentUser.Sub;
        return Guid.TryParse(sub, out var userId)
            ? db.Users.FirstOrDefaultAsync(u => u.Id == userId || u.PersonaExternalId == sub, cancellationToken)
            : db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == sub, cancellationToken);
    }

    private static async Task<IResult> GetAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await FindSelfAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        return Results.Ok(NotificationPreferenceUpdate.ToResponse(user.Notifications));
    }

    private static async Task<IResult> UpdateAsync(
        UpdateNotificationPreferencesRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await FindSelfAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        var errors = NotificationPreferenceUpdate.Validate(request);
        if (errors.Count > 0)
        {
            return Results.Json(new { message = string.Join("; ", errors) }, statusCode: 400);
        }

        NotificationPreferenceUpdate.Apply(user.Notifications, request);
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(NotificationPreferenceUpdate.ToResponse(user.Notifications));
    }
}
