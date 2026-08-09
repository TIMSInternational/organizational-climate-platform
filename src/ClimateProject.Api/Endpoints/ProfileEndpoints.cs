using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Profile;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The caller's own account (#136), replacing legacy <c>api/profile</c>,
/// <c>api/profile/activity</c>, <c>api/profile/password</c> and
/// <c>api/profile/preferences</c>.
///
/// ## The authorization rule here is NOT the one used almost everywhere else
///
/// Nearly every route in this codebase is **company-scoped**: SuperAdmin, or CompanyAdmin
/// whose claim matches the target's company (<c>CompanyScope.CanAccess</c>). These routes
/// are scoped **per user**, and the role is never consulted at all.
///
/// The distinction is load-bearing in both directions:
///
/// * A CompanyAdmin -- even a SuperAdmin -- must not reach an employee's profile, password
///   or activity through this group. Administrative access to another user's row exists,
///   deliberately, at <c>/admin/users/{id}</c> and <c>/auth/admin/reset-credentials</c>,
///   where it is role-checked and auditable as an *administrative* act.
/// * A plain employee must reach every one of these routes. They own the account.
///
/// The mechanism that makes both true is that **no route in this group takes a user id**.
/// There is no id to tamper with, no id to omit, and no code path that resolves a target
/// from anything but the caller's own token -- which is a stronger guarantee than a
/// correctly written ownership check, because there is nothing to write incorrectly. Same
/// shape as the self-service half of <c>NotificationEndpoints</c>, and there is a test that
/// a second user's data is unreachable from here.
///
/// ## Preferences: one store, two views
///
/// <c>/profile/preferences</c> does not introduce a second preferences store. Its
/// notification half is the same six <c>users.notifications_*</c> columns that
/// <c>/notifications/preferences</c> (#103/#97) reads and writes, run through the same
/// <see cref="NotificationPreferenceUpdate"/> helper -- same validation, same partial
/// semantics, same untouched <c>PushNotifications</c>. Its display half is
/// <c>users.preferences_*</c>, which nothing exposed before. See
/// <see cref="ProfilePreferencesResponse"/>.
/// </summary>
public static class ProfileEndpoints
{
    /// <summary>Activity entries returned when the caller does not ask for a size.</summary>
    private const int DefaultActivityPageSize = 25;

    /// <summary>
    /// Upper bound on one activity page. Bounded for the same reason the notification lists
    /// are: a long-lived account should not be able to pull its entire audit history in one
    /// request.
    /// </summary>
    private const int MaxActivityPageSize = 200;

    /// <summary>Matches the <c>users.name</c> column width.</summary>
    private const int NameMaxLength = 200;

    public static void MapProfileEndpoints(this WebApplication app)
    {
        // No role gate on the group and none inside any handler: every authenticated role,
        // plain employees included, owns a profile. See the class remarks.
        var group = app.MapGroup("/profile").RequireAuthorization();

        group.MapGet("", GetAsync);
        group.MapPut("", UpdateAsync);

        // PUT, not POST: changing a password is idempotent replacement of one field on the
        // caller's own row, and the verb difference from POST /auth/admin/reset-credentials
        // is one more thing keeping the self-service path and the admin path from being
        // mistaken for each other.
        group.MapPut("/password", ChangePasswordAsync);

        group.MapGet("/activity", GetActivityAsync);
        group.MapGet("/preferences", GetPreferencesAsync);
        group.MapPut("/preferences", UpdatePreferencesAsync);
    }

