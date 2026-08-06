namespace ClimateProject.Domain.Entities;

public class Survey
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }

    // Paired language columns (#195). No consumer reads TitleEn/TitleEs directly:
    // everything goes through LocalizedContent.Resolve, which is what keeps a third
    // language a migration rather than a rewrite.
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }

    /// <summary>
    /// 'es' | 'en' | 'both'. Defaults to the owning company's language; 'both' is an
    /// explicit per-survey override, not the norm. This is the field the publish gate
    /// reads -- see ContentPublishValidation.
    /// </summary>
    public string Language { get; set; } = "en";

    public required string Type { get; set; }
    public DateTimeOffset StartDate { get; set; }
    public DateTimeOffset EndDate { get; set; }
    public string Status { get; set; } = "draft";
    public int ResponseCount { get; set; }
    public int? TargetAudienceCount { get; set; }
    public int Version { get; set; } = 1;
    public SurveySettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class SurveySettings
{
    public bool Anonymous { get; set; }
    public bool AllowPartialResponses { get; set; } = true;
    public bool RandomizeQuestions { get; set; }
    public bool ShowProgress { get; set; } = true;
    public bool AutoSave { get; set; } = true;
    public int? TimeLimitMinutes { get; set; }
    public int? ResponseLimit { get; set; }
    public bool NotificationSendInvitations { get; set; } = true;
    public bool NotificationSendReminders { get; set; } = true;
    public int NotificationReminderFrequencyDays { get; set; } = 3;

    // Tier 1 despite living in a settings blob: these two are emailed to respondents.
    public string? InvitationCustomMessageEn { get; set; }
    public string? InvitationCustomMessageEs { get; set; }
    public bool InvitationIncludeCredentials { get; set; }
    public bool InvitationSendImmediately { get; set; }
    public string? InvitationCustomSubjectEn { get; set; }
    public string? InvitationCustomSubjectEs { get; set; }
    public bool InvitationBrandingEnabled { get; set; }
}
