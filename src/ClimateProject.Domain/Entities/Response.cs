namespace ClimateProject.Domain.Entities;

public class Response
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid? UserId { get; set; }
    public required string SessionId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    /// <summary>
    /// The locale the respondent was actually served, recorded rather than authored
    /// -- you cannot write "the Spanish" of an answer somebody typed in English.
    ///
    /// It did not exist before #195, and its absence was load-bearing: the live word
    /// cloud counts raw words into one frequency map, so "trabajo" and "work" were
    /// separate entries with nothing anywhere recording which language a respondent
    /// answered in. Also required for per-language sentiment, for rendering a stored
    /// answer correctly, and for "export in both languages", which for open text can
    /// only mean labelled with the language it was written in.
    /// </summary>
    public string Language { get; set; } = "en";

    public bool IsComplete { get; set; }
    public bool IsAnonymous { get; set; }
    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset? CompletionTime { get; set; }
    public int? TotalTimeSeconds { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
