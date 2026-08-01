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
    int ReminderCount);

public sealed record InvitationListResponse(IReadOnlyList<InvitationDetail> Invitations);

public sealed record CreateInvitationRequest(
    string InvitationType,
    string Email,
    Guid CompanyId,
    Guid? DepartmentId,
    string Role);

public sealed record CreateShareableLinkRequest(
    Guid CompanyId,
    Guid? DepartmentId,
    string Role);

public sealed record AcceptInvitationRequest(string? Email, string Name, string Password);
