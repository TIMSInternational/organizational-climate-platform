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
    public bool IsActive { get; set; } = true;
    public DateTimeOffset? LastLoginAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
