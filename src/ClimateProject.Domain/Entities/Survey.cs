namespace ClimateProject.Domain.Entities;

public class Survey
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid CreatedBy { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
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
    public string? InvitationCustomMessage { get; set; }
    public bool InvitationIncludeCredentials { get; set; }
    public bool InvitationSendImmediately { get; set; }
    public string? InvitationCustomSubject { get; set; }
    public bool InvitationBrandingEnabled { get; set; }
}
