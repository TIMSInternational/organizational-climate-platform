namespace ClimateProject.Domain.Entities;

public class MicroclimateAiInsight
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public required string Type { get; set; }
    public required string Message { get; set; }
    public double Confidence { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
