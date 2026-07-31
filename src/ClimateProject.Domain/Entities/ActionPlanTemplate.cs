namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public string[] AiRecommendationTemplates { get; set; } = [];
    public string[] Tags { get; set; } = [];
    public int UsageCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
