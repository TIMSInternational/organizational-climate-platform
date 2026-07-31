namespace ClimateProject.Domain.Entities;

public class SurveyTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public string? Industry { get; set; }
    public string? CompanySize { get; set; }
    public bool IsPublic { get; set; }
    public Guid? CreatedBy { get; set; }
    public Guid? CompanyId { get; set; }
    public int UsageCount { get; set; }
    public double Rating { get; set; }
    public string[] Tags { get; set; } = [];
    public Guid? SourceSurveyId { get; set; }
    public DateTimeOffset? LastUsed { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
