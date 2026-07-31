namespace ClimateProject.Domain.Entities;

public class Response
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid? UserId { get; set; }
    public required string SessionId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public bool IsComplete { get; set; }
    public bool IsAnonymous { get; set; }
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset? CompletionTime { get; set; }
    public int? TotalTimeSeconds { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
