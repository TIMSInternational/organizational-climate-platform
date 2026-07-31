namespace ClimateProject.Domain.Entities;

public class UserInvitation
{
    public Guid Id { get; set; }
    public required string Email { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid InvitedBy { get; set; }
    public required string InvitationToken { get; set; }
    public required string InvitationType { get; set; }
    public required string Role { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public int ReminderCount { get; set; }
    public DateTimeOffset? LastReminderSentAt { get; set; }
    public string? Metadata { get; set; }
    public string? InvitationData { get; set; }
    public string? Demographics { get; set; }
}
