namespace ClimateProject.Domain.Entities;

public class DemographicSnapshot
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public int Version { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public Guid CreatedBy { get; set; }
    public required string Reason { get; set; }
    public bool IsActive { get; set; } = true;
    public DemographicSnapshotMetadata Metadata { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class DemographicSnapshotMetadata
{
    public int TotalUsers { get; set; }
    public int DepartmentsCount { get; set; }
    public string? RolesDistribution { get; set; }
    public string? TenureDistribution { get; set; }
}
