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

    // How a human reads a result: "mean" prints the 1,00–5,00 mean, "percent" prints it on
    // 0–100 (mean × 20). Storage, aggregation, the privacy floor and the bands above stay on
    // 1–5 whatever this says; only what is displayed or downloaded converts.
    public string ResultScale { get; set; } = "mean";

    /// <summary>
    /// How this company's people are given sign-ins: <c>shared</c> (one account per person,
    /// opening every survey) or <c>per_survey</c> (a username and password per survey, and
    /// one credentials email each). See <see cref="CredentialModes"/>.
    ///
    /// <para>This is the DEFAULT a new survey inherits, resolved and frozen onto the survey
    /// at create time. Changing it never re-shapes a survey whose credentials have already
    /// been mailed.</para>
    /// </summary>
    public string CredentialMode { get; set; } = CredentialModes.Shared;
}
