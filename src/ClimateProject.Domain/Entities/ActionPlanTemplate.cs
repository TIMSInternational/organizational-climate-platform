namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplate
{
    public Guid Id { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? NameEn { get; set; }
    public string? NameEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
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
