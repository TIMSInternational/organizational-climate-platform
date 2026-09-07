namespace ClimateProject.Domain.Entities;

public class ActionPlan
{
    public Guid Id { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
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
