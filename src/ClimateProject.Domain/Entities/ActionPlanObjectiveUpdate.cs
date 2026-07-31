namespace ClimateProject.Domain.Entities;

public class ActionPlanObjectiveUpdate
{
    public Guid Id { get; set; }
    public Guid ProgressUpdateId { get; set; }
    public Guid ObjectiveId { get; set; }
    public required string StatusUpdate { get; set; }
    public int? CompletionPercentage { get; set; }
    public string? Notes { get; set; }
}
