namespace ClimateProject.Domain.Entities;

public class Benchmark
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Type { get; set; }
    public required string Category { get; set; }
    public required string Source { get; set; }
    public string? Industry { get; set; }
    public string? CompanySize { get; set; }
    public string? Region { get; set; }
    public Guid CreatedBy { get; set; }
    public Guid? CompanyId { get; set; }
    public bool IsActive { get; set; } = true;
    public string ValidationStatus { get; set; } = "pending";
    public double QualityScore { get; set; }
    public string? Metadata { get; set; }
    public Guid? PriorPeriodBenchmarkId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
