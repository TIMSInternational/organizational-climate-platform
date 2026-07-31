namespace ClimateProject.Domain.Entities;

public class DemographicSnapshotChange
{
    public Guid Id { get; set; }
    public Guid SnapshotId { get; set; }
    public required string Field { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public Guid ChangedBy { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? Reason { get; set; }
}
