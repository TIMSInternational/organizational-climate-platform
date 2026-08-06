namespace ClimateProject.Domain.Entities;

public class User
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public required string Email { get; set; }
    public required string Name { get; set; }
    public string? PasswordHash { get; set; }
    public required string Role { get; set; }
    public string? NodoId { get; set; }
    public string? PersonaExternalId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid? ManagerId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset? LastLoginAt { get; set; }
    public DateTimeOffset? ConsentUpdatedAt { get; set; }
    public UserPreferences Preferences { get; set; } = new();
    public UserConsent Consent { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class UserPreferences
{
    public string Language { get; set; } = "en";
    public string Timezone { get; set; } = "UTC";
    public string DashboardLayout { get; set; } = "default";
    public string Theme { get; set; } = "light";
}

public class UserConsent
{
    public bool Essential { get; set; } = true;
    public bool Analytics { get; set; }
    public bool Marketing { get; set; }
    public bool Personalization { get; set; }
    public bool ThirdParty { get; set; }
    public bool Demographics { get; set; }
}
