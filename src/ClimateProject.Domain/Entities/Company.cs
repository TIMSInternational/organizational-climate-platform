namespace ClimateProject.Domain.Entities;

public class Company
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? EmailDomain { get; set; }
    public string? Industry { get; set; }
    public string? Size { get; set; }
    public string? Country { get; set; }
    public string? SubscriptionTier { get; set; }
    public CompanyBranding Branding { get; set; } = new();
    public CompanySettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
}

public class CompanyBranding
{
    public string? LogoUrl { get; set; }
    public string PrimaryColor { get; set; } = "#3B82F6";
    public string SecondaryColor { get; set; } = "#1F2937";
    public string FontFamily { get; set; } = "Inter";
    public string? CustomCss { get; set; }
}

public class CompanySettings
{
    public string SurveyFrequency { get; set; } = "quarterly";
    public bool MicroclimateEnabled { get; set; } = true;
    public bool AiInsightsEnabled { get; set; } = true;
    public bool AnonymousSurveys { get; set; }
    public int DataRetentionDays { get; set; } = 2555;
    public string Timezone { get; set; } = "UTC";
    public string Language { get; set; } = "en";
}
