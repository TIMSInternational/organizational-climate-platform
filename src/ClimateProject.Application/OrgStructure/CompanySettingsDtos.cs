namespace ClimateProject.Application.OrgStructure;

public sealed record CompanySettingsDto(
    string SurveyFrequency,
    bool MicroclimateEnabled,
    bool AiInsightsEnabled,
    bool AnonymousSurveys,
    int DataRetentionDays,
    string Timezone,
    string Language,
    /// <summary>`shared` | `per_survey`. The default every NEW survey inherits and freezes.</summary>
    string CredentialMode);

public sealed record CompanyBrandingDto(
    string? LogoUrl,
    string PrimaryColor,
    string SecondaryColor,
    string FontFamily,
    string? CustomCss);

public sealed record CompanySettingsResponse(
    Guid CompanyId,
    CompanySettingsDto Settings,
    CompanyBrandingDto Branding,
    ResultBandsDto ResultBands);

public sealed record UpdateCompanySettingsRequest(
    string? SurveyFrequency,
    bool? MicroclimateEnabled,
    bool? AiInsightsEnabled,
    bool? AnonymousSurveys,
    int? DataRetentionDays,
    string? Timezone,
    string? Language,
    string? LogoUrl,
    string? PrimaryColor,
    string? SecondaryColor,
    string? FontFamily,
    string? CustomCss,
    UpdateResultBandsRequest? ResultBands = null,
    /// <summary>`shared` | `per_survey`; omitted leaves it alone, as every member here does.</summary>
    string? CredentialMode = null);
