namespace ClimateProject.Application.OrgStructure;

public sealed record InvitationDetail(
    Guid Id,
    string? Email,
    Guid CompanyId,
    Guid? DepartmentId,
    string InvitationType,
    string Role,
    string Status,
    string Token,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    int ReminderCount,
    IReadOnlyDictionary<string, string> Demographics);

public sealed record InvitationListResponse(IReadOnlyList<InvitationDetail> Invitations);

public sealed record CreateInvitationRequest(
    string InvitationType,
    string Email,
    Guid CompanyId,
    Guid? DepartmentId,
    string Role,
    // Pre-assigned at invitation time -- most companies pre-load their roster from
    // CSV/Excel with demographics already attached. Partial by design: required
    // fields are not enforced until the member's own profile update.
    Dictionary<string, string?>? Demographics = null);

public sealed record CreateShareableLinkRequest(
    Guid CompanyId,
    Guid? DepartmentId,
    string Role,
    Dictionary<string, string?>? Demographics = null);

public sealed record AcceptInvitationRequest(string? Email, string Name, string Password);
