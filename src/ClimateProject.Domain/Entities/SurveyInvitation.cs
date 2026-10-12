namespace ClimateProject.Domain.Entities;

public class SurveyInvitation
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public Guid UserId { get; set; }
    public Guid CompanyId { get; set; }
    public required string Email { get; set; }
    public required string InvitationToken { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? OpenedAt { get; set; }

    /// <summary>No longer written for any survey.</summary>
    /// <remarks>
    /// Ruled 2026-10-12: a named invitee's tracking keeps only the DAY they finished
    /// (<see cref="CompletedOn"/>), never a start or completion instant -- an instant taken at
    /// the moment of submission is a join key against <c>responses.completion_time</c>. The
    /// column stays mapped for one release only so an API instance still serving during a
    /// deploy (expand/contract) does not select a dropped column; the migration
    /// <c>InvitationCompletionDayOnly</c> nulls every existing value, and a follow-up drops it.
    /// </remarks>
    public DateTimeOffset? StartedAt { get; set; }

    /// <summary>No longer written for any survey. See <see cref="StartedAt"/>; dropped in a follow-up.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>
    /// The day, in the COMPANY's time zone, on which the invitee finished. Day precision on
    /// purpose: it answers "who is still outstanding" without recording when anyone answered.
    /// Never written on an anonymous survey, whose tracking stops at <c>opened</c>.
    /// </summary>
    public DateOnly? CompletedOn { get; set; }
    public int ReminderCount { get; set; }
    public DateTimeOffset? LastReminderSent { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? Metadata { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
