namespace ClimateProject.Domain.Entities;

public class SurveyInvitation
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string Email { get; set; }
    public required string InvitationToken { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public int ReminderCount { get; set; }
    public DateTimeOffset? LastReminderSent { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? Metadata { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
