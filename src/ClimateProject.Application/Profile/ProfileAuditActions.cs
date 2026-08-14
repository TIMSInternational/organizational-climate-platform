namespace ClimateProject.Application.Profile;

/// <summary>
/// The <c>audit_logs.action</c> vocabulary for the caller's own account (#136).
///
/// <c>audit_logs</c> has existed since #56's schema pass and, when #136 landed, nothing in the
/// application wrote a row to it -- so <c>GET /profile/activity</c> would have been an
/// endpoint that is correct, tested, and permanently empty. The three events a person can
/// cause on their own account were therefore recorded by the profile routes themselves.
///
/// **#143 moved the writing.** Every audited request now goes through one writer,
/// <c>AuditWritingMiddleware</c>, which derives an action from the route
/// (<c>{resource}.{verb}</c>). These constants survive as the *names* the profile routes ask
/// that writer to use, via <c>ProfileEndpoints.RecordActivity</c>: they are what
/// <c>/profile/activity</c> and its tests read back, and a route-derived
/// <c>profile.password.update</c> is not that.
///
/// Constants rather than inline literals so the writer and the tests cannot drift, matching
/// how <c>NotificationTypes</c> and <c>Roles</c> are handled.
/// </summary>
public static class ProfileAuditActions
{
    /// <summary>The <c>audit_logs.resource</c> value for everything written here.</summary>
    public const string Resource = "profile";

    /// <summary>A successful self-service edit of the caller's own display name.</summary>
    public const string Update = "profile.update";

    /// <summary>
    /// A self-service password change. Recorded on failure as well as on success
    /// (<c>audit_logs.success</c>), because a run of failed attempts on one's own account
    /// is precisely the thing an activity history exists to make visible.
    /// </summary>
    public const string PasswordChange = "profile.password_change";

    /// <summary>A successful write to the caller's own preferences.</summary>
    public const string PreferencesUpdate = "profile.preferences_update";
}
