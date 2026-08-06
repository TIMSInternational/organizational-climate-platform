namespace ClimateProject.Domain.Entities;

// Demographics pre-assigned when a member is invited. Invitations are the real
// entry point for member data -- the requirement notes most companies pre-load
// their roster via CSV/Excel and assign demographics at invitation time -- so
// leaving user_invitations.demographics as an unvalidated jsonb blob while
// normalising only users would let unmapped keys and out-of-range option values
// in through the front door and only fail (silently) at acceptance time.
public class UserInvitationDemographic
{
    public Guid InvitationId { get; set; }
    public Guid DemographicFieldId { get; set; }
    public required string Value { get; set; }
}
