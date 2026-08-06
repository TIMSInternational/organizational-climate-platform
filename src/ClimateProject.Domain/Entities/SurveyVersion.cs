namespace ClimateProject.Domain.Entities;

public class SurveyVersion
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public int VersionNumber { get; set; }
    // Must carry whatever Survey carries, or version history desynchronises from
    // live content the moment a survey is translated.
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? DescriptionEn { get; set; }
    public string? DescriptionEs { get; set; }
    public string[] Changes { get; set; } = [];
    public required string Reason { get; set; }
    public Guid CreatedBy { get; set; }
    public string? QuestionsSnapshot { get; set; }
    public string? DemographicsSnapshot { get; set; }
    public string? SettingsSnapshot { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
