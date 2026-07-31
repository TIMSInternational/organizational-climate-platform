namespace ClimateProject.Domain.Entities;

public class SurveyAuditLog
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? Changes { get; set; }
    public Guid UserId { get; set; }
    public required string UserName { get; set; }
    public required string UserEmail { get; set; }
    public required string UserRole { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public string? SessionId { get; set; }
    public string? Metadata { get; set; }
}
