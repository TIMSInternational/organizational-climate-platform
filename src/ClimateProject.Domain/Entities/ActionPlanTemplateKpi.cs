namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateKpi
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Name { get; set; }
    public decimal TargetValue { get; set; }
    public required string Unit { get; set; }
    public required string MeasurementFrequency { get; set; }
}
