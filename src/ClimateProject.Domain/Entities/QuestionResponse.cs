namespace ClimateProject.Domain.Entities;

public class QuestionResponse
{
    public Guid ResponseId { get; set; }
    public Guid QuestionId { get; set; }
    public required string ResponseValue { get; set; }
    public string? ResponseText { get; set; }
    public int? TimeSpentSeconds { get; set; }
}
