namespace ClimateProject.Domain.Entities;

public class Notification
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string Type { get; set; }
    public required string Channel { get; set; }
    public string Priority { get; set; } = "medium";
    public string Status { get; set; } = "pending";
    public required string Title { get; set; }
    public required string Message { get; set; }
    public string? Data { get; set; }
    public Guid? TemplateId { get; set; }
    public DateTimeOffset ScheduledFor { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? FailedAt { get; set; }
    public string? FailureReason { get; set; }
    public int RetryCount { get; set; }
    public int MaxRetries { get; set; } = 3;
    public NotificationMetadata Metadata { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class NotificationMetadata
{
    public string? UserAgent { get; set; }
    public string? IpAddress { get; set; }
    public string? EmailClient { get; set; }
    public string? DeviceType { get; set; }
}
