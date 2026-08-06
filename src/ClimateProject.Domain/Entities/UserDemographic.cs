namespace ClimateProject.Domain.Entities;

// One demographic answer for one user, keyed by the company's DemographicField
// definition rather than by a free-text key. This replaces the opaque
// users.demographics jsonb blob: a blob cannot be filtered, grouped or exported
// per-field (req.md 2.2 requires exactly that for every custom demographic), and
// nothing could validate a blob's keys against the company's configured fields.
public class UserDemographic
{
    public Guid UserId { get; set; }
    public Guid DemographicFieldId { get; set; }
    public required string Value { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
