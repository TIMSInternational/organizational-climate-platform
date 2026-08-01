namespace ClimateProject.Application.OrgStructure;

public sealed record CompanySettingsDto(
    string SurveyFrequency,
    bool MicroclimateEnabled,
    bool AiInsightsEnabled,
    bool AnonymousSurveys,
    int DataRetentionDays,
    string Timezone,
    string Language);

public sealed record CompanyBrandingDto(
    string? LogoUrl,
    string PrimaryColor,
    string SecondaryColor,
    string FontFamily,
    string? CustomCss);

public sealed record CompanySettingsResponse(
    Guid CompanyId,
    CompanySettingsDto Settings,
    CompanyBrandingDto Branding);

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
    string? CustomCss);
