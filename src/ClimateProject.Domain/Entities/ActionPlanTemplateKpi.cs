namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateKpi
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? NameEn { get; set; }
    public string? NameEs { get; set; }
    public decimal TargetValue { get; set; }
    public string? UnitEn { get; set; }
    public string? UnitEs { get; set; }
    public required string MeasurementFrequency { get; set; }
}
