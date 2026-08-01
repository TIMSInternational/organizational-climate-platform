namespace ClimateProject.Domain.Entities;

public class SystemSettings
{
    public Guid Id { get; set; }
    public bool LoginEnabled { get; set; } = true;
    public bool MaintenanceMode { get; set; }
    public string? MaintenanceMessage { get; set; }
    public int MaxLoginAttempts { get; set; } = 5;
    public int SessionTimeoutMinutes { get; set; } = 60;
    public PasswordPolicy PasswordPolicy { get; set; } = new();
    public SystemEmailSettings EmailSettings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class PasswordPolicy
{
    public int MinLength { get; set; } = 8;
    public bool RequireUppercase { get; set; } = true;
    public bool RequireLowercase { get; set; } = true;
    public bool RequireNumbers { get; set; } = true;
    public bool RequireSpecialChars { get; set; }
}

public class SystemEmailSettings
{
    public bool SmtpEnabled { get; set; }
    public string? FromEmail { get; set; }
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
}
