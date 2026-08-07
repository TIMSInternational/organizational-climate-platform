namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES
//
// Same #195 rule the rest of the survey surface obeys: not one property below is
// En/Es-shaped. The only authored text on this surface is the survey's own title and
// description, echoed on the token-validation payload already resolved, with
// ResolvedLocale and FallbackFields saying which locale it is actually in.
//
// And one rule specific to this surface: NO READ DTO CARRIES A TOKEN. Invitation
// tokens are bearer credentials for an unauthenticated route. The only place a token
// is ever emitted is the share link handed back to the admin who just minted it --
// which is the one caller that cannot use the feature without it.
// ---------------------------------------------------------------------------

public sealed record SurveyAccessRulesDto(
    bool RequireLogin,
    bool AllowAnonymous,
    bool SingleResponse,
    bool ActiveOutsideSchedule,
    IReadOnlyList<string>? AllowedDomains,
    IReadOnlyList<string>? BlockedIps,
    int? MaxResponses);

public sealed record SurveyQrCustomizationDto(
    string ForegroundColor,
    string BackgroundColor,
    string? LogoUrl,
    int Size);

/// <summary>
/// The anonymity contract, served as data rather than left in a comment.
///
/// A client that renders "3 of 12 completed" for a non-anonymous survey and the same widget
/// for an anonymous one would be reporting zeroes and calling them a completion rate. So the
/// guarantee ships with the payload: what the ceiling is, which states are suppressed, and a
/// sentence saying why -- machine-readable first, prose second.
/// </summary>
public sealed record SurveyAnonymityGuaranteeDto(
    bool Anonymous,
    string HighestRecordableState,
    IReadOnlyList<string> SuppressedStates,
    string Guarantee);

/// <summary>
/// Per-status counts. Aggregates only -- naming who is in each bucket is what
/// <c>GET /surveys/{id}/invitations</c> is for, and that listing is refused outright for an
/// anonymous survey's post-ceiling states because they are never recorded in the first place.
/// </summary>
public sealed record SurveyInvitationSummaryDto(
    int Total,
    int Pending,
    int Sent,
    int Opened,
    int Started,
    int Completed,
    int Revoked,
    int Expired);

