namespace ClimateProject.Domain.Entities;

public class MicroclimateTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
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
