namespace ClimateProject.Domain.Entities;

public class ActionPlanProgressUpdate
{
    public Guid Id { get; set; }
    public Guid ActionPlanId { get; set; }
    public DateTimeOffset UpdateDate { get; set; }
    public string OverallNotes { get; set; } = "";
    public Guid UpdatedBy { get; set; }
}
