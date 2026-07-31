namespace ClimateProject.Domain.Entities;

public class ActionPlanKpi
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public required string Name { get; set; }
    public decimal TargetValue { get; set; }
    public decimal CurrentValue { get; set; }
    public required string Unit { get; set; }
    public required string MeasurementFrequency { get; set; }
}
