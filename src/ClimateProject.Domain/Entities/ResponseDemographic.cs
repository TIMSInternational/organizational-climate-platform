namespace ClimateProject.Domain.Entities;

public class ResponseDemographic
{
    public Guid ResponseId { get; set; }
    public required string Field { get; set; }
    public required string Value { get; set; }
}
