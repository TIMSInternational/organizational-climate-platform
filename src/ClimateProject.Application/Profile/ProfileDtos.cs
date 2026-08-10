using ClimateProject.Application.Notifications;

namespace ClimateProject.Application.Profile;

/// <summary>
/// The caller's own account, as they see it (#136).
///
/// Deliberately NOT <c>UserDetail</c>. That record is the admin view of somebody else's
/// row, and it is reached through a company-scoped guard; this one is reached only by its
/// owner and therefore answers different questions -- "can I change my password here?"
/// (<paramref name="HasPassword"/>), "which department am I in?" by name rather than by
/// id. Sharing one record would mean either the admin list leaks a field it has no reason
/// to carry, or the profile page renders a Guid where a person expects a department name.
/// </summary>
/// <param name="CompanyId">Null for a user with no tenant -- a global super_admin (#191).</param>
/// <param name="HasPassword">
/// False for a Google-only account. The password form is hidden rather than shown and
/// rejected: there is no current password to supply, so the form could never succeed.
/// </param>
public sealed record ProfileResponse(
    Guid Id,
    Guid? CompanyId,
    string? CompanyName,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    string? DepartmentName,
    Guid? ManagerId,
    bool IsActive,
    bool HasPassword,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    IReadOnlyDictionary<string, string> Demographics);

/// <summary>
/// What a person may change about themselves: their display name, and nothing else.
///
/// Email, role, department, manager and <c>IsActive</c> are all deliberately absent. Each
/// is an identity or authorization fact owned by an administrator -- email is the login
/// credential and the tenant key (signup derives <c>CompanyId</c> from its domain), role is
/// the authorization claim, and a self-service <c>IsActive</c> would let a user
/// un-deactivate themselves. They are edited through <c>/admin/users/{id}</c>, which is
/// company-scoped and role-checked; accepting them here would be a second, unguarded door
/// onto the same columns.
/// </summary>
public sealed record UpdateProfileRequest(string? Name);

/// <summary>
/// A self-service password change. **Not the admin reset** -- see
/// <c>AuthEndpoints.ResetCredentialsAsync</c>, which mints a temporary password for
/// *another* user and returns it to an administrator.
///
/// The two are kept apart on purpose, because confusing them is the security failure this
/// issue names: this route takes no user id at all (so it can only ever act on the caller),
/// requires <paramref name="CurrentPassword"/> to verify (so a borrowed session cannot
/// silently take the account over), and returns nothing (so no password is ever echoed).
/// The admin path takes a user id, requires an admin role, and requires no knowledge of the
/// target's password -- exactly the properties this one must not have.
/// </summary>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <summary>
/// One entry of the caller's own activity history, projected from <c>audit_logs</c>.
///
/// <c>Details</c>, <c>IpAddress</c> and <c>UserAgent</c> are stored but not projected:
/// the first is a free-form jsonb blob with no rendering contract, and the latter two say
/// nothing to the account's owner that they do not already know while widening what a
/// stolen session can read out.
/// </summary>
public sealed record ProfileActivityItem(
    Guid Id,
    string Action,
    string Resource,
    string? ResourceId,
    bool Success,
    DateTimeOffset Timestamp);

public sealed record ProfileActivityResponse(IReadOnlyList<ProfileActivityItem> Activity);

/// <summary>
/// The display half of <c>User.Preferences</c>.
/// </summary>
/// <param name="DashboardLayout">
/// **Read-only here, deliberately.** The column exists and is reported so the profile page
/// can show what is stored, but there is no writable vocabulary for it yet: #133 owns
/// dashboard customization and has not decided whether it ships at all. Minting values here
/// would hand that issue a vocabulary it has to live with, chosen by the wrong feature.
/// </param>
public sealed record ProfileDisplayPreferences(
    string Language,
    string Timezone,
    string Theme,
    string DashboardLayout);

/// <summary>
/// **One preferences store, not two** -- the acceptance criterion #136, #103 and #133 all
/// share.
///
/// <c>Notifications</c> here is the very same <see cref="NotificationPreferencesResponse"/>
/// that <c>GET /notifications/preferences</c> returns, produced by the very same
/// <see cref="NotificationPreferenceUpdate.ToResponse"/> over the very same six
/// <c>notifications_*</c> columns on <c>users</c>. This endpoint is a second *view* of that
/// store, never a second copy of it: there is no parallel table, no parallel DTO shape and
/// no second digest vocabulary to drift apart from the first (which is exactly how the
/// question-type vocabularies drifted -- see <c>NotificationPreferenceValidation</c>).
/// </summary>
public sealed record ProfilePreferencesResponse(
    ProfileDisplayPreferences Display,
    NotificationPreferencesResponse Notifications);

/// <summary>
/// A partial update, for the same consent reason
/// <see cref="UpdateNotificationPreferencesRequest"/> is partial: null means "not mentioned,
/// leave exactly as stored". A profile page that saves its display section must not be able
/// to reset opt-outs it never rendered.
/// </summary>
/// <param name="Notifications">
/// Delegated verbatim to <see cref="NotificationPreferenceUpdate.TryApply"/> -- the same
/// validation, the same partial semantics, the same untouched <c>PushNotifications</c>.
/// Omit it and the notification preferences are not read or written at all.
/// </param>
public sealed record UpdateProfilePreferencesRequest(
    string? Language = null,
    string? Timezone = null,
    string? Theme = null,
    UpdateNotificationPreferencesRequest? Notifications = null);
