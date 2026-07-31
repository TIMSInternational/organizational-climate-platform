namespace ClimateProject.Domain.Entities;

public class ActionPlanObjective
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public required string Description { get; set; }
    public required string SuccessCriteria { get; set; }
    public string CurrentStatus { get; set; } = "";
    public int CompletionPercentage { get; set; }
}
