namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateObjective
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
    public string? SuccessCriteriaEn { get; set; }
    public string? SuccessCriteriaEs { get; set; }
}