public sealed record SurveyDistributionDetail(
    Guid Id,
    Guid SurveyId,
    string AccessType,
    // The site-relative share link, or null when none is minted. Admin-only: a bearer credential.
    string? PublicLink,
    string QrCodeUrl,
    SurveyAccessRulesDto AccessRules,
    SurveyQrCustomizationDto QrCustomization,
    int TokenizedLinksGenerated,
    int RegeneratedCount,
    DateTimeOffset? LastRegeneratedAt,
    int TotalAccesses,
    int UniqueVisitors,
    DateTimeOffset? LastAccessedAt,
    SurveyInvitationSummaryDto Invitations,
    SurveyAnonymityGuaranteeDto Anonymity,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// One invitation as an admin sees it. Note the absence of <c>InvitationToken</c>: an admin
/// who can list tokens can open any employee's survey as them, which is a privilege the
/// admin role does not otherwise carry and which no screen needs.
/// </summary>
public sealed record SurveyInvitationDetail(
    Guid Id,
    Guid SurveyId,
    Guid UserId,
    string Email,
    string Status,
    bool IsExpired,
    DateTimeOffset? SentAt,
    DateTimeOffset? OpenedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    int ReminderCount,
    DateTimeOffset? LastReminderSent,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt);

public sealed record SurveyInvitationListResponse(
    IReadOnlyList<SurveyInvitationDetail> Invitations,
    SurveyInvitationSummaryDto Summary,
    SurveyAnonymityGuaranteeDto Anonymity);

/// <summary>
/// What the holder of an invitation token is shown before they answer. Unauthenticated, so
/// it is deliberately thin: enough to render "you have been invited to X, it closes on Y",
/// and nothing that would turn a leaked token into a disclosure. In particular it does not
/// echo the invitee's email address back.
/// </summary>
public sealed record SurveyInvitationTokenDetail(
    Guid InvitationId,
    Guid SurveyId,
    string? SurveyTitle,
    string? SurveyDescription,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    string Status,
    DateTimeOffset SurveyStartDate,
    DateTimeOffset SurveyEndDate,
    DateTimeOffset ExpiresAt,
    SurveyAnonymityGuaranteeDto Anonymity);

/// <summary>
/// The outcome of recording a state transition.
///
/// <paramref name="Recorded"/> is false in two very different situations and the caller is
/// told which: the transition was not forward progress (idempotent replay), or the survey is
/// anonymous and the state is past the ceiling. Reporting a suppressed write as a successful
/// one would be the same silent substitution the content-i18n rules forbid, wearing a
/// different hat.
/// </summary>
public sealed record SurveyInvitationStateResult(
    Guid InvitationId,
    string Status,
    bool Recorded,
    bool SuppressedForAnonymity,
    string? Reason,
    SurveyAnonymityGuaranteeDto Anonymity);

/// <summary>What the holder of a public share link is shown. Carries no invitation and no token.</summary>
public sealed record SurveyPublicLinkDetail(
    Guid SurveyId,
    string? SurveyTitle,
    string? SurveyDescription,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    DateTimeOffset SurveyStartDate,
    DateTimeOffset SurveyEndDate,
    bool RequireLogin,
    bool AllowAnonymous,
    bool SingleResponse);

/// <param name="Requested">Distinct users the request resolved to.</param>
/// <param name="Created">Invitations actually minted.</param>
/// <param name="SkippedUserIds">Users who already had an invitation to this survey. Re-send rotates theirs; it is not this route's job.</param>
/// <param name="NotificationsQueued">
/// Rows added to <c>notifications</c>, not mails delivered. Delivery is the notification
/// sweep's job -- see the seam note on <c>SurveyDistributionEndpoints</c>.
/// </param>
public sealed record SurveyInvitationBatchResult(
    int Requested,
    int Created,
    IReadOnlyList<Guid> InvitationIds,
    IReadOnlyList<Guid> SkippedUserIds,
    int NotificationsQueued,
    string? Note);

/// <param name="Eligible">Outstanding invitations whose reminder cadence had elapsed.</param>
/// <param name="Queued">Reminder notifications added. Equal to <paramref name="Eligible"/> unless something failed validation.</param>
/// <param name="SkippedTooSoon">Outstanding invitations reminded more recently than the survey's cadence allows.</param>
public sealed record SurveyReminderResult(
    int Eligible,
    int Queued,
    int SkippedTooSoon,
    string? Note);

// ---------------------------------------------------------------------------
// WRITE SHAPES
// ---------------------------------------------------------------------------

/// <summary>Every member nullable and meaning "leave this alone" when omitted, matching <c>SurveySettingsInput</c>.</summary>
public sealed record SurveyAccessRulesInput(
    bool? RequireLogin = null,
    bool? AllowAnonymous = null,
    bool? SingleResponse = null,
    bool? ActiveOutsideSchedule = null,
    List<string>? AllowedDomains = null,
    List<string>? BlockedIps = null,
    int? MaxResponses = null);

public sealed record SurveyQrCustomizationInput(
    string? ForegroundColor = null,
    string? BackgroundColor = null,
    string? LogoUrl = null,
    int? Size = null);

public sealed record UpsertSurveyDistributionRequest(
    string? AccessType = null,
    SurveyAccessRulesInput? AccessRules = null,
    SurveyQrCustomizationInput? QrCustomization = null);

/// <summary>
/// Who to invite. Exactly one selector must be supplied -- an empty request is refused
/// rather than treated as "everybody", because the failure mode of guessing wrong here is
/// mailing an entire company.
/// </summary>
/// <param name="AllTargeted">
/// The survey's own audience: the departments it targets, or the whole company when it
/// targets none. The same rule <c>SurveyQueries.AssignedTo</c> applies to <c>/surveys/my</c>,
/// so "who gets invited" and "who sees it in their inbox" cannot drift apart.
/// </param>
/// <param name="ExpiresInDays">
/// Optional shortening. An invitation never outlives its survey's <c>EndDate</c>, so this
/// can bring the expiry forward and never push it back.
/// </param>
public sealed record CreateSurveyInvitationsRequest(
    List<Guid>? UserIds = null,
    List<Guid>? DepartmentIds = null,
    bool AllTargeted = false,
    int? ExpiresInDays = null);
