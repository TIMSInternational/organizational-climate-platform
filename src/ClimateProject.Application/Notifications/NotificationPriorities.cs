namespace ClimateProject.Application.Notifications;

/// <summary>
/// <c>Notification.Priority</c>'s vocabulary. Legacy Mongoose enum verbatim; the DB-level
/// default is <see cref="Medium"/>, declared in <c>NotificationConfiguration</c> and
/// re-stated here as <see cref="Default"/> so a dispatch that omits the field lands on the
/// same value a raw-SQL insert would.
/// </summary>
public static class NotificationPriorities
{
    public const string Low = "low";
    public const string Medium = "medium";
    public const string High = "high";
    public const string Critical = "critical";

    public static readonly string[] All = [Low, Medium, High, Critical];

    /// <summary>Must stay equal to the DDL default in <c>NotificationConfiguration</c>; a unit test asserts it.</summary>
    public const string Default = Medium;

    public static bool IsKnown(string? priority)
        => priority is not null && Array.IndexOf(All, priority) >= 0;
}
