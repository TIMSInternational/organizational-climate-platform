namespace ClimateProject.Domain.Entities;

public class DemographicSnapshotEntry
{
    public Guid Id { get; set; }
    public Guid SnapshotId { get; set; }
    public Guid UserId { get; set; }
    public required string Department { get; set; }
    public required string Role { get; set; }
    public required string Tenure { get; set; }
    public string? Location { get; set; }
    public string? Team { get; set; }
    public string? Level { get; set; }
    public string? CustomAttributes { get; set; }
}
