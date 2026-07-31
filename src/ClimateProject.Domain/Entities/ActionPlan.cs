namespace ClimateProject.Domain.Entities;

public class ActionPlan
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset DueDate { get; set; }
    public string Status { get; set; } = "not_started";
    public string Priority { get; set; } = "medium";
    public string[] AiRecommendations { get; set; } = [];
    public string[] Tags { get; set; } = [];
    public Guid? TemplateId { get; set; }
    public Guid? SourceSurveyId { get; set; }
    public Guid? SourceInsightId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
