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

    // The result bands (see Application/OrgStructure/ResultBands.cs). The defaults are the
    // product default for every tenant: critical under 3,00, opportunity 3,00–3,99,
    // strength from 4,00. A null name is the product's own name for that area.
    public decimal ResultBandOpportunityMin { get; set; } = 3.00m;
    public decimal ResultBandStrengthMin { get; set; } = 4.00m;
    public string? ResultBandCriticalName { get; set; }
    public string? ResultBandOpportunityName { get; set; }
    public string? ResultBandStrengthName { get; set; }
}
