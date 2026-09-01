namespace ClimateProject.Application.Microclimates;

// ---------------------------------------------------------------------------
// READ SHAPES
//
// Same #195 rule the rest of the microclimate surface obeys: not one property below is
// En/Es-shaped. The only authored text on this surface is the microclimate's own title
// and description, echoed on the token-validation payload already resolved, with
// ResolvedLocale and FallbackFields saying which locale it is actually in.
//
// And one rule specific to this surface: NO READ DTO CARRIES A TOKEN. Invitation
// tokens are bearer credentials for an unauthenticated route, and unlike the survey
// share link there is no admin caller here who cannot work without one.
// ---------------------------------------------------------------------------

/// <summary>
/// The anonymity contract, served as data rather than left in a comment.
///
/// A client that renders "3 of 12 participated" for a non-anonymous microclimate and the
/// same widget for an anonymous one would be reporting zeroes and calling them a
/// participation rate. So the guarantee ships with the payload: what the ceiling is, which
/// states are suppressed, and a sentence saying why -- machine-readable first, prose second.
/// </summary>
public sealed record MicroclimateAnonymityGuaranteeDto(
    bool Anonymous,
    string HighestRecordableState,
    IReadOnlyList<string> SuppressedStates,
    string Guarantee);

/// <summary>
/// Per-status counts. Aggregates only -- naming who is in each bucket is what
/// <c>GET /microclimates/{id}/invitations</c> is for, and for an anonymous microclimate the
/// two post-ceiling buckets are structurally zero because nothing ever writes them.
/// </summary>
public sealed record MicroclimateInvitationSummaryDto(
    int Total,
    int Pending,
    int Sent,
    int Opened,
    int Started,
    int Completed,
    int Revoked,
    int Expired);

/// <summary>
/// One invitation as an admin sees it. Note the absence of <c>InvitationToken</c>: an admin
/// who can list tokens can open any employee's pulse as them, which is a privilege the admin
/// role does not otherwise carry and which no screen needs.
/// </summary>
public sealed record MicroclimateInvitationDetail(
    Guid Id,
    Guid MicroclimateId,
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

public sealed record MicroclimateInvitationListResponse(
    IReadOnlyList<MicroclimateInvitationDetail> Invitations,
    MicroclimateInvitationSummaryDto Summary,
    MicroclimateAnonymityGuaranteeDto Anonymity);

/// <summary>
/// What the holder of an invitation token is shown before they answer. Unauthenticated, so
/// it is deliberately thin: enough to render "you have been invited to X, it closes on Y",
/// and nothing that would turn a leaked token into a disclosure. In particular it does not
/// echo the invitee's email address back, and it carries neither <c>CompanyId</c> nor
/// <c>CreatedBy</c> nor <c>ResponseCount</c> -- the same reduction
/// <c>PublicMicroclimateDetail</c> already makes for the anonymous read of a session.
/// </summary>
public sealed record MicroclimateInvitationTokenDetail(
    Guid InvitationId,
    Guid MicroclimateId,
    string? MicroclimateTitle,
    string? MicroclimateDescription,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    string Status,
    string MicroclimateStatus,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    DateTimeOffset ExpiresAt,
    MicroclimateAnonymityGuaranteeDto Anonymity);

/// <summary>
/// The outcome of recording a state transition.
///
/// <paramref name="Recorded"/> is false in two very different situations and the caller is
/// told which: the transition was not forward progress (idempotent replay), or the
/// microclimate is anonymous and the state is past the ceiling. Reporting a suppressed write
/// as a successful one would be the same silent substitution the content-i18n rules forbid,
/// wearing a different hat.
/// </summary>
public sealed record MicroclimateInvitationStateResult(
    Guid InvitationId,
    string Status,
    bool Recorded,
    bool SuppressedForAnonymity,
    string? Reason,
    MicroclimateAnonymityGuaranteeDto Anonymity);

/// <param name="Requested">Distinct users the request resolved to.</param>
/// <param name="Created">Invitations actually minted.</param>
/// <param name="SkippedUserIds">
/// Users who already had an invitation to this microclimate. Rotating a live one is the
/// resend route's job and issuing a fresh token to a revoked one is the reinstate route's;
/// neither is this route's. <see cref="MicroclimateInvitationBatchResult.Note"/> names the
/// reinstate route when some of these were skipped for being revoked, because "created: 0"
/// with no explanation is how an admin concludes the product is broken.
/// </param>
/// <param name="NotificationsQueued">
/// Rows added to <c>notifications</c>, not mails delivered. Delivery is the notification
/// sweep's job -- see the seam note on <c>MicroclimateInvitationEndpoints</c>.
/// </param>
/// <param name="UndeliverableRecipients">
/// How many of the invitations just created are addressed to a domain that can never receive
/// mail -- the RFC 2606 / RFC 6761 reserved names. Reported, never enforced: the send path
/// refuses these outright (see <c>UndeliverableAddresses</c>), and this number exists so the
/// admin learns it here, at the click, rather than by opening rows one at a time afterwards
/// and finding them failed. Zero on a healthy tenant.
/// </param>
/// <param name="Note">
/// Whatever an admin has to be told at the click rather than left to deduce from the
/// numbers: undeliverable addresses, and users skipped because their invitation to this
/// microclimate is revoked (with the route that re-issues one). Null when there is nothing
/// to say, which is the ordinary case.
/// </param>
public sealed record MicroclimateInvitationBatchResult(
    int Requested,
    int Created,
    IReadOnlyList<Guid> InvitationIds,
    IReadOnlyList<Guid> SkippedUserIds,
    int NotificationsQueued,
    int UndeliverableRecipients,
    string? Note);

// ---------------------------------------------------------------------------
// WRITE SHAPES
// ---------------------------------------------------------------------------

/// <summary>
/// Who a batch of invitations is for, and how long their tokens live.
///
/// <para>
/// Exactly one selector, and an empty request is a 400 rather than a silent "everyone" --
/// the same rule <c>CreateSurveyInvitationsRequest</c> follows, for the same reason: the
/// failure mode of guessing here is mailing a whole company.
/// </para>
/// </summary>
/// <param name="UserIds">Named recipients, in the microclimate's own company.</param>
/// <param name="DepartmentIds">Every active user in these departments.</param>
/// <param name="AllCompanyUsers">Every active user in the microclimate's company.</param>
/// <param name="ExpiresInDays">
/// Brings the token deadline forward. It can never push it past the session's own
/// <c>EndTime</c>: a token that still opens a closed pulse is a token with nothing to protect
/// and everything to leak.
/// </param>
public sealed record CreateMicroclimateInvitationsRequest(
    List<Guid>? UserIds = null,
    List<Guid>? DepartmentIds = null,
    bool AllCompanyUsers = false,
    int? ExpiresInDays = null);