    /// <summary>
    /// The acting user's own row -- the only row any handler in this file may touch.
    ///
    /// The <c>sub</c> claim is <c>PersonaExternalId ?? Id</c> (see <c>AuthEndpoints</c>), so
    /// both shapes have to be tried. Its own private copy rather than a call into
    /// <c>NotificationEndpoints</c>, matching how <c>ReportEndpoints</c>,
    /// <c>BenchmarkEndpoints</c> and <c>NotificationTemplateEndpoints</c> each carry theirs:
    /// the endpoint files in this directory do not reach into one another.
    ///
    /// Returns null rather than a default when nothing resolves, and every caller turns that
    /// into a 403. An unresolvable caller must never fall through to "the row whose id is
    /// all zeroes" or to "the first user".
    /// </summary>
    private static async Task<User?> ResolveCurrentUserAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null)
            {
                return byId;
            }
        }

        return await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
    }

    private static async Task<ProfileResponse> ToResponseAsync(
        User user,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        // Names, not ids: this page is read by the person themselves, and "which department
        // am I in" is not answerable by a Guid. Both are separate lookups rather than
        // Includes because User has no navigation properties -- the FKs are configured
        // without them (see UserConfiguration).
        var companyName = user.CompanyId is { } companyId
            ? await db.Companies.Where(c => c.Id == companyId).Select(c => c.Name).FirstOrDefaultAsync(cancellationToken)
            : null;

        var departmentName = user.DepartmentId is { } departmentId
            ? await db.Departments.Where(d => d.Id == departmentId).Select(d => d.Name).FirstOrDefaultAsync(cancellationToken)
            : null;

        var demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);

        return new ProfileResponse(
            user.Id,
            user.CompanyId,
            companyName,
            user.Email,
            user.Name,
            user.Role,
            user.DepartmentId,
            departmentName,
            user.ManagerId,
            user.IsActive,
            // The flag, never the hash. Nothing in this file ever projects PasswordHash.
            HasPassword: user.PasswordHash is not null,
            user.LastLoginAt,
            user.CreatedAt,
            demographics);
    }

    /// <summary>
    /// Records one self-caused event on the caller's own account, for
    /// <c>GET /profile/activity</c> to read back.
    ///
    /// Skipped entirely for a user with no company. <c>audit_logs.company_id</c> is NOT NULL
    /// with a restricting FK to <c>companies</c>, so a global super_admin (#191) has no
    /// company row to attribute an entry to; inventing one, or widening the column, is a
    /// schema change this issue deliberately does not make (it would collide with the
    /// migration another branch already has outstanding). The consequence is bounded and
    /// visible: a company-less super_admin's activity list is empty, and their profile
    /// edits still succeed.
    ///
    /// Does not save -- the caller decides when, so the audit row and the change it
    /// describes land in the same <c>SaveChangesAsync</c> and cannot disagree.
    /// </summary>
    private static void AddActivity(
        ClimateProjectDbContext db,
        User user,
        string action,
        bool success,
        DateTimeOffset now)
    {
        if (user.CompanyId is not { } companyId)
        {
            return;
        }

        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            CompanyId = companyId,
            Action = action,
            Resource = ProfileAuditActions.Resource,
            ResourceId = user.Id.ToString(),
            Success = success,
            Timestamp = now,
        });
    }

    private static async Task<IResult> GetAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToResponseAsync(user, db, cancellationToken));
    }

    /// <summary>
    /// Change the caller's own display name. Nothing else is editable here -- see
    /// <see cref="UpdateProfileRequest"/>.
    /// </summary>
    private static async Task<IResult> UpdateAsync(
        UpdateProfileRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        // Rejected rather than ignored. `/admin/users/{id}` treats a blank name as "leave it
        // alone", which is right for a partial admin edit of somebody else's row; here the
        // name is the only field there is, so a blank one is a person clearing their own
        // name and expecting it to stick. Silently keeping the old value would look like a
        // successful save that did nothing.
        if (request.Name is null || string.IsNullOrWhiteSpace(request.Name))
        {
            return Results.Json(new { message = "Name is required" }, statusCode: 400);
        }

        var name = request.Name.Trim();
        if (name.Length > NameMaxLength)
        {
            return Results.Json(
                new { message = $"Name must be at most {NameMaxLength} characters long" },
                statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        user.Name = name;
        user.UpdatedAt = now;
        AddActivity(db, user, ProfileAuditActions.Update, success: true, now);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToResponseAsync(user, db, cancellationToken));
    }

    /// <summary>
    /// Change the caller's own password, proving they know the current one.
    ///
    /// The current-password check is not a formality -- it is what stops an unattended
    /// session, a stolen token or an XSS payload from converting temporary access into
    /// permanent account takeover. It is verified with the same
    /// <see cref="IPasswordHasher"/> as login, so a wrong password fails here exactly as it
    /// would there.
    ///
    /// Note what this route does NOT do, in contrast with
    /// <c>POST /auth/admin/reset-credentials</c>: it accepts no user id, requires no role,
    /// generates nothing, and returns no password in its response.
    /// </summary>
    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IPasswordHasher passwordHasher,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        if (string.IsNullOrEmpty(request.CurrentPassword) || string.IsNullOrEmpty(request.NewPassword))
        {
            return Results.Json(
                new { message = "Current password and new password are required" },
                statusCode: 400);
        }

        if (user.PasswordHash is null)
        {
            // A Google-only account has no current password to prove knowledge of, so there
            // is no safe way to let this route set one: it would be an unauthenticated-in-
            // practice way to add a second credential to somebody else's session. Same
            // wording as LoginAsync's, which is the other place this state surfaces.
            return Results.Json(new { message = "This account uses Google sign-in" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;

        if (!passwordHasher.Verify(request.CurrentPassword, user.PasswordHash))
        {
            // Recorded before returning: a run of these on one's own account is exactly what
            // an activity history is for. Saved on its own, since nothing else changed.
            AddActivity(db, user, ProfileAuditActions.PasswordChange, success: false, now);
            await db.SaveChangesAsync(cancellationToken);

            // 400, not 401. A 401 would be indistinguishable from an expired session and
            // would send the client's authFetch straight to the login page, discarding the
            // form -- the caller's token is perfectly valid, it is the supplied password
            // that is wrong.
            return Results.Json(new { message = "Current password is incorrect" }, statusCode: 400);
        }

        var policy = await GetPasswordPolicyAsync(db, cancellationToken);
        if (PasswordPolicyValidation.Validate(request.NewPassword, policy) is { } policyError)
        {
            return Results.Json(new { message = policyError }, statusCode: 400);
        }

        if (passwordHasher.Verify(request.NewPassword, user.PasswordHash))
        {
            return Results.Json(
                new { message = "New password must be different from the current password" },
                statusCode: 400);
        }

        user.PasswordHash = passwordHasher.Hash(request.NewPassword);
        user.UpdatedAt = now;
        AddActivity(db, user, ProfileAuditActions.PasswordChange, success: true, now);
        await db.SaveChangesAsync(cancellationToken);

        // No body. There is nothing to say that the status code does not, and a password
        // route is the last place to start echoing state back.
        return Results.NoContent();
    }

    /// <summary>
    /// Falls back to the same defaults as <c>SystemSettings.PasswordPolicy</c> when no
    /// settings row exists yet, and -- like <c>AuthEndpoints.CheckSystemSettingsGateAsync</c>
    /// -- deliberately does not create one as a side effect of a password change.
    /// </summary>
    private static async Task<PasswordPolicy> GetPasswordPolicyAsync(
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return settings?.PasswordPolicy ?? new PasswordPolicy();
    }

    /// <summary>
    /// The caller's own audit trail, most recent first.
    ///
    /// Filtered on <c>user_id</c> and nothing else, so it cannot return another person's
    /// entries even inside the caller's own company.
    /// </summary>
    private static async Task<IResult> GetActivityAsync(
        int? limit,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        var pageSize = Math.Clamp(limit ?? DefaultActivityPageSize, 1, MaxActivityPageSize);

        var activity = await db.AuditLogs
            .AsNoTracking()
            .Where(a => a.UserId == user.Id)
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Take(pageSize)
            .Select(a => new ProfileActivityItem(a.Id, a.Action, a.Resource, a.ResourceId, a.Success, a.Timestamp))
            .ToListAsync(cancellationToken);

        return Results.Ok(new ProfileActivityResponse(activity));
    }

    private static async Task<IResult> GetPreferencesAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        return Results.Ok(new ProfilePreferencesResponse(
            ProfilePreferenceUpdate.ToResponse(user.Preferences),
            NotificationPreferenceUpdate.ToResponse(user.Notifications)));
    }

    /// <summary>
    /// Change the caller's own preferences, in whole or in part.
    ///
    /// Both halves validate to completion before either is written, so a request whose
    /// display half is valid and whose notification half is not leaves everything as it was.
    /// Splitting that -- saving the good half -- would be the worst outcome on a surface that
    /// carries consent flags: the user would be told the save failed while some of it had
    /// already happened.
    /// </summary>
    private static async Task<IResult> UpdatePreferencesAsync(
        UpdateProfilePreferencesRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var user = await ResolveCurrentUserAsync(principal.GetCurrentUser(), db, cancellationToken);
        if (user is null)
        {
            return Results.Forbid();
        }

        // Validated against detached copies first, so neither helper's in-place write lands
        // unless both would succeed.
        var display = new UserPreferences
        {
            Language = user.Preferences.Language,
            Timezone = user.Preferences.Timezone,
            Theme = user.Preferences.Theme,
            DashboardLayout = user.Preferences.DashboardLayout,
        };

        if (!ProfilePreferenceUpdate.TryApply(display, request, out var displayError))
        {
            return Results.Json(new { message = displayError }, statusCode: 400);
        }

        var notifications = new NotificationPreferences
        {
            EmailSurveys = user.Notifications.EmailSurveys,
            EmailMicroclimates = user.Notifications.EmailMicroclimates,
            EmailActionPlans = user.Notifications.EmailActionPlans,
            EmailReminders = user.Notifications.EmailReminders,
            PushNotifications = user.Notifications.PushNotifications,
            DigestFrequency = user.Notifications.DigestFrequency,
        };

        if (request.Notifications is { } notificationRequest
            && !NotificationPreferenceUpdate.TryApply(notifications, notificationRequest, out var notificationError))
        {
            return Results.Json(new { message = notificationError }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;

        user.Preferences.Language = display.Language;
        user.Preferences.Timezone = display.Timezone;
        user.Preferences.Theme = display.Theme;

        if (request.Notifications is not null)
        {
            user.Notifications.EmailSurveys = notifications.EmailSurveys;
            user.Notifications.EmailMicroclimates = notifications.EmailMicroclimates;
            user.Notifications.EmailActionPlans = notifications.EmailActionPlans;
            user.Notifications.EmailReminders = notifications.EmailReminders;
            user.Notifications.DigestFrequency = notifications.DigestFrequency;

            // The four email flags are consent state in everything but name, so a change to
            // one is a change to what the user agreed to receive -- stamped exactly as
            // NotificationEndpoints.UpdatePreferencesAsync stamps it, because it is the same
            // store. Only stamped when the notification half was actually addressed: a
            // display-only save is not a consent event.
            user.ConsentUpdatedAt = now;
        }

        user.UpdatedAt = now;
        AddActivity(db, user, ProfileAuditActions.PreferencesUpdate, success: true, now);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new ProfilePreferencesResponse(
            ProfilePreferenceUpdate.ToResponse(user.Preferences),
            NotificationPreferenceUpdate.ToResponse(user.Notifications)));
    }
}
