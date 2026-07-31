namespace ClimateProject.Domain.Entities;

public class MicroclimateQuestion
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public bool Required { get; set; } = true;
    public int Order { get; set; }
}
