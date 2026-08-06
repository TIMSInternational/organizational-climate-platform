namespace ClimateProject.Application.Notifications;

/// <summary>
/// The delivery channels a notification can carry, and the subset this platform can
/// actually deliver to today.
///
/// <c>Notification.Channel</c> and <c>NotificationTemplate.Channel</c> were both free
/// <c>varchar(20)</c> columns with no vocabulary constant anywhere in the codebase, so
/// every call site was about to invent its own literal -- which is exactly how the five
/// question-type vocabularies drifted apart (#196, see <c>QuestionTypes</c>). This is the
/// one canonical list; per-context subsets are **derived** from it, never re-listed.
///
/// The four values are the legacy Mongoose <c>Notification.channel</c> enum verbatim
/// (see <c>docs/superpowers/plans/2026-07-31-notifications-schema.md</c>), because that is
/// what production rows contain and what the ETL (#154) will import.
/// </summary>
public static class NotificationChannels
{
    /// <summary>Mail. The only channel governed by a per-user opt-out (#192).</summary>
    public const string Email = "email";

    /// <summary>The in-product inbox, read through <c>GET /notifications/mine</c>.</summary>
    public const string InApp = "in_app";

    /// <summary>Web/mobile push. Stored and accepted on templates, not dispatchable -- see <see cref="Dispatchable"/>.</summary>
    public const string Push = "push";

    /// <summary>Text message.</summary>
    public const string Sms = "sms";

    /// <summary>
    /// Every channel the schema recognises. A stored row or an imported legacy row may
    /// carry any of these, so nothing that *reads* notifications may reject one.
    /// </summary>
    public static readonly string[] All = [Email, InApp, Push, Sms];

    /// <summary>
    /// The channels <c>POST /notifications</c> and <c>POST /notifications/bulk</c> accept.
    ///
    /// Derived from <see cref="All"/> rather than written out again, so adding a channel
    /// above cannot silently leave this list stale.
    ///
    /// <see cref="Push"/> is excluded, and that is the same decision as the one that keeps
    /// <c>NotificationPreferences.PushNotifications</c> off the self-service API: this repo
    /// has no push infrastructure and no device-token storage of any kind, so a dispatch
    /// that reported <c>sent</c> for a push notification would be asserting a delivery that
    /// provably did not happen -- worse than a 400, because the failure would be invisible.
    /// Fold <see cref="Push"/> back in as part of the change that ships real push delivery,
    /// once #82 decides whether the PWA ships. Templates may still *target* push (#96 keeps
    /// the full <see cref="All"/> set) so that authoring can get ahead of delivery.
    /// </summary>
    public static readonly string[] Dispatchable = [.. All.Where(channel => channel != Push)];

    public static bool IsKnown(string? channel)
        => channel is not null && Array.IndexOf(All, channel) >= 0;

    public static bool IsDispatchable(string? channel)
        => channel is not null && Array.IndexOf(Dispatchable, channel) >= 0;
}
