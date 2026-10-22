namespace ClimateProject.Application.OrgStructure;

public sealed record UserListItem(
    Guid Id,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    // A mass invite's generated sign-in name, or null for an account that signs in by email.
    // Non-null is what offers "send new sign-in details" on the users screen.
    string? Username = null);

public sealed record UserListResponse(IReadOnlyList<UserListItem> Users);

public sealed record UserDetail(
    Guid Id,
    // Null for a user with no tenant -- a global super_admin (#191).
    Guid? CompanyId,
    string Email,
    string Name,
    string Role,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    IReadOnlyDictionary<string, string> Demographics,
    // Only on the response to an update that actually changed the address; null everywhere
    // else (a GET, or an update that left the email alone).
    UserEmailChange? EmailChange = null);

/// <summary>
/// What an email correction did and did not do, so the screen can say what is left to do.
/// </summary>
/// <param name="PreviousEmail">The address the person had before this request.</param>
/// <param name="UnusedSurveyCodes">
/// Per-survey sign-ins (<c>survey_credentials</c>) this person holds on a scheduled or active
/// survey and has never used. They were mailed to the OLD address, and nothing re-sends them:
/// changing the address sends no email at all. Each survey's roster is where they are re-sent.
/// </param>
/// <param name="PendingInvitationsExpired">
/// Unaccepted account invitations addressed to the old address that this request expired --
/// once the address is free, accepting one would create a second person for it.
/// </param>
public sealed record UserEmailChange(string PreviousEmail, int UnusedSurveyCodes, int PendingInvitationsExpired);

public sealed record UpdateUserRequest(
    string? Name,
    Guid? DepartmentId,
    Guid? ManagerId,
    bool? IsActive,
    // Null means "leave demographics alone"; a non-null map REPLACES the user's
    // full demographic set (an omitted or blank key clears that answer), which is
    // why required-field enforcement applies here and not at invitation time.
    Dictionary<string, string?>? Demographics = null,
    // Null means "leave the address alone". Trimmed and lower-cased like an import row, then
    // checked for format, for a reserved domain and against every account on the platform.
    string? Email = null);

public sealed record UpdateUserRoleRequest(string Role);
