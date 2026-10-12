namespace ClimateProject.Domain.Entities;

/// <summary>
/// That a named person answered a survey -- and nothing about what they answered.
/// </summary>
/// <remarks>
/// <para>
/// Every column that is NOT here is absent on purpose, and each absence is the guarantee:
/// no response id, no session id, no demographics, no IP address, no user agent, and no
/// timestamp -- <see cref="ParticipatedOn"/> is a calendar day in the company's time zone, so
/// the row cannot be joined to <c>responses.completion_time</c> by the clock either. See
/// <c>docs/decisions/participation-is-not-linked-to-answers.md</c> for what is left.
/// </para>
/// </remarks>
public class SurveyParticipation
{
    /// <summary>Random, never derived from the response or the session.</summary>
    public Guid Id { get; set; }

    public Guid SurveyId { get; set; }

    public Guid CompanyId { get; set; }

    /// <summary>As the respondent typed it, trimmed. Required.</summary>
    public required string Name { get; set; }

    /// <summary>Lower-cased, or null: many respondents are operarios with no email.</summary>
    public string? Email { get; set; }

    /// <summary>The day, in the company's time zone. Deliberately not a timestamp.</summary>
    public DateOnly ParticipatedOn { get; set; }
}
