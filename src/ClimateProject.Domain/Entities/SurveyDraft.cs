namespace ClimateProject.Domain.Entities;

public class SurveyDraft
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string SessionId { get; set; }
    public int CurrentStep { get; set; } = 1;
    public string? LastEditedField { get; set; }
    public int AutoSaveCount { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset? LastAutosaveAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public bool IsRecovered { get; set; }
    public string? DraftData { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
