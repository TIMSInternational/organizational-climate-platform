namespace ClimateProject.Application.Notifications;

/// <summary>
/// One notification, as read by an admin or by its own recipient.
///
/// No <c>En</c>/<c>Es</c>-shaped fields, per #195 -- and unlike <c>NotificationTemplate</c>
/// this needs no localisation helper to achieve that: <c>Notification.Title</c>/<c>Message</c>
/// are the already-rendered text of one delivery, in whichever language the template was
/// rendered in. The bilingual pair lives on the template, one level up.
/// </summary>
public sealed record NotificationDetail(
    Guid Id,
    Guid UserId,
    Guid CompanyId,
    string Type,
    string Channel,
    string Priority,
    string Status,
    string Title,
    string Message,
    string? Data,
    Guid? TemplateId,
    DateTimeOffset ScheduledFor,
    DateTimeOffset? SentAt,
    DateTimeOffset? DeliveredAt,
    DateTimeOffset? OpenedAt,
    DateTimeOffset? FailedAt,
    string? FailureReason,
    int RetryCount,
    DateTimeOffset CreatedAt);

public sealed record NotificationListResponse(IReadOnlyList<NotificationDetail> Notifications);

/// <summary>
/// Dispatch to one recipient.
///
/// <c>TemplateId</c> is optional and stays optional: most notifications this platform sends
/// are composed by the code that raises them, and requiring a template row would make
/// dispatch impossible before #96's CRUD has been used at all.
/// </summary>
public sealed record CreateNotificationRequest(
    Guid UserId,
    Guid CompanyId,
    string? Type,
    string? Channel,
    string? Priority,
    string? Title,
    string? Message,
    string? Data = null,
    Guid? TemplateId = null,
    DateTimeOffset? ScheduledFor = null);

/// <summary>
/// Dispatch the same notification to many recipients in one request.
///
/// One request rather than N is not just ergonomics: it is what keeps the database work
/// bounded. The handler issues a fixed number of round trips regardless of how many
/// recipients are named -- see <c>NotificationEndpoints.DispatchBulkAsync</c>.
/// </summary>
public sealed record CreateBulkNotificationRequest(
    IReadOnlyList<Guid>? UserIds,
    Guid CompanyId,
    string? Type,
    string? Channel,
    string? Priority,
    string? Title,
    string? Message,
    string? Data = null,
    Guid? TemplateId = null,
    DateTimeOffset? ScheduledFor = null);

/// <summary>
/// What a bulk dispatch did. <see cref="UnknownUserIds"/> is reported rather than causing a
/// 400 for the whole batch: a stale roster should not block the ninety-nine recipients who
/// do exist, but silently dropping them would hide a real integration bug.
/// </summary>
public sealed record BulkNotificationResult(
    int Requested,
    int Created,
    int Sent,
    int Suppressed,
    int Failed,
    IReadOnlyList<Guid> UnknownUserIds,
    IReadOnlyList<NotificationDetail> Notifications);

/// <summary>
/// What a <c>POST /notifications/process</c> sweep did over the notifications that were due.
/// </summary>
public sealed record NotificationProcessResult(
    int Attempted,
    int Sent,
    int Suppressed,
    int Failed);
