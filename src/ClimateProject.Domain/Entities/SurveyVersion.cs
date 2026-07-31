namespace ClimateProject.Domain.Entities;

public class SurveyVersion
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public int VersionNumber { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public string[] Changes { get; set; } = [];
    public required string Reason { get; set; }
    public Guid CreatedBy { get; set; }
    public string? QuestionsSnapshot { get; set; }
    public string? DemographicsSnapshot { get; set; }
    public string? SettingsSnapshot { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
