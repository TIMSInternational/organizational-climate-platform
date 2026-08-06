namespace ClimateProject.Application.OrgStructure;

public sealed record PasswordPolicyDto(
    int MinLength,
    bool RequireUppercase,
    bool RequireLowercase,
    bool RequireNumbers,
    bool RequireSpecialChars);

public sealed record SystemEmailSettingsDto(
    bool SmtpEnabled,
    string? FromEmail,
    string? SmtpHost,
    int? SmtpPort);

public sealed record SystemSettingsDetail(
    bool LoginEnabled,
    bool MaintenanceMode,
    // Resolved for the requesting admin's locale, with the locale it resolved to
    // reported below. No MaintenanceMessageEn/Es here, by the same rule as everywhere
    // else -- a third language must not reach this DTO (#195).
    string? MaintenanceMessage,
    int MaxLoginAttempts,
    int SessionTimeoutMinutes,
    PasswordPolicyDto PasswordPolicy,
    SystemEmailSettingsDto EmailSettings,
    DateTimeOffset UpdatedAt,
    string ResolvedLocale,
    bool MaintenanceMessageIsFallback);

public sealed record UpdateSystemSettingsRequest(
    bool? LoginEnabled,
    bool? MaintenanceMode,
    // Locale-keyed, or a bare string. System settings have no company and therefore no
    // content language of their own, so a bare string is always taken as English --
    // which is what the single column it replaces always held.
    Localization.LocalizedInput? MaintenanceMessage,
    int? MaxLoginAttempts,
    int? SessionTimeoutMinutes,
    PasswordPolicyDto? PasswordPolicy,
    SystemEmailSettingsDto? EmailSettings);
