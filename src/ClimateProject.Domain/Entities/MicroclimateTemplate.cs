namespace ClimateProject.Domain.Entities;

public class MicroclimateTemplate
{
    public Guid Id { get; set; }
    // Paired language columns (#210, Tier 2 of #195). Nothing reads the halves directly:
    // reads go through AuthoredContent.Resolve and writes through AuthoredContent.TryApply,
    // which is what keeps a third language a migration rather than a rewrite.
    public string? NameEn { get; set; }
    public string? NameEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
    public required string Category { get; set; }
    public Guid? CompanyId { get; set; }
    public Guid? CreatedBy { get; set; }
    public bool IsSystemTemplate { get; set; }
    public int UsageCount { get; set; }
    public bool IsActive { get; set; } = true;
    public string[] Tags { get; set; } = [];
    public MicroclimateTemplateSettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class MicroclimateTemplateSettings
{
    public int DefaultDurationMinutes { get; set; } = 30;
    public string SuggestedFrequency { get; set; } = "weekly";
    public int? MaxParticipants { get; set; }
    public bool AnonymousByDefault { get; set; } = true;
    public bool AutoClose { get; set; } = true;
    public bool ShowLiveResults { get; set; } = true;
}
