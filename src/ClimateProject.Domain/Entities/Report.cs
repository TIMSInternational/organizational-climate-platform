namespace ClimateProject.Domain.Entities;

public class Report
{
    public Guid Id { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
    public required string Type { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public string? TemplateId { get; set; }
    public string? Filters { get; set; }
    public string? Config { get; set; }
    public string Status { get; set; } = "generating";
    public required string Format { get; set; }
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public DateTimeOffset? GenerationStartedAt { get; set; }
    public DateTimeOffset? GenerationCompletedAt { get; set; }
    public string? GenerationError { get; set; }
    public DateTimeOffset? ScheduledFor { get; set; }
    public bool IsRecurring { get; set; }
    public string? RecurrencePattern { get; set; }
    public DateTimeOffset? NextGeneration { get; set; }
    public List<string> SharedWith { get; set; } = [];
    public int DownloadCount { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public string? ReportOutput { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
