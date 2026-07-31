namespace ClimateProject.Domain.Entities;

public class ActionPlanTemplateObjective
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public required string Description { get; set; }
    public required string SuccessCriteria { get; set; }
}
