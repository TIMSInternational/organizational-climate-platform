namespace ClimateProject.Domain.Entities;

public class Company
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? EmailDomain { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
