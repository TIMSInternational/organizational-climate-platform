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
    string? MaintenanceMessage,
    int MaxLoginAttempts,
    int SessionTimeoutMinutes,
    PasswordPolicyDto PasswordPolicy,
    SystemEmailSettingsDto EmailSettings,
    DateTimeOffset UpdatedAt);

public sealed record UpdateSystemSettingsRequest(
    bool? LoginEnabled,
    bool? MaintenanceMode,
    string? MaintenanceMessage,
    int? MaxLoginAttempts,
    int? SessionTimeoutMinutes,
    PasswordPolicyDto? PasswordPolicy,
    SystemEmailSettingsDto? EmailSettings);
