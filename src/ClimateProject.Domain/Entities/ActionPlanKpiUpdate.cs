namespace ClimateProject.Domain.Entities;

public class ActionPlanKpiUpdate
{
    public Guid Id { get; set; }
    public Guid ProgressUpdateId { get; set; }
    public Guid KpiId { get; set; }
    public decimal NewValue { get; set; }
    public string? Notes { get; set; }
}
