namespace ClimateProject.Domain.Entities;

public class AIInsight
{
    public Guid Id { get; set; }
    public Guid? SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public required string Type { get; set; }
    public required string Category { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public int ConfidenceScore { get; set; }
    public required string Priority { get; set; }
    public List<string> AffectedSegments { get; set; } = [];
    public List<string> RecommendedActions { get; set; } = [];
    public string? SupportingData { get; set; }
    public bool IsAcknowledged { get; set; }
    public Guid? AcknowledgedBy { get; set; }
    public DateTimeOffset? AcknowledgedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
