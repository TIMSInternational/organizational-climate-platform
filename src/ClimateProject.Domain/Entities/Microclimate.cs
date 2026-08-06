namespace ClimateProject.Domain.Entities;

public class Microclimate
{
    public Guid Id { get; set; }
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }

    /// <summary>
    /// 'es' | 'en' | 'both'. Defaults to the owning company's language. Per
    /// microclimate-req.md:40's "Language: Spanish | English | Both" field, which
    /// legacy rendered in the wizard and never persisted.
    /// </summary>
    public string Language { get; set; } = "en";
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public Guid? TemplateId { get; set; }
    public string Status { get; set; } = "draft";
    public int ResponseCount { get; set; }
    public int TargetParticipantCount { get; set; }
    public double ParticipationRate { get; set; }
    public MicroclimateTargeting Targeting { get; set; } = new();
    public MicroclimateScheduling Scheduling { get; set; } = new();
    public MicroclimateRealtimeSettings RealtimeSettings { get; set; } = new();
    public MicroclimateLiveResults LiveResults { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class MicroclimateTargeting
{
    public string[]? RoleFilters { get; set; }
    public string[]? TenureFilters { get; set; }
    public string? CustomFilters { get; set; }
    public bool IncludeManagers { get; set; } = true;
    public int? MaxParticipants { get; set; }
}

public class MicroclimateScheduling
{
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset EndTime { get; set; }
    public string Timezone { get; set; } = "UTC";
    public string? ReminderSchedule { get; set; }
}

public class MicroclimateRealtimeSettings
{
    public bool ShowLiveResults { get; set; } = true;
    public bool AnonymousResponses { get; set; } = true;
    public bool AllowComments { get; set; } = true;
    public bool WordCloudEnabled { get; set; } = true;
    public bool SentimentAnalysisEnabled { get; set; } = true;
    public int ParticipationThreshold { get; set; } = 3;
}

public class MicroclimateLiveResults
{
    public double SentimentScore { get; set; }
    public string EngagementLevel { get; set; } = "medium";
    public string[] TopThemes { get; set; } = [];
    public string? WordCloudData { get; set; }
    public string? ResponseDistribution { get; set; }
}
