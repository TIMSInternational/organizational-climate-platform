namespace ClimateProject.Domain.Entities;

public class DemographicField
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public required string Field { get; set; }
    public required string Label { get; set; }
    public required string Type { get; set; }
    public List<string>? Options { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
