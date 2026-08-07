namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES for version history and audit history.
//
// Same non-negotiable as SurveyDtos: not one property below is En/Es-shaped. The
// snapshot blobs ARE locale-paired (they have to be -- see SurveyVersioning), and
// SurveyHistoryEndpoints resolves them on the way out, reporting ResolvedLocale and
// FallbackFields exactly as the live survey does. A client renders a historical
// version with the same components it renders the current one with.
// ---------------------------------------------------------------------------

/// <param name="IsCurrent">
/// True for the version whose content is live on the survey right now, i.e. the one whose
/// number equals <c>surveys.version</c>.
/// </param>
/// <param name="CollectedResponses">
/// True when responses exist against this survey AND this is the current version -- that
/// is, when this snapshot is the wording those responses were actually collected against.
/// It can only ever be true for one version of a survey, because content freezes the
/// moment responses can exist and there is no lifecycle path back.
/// </param>
public sealed record SurveyVersionSummary(
    Guid Id,
    Guid SurveyId,
    int VersionNumber,
    string? Title,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    string Reason,
    IReadOnlyList<string> Changes,
    int QuestionCount,
    Guid CreatedBy,
    string? CreatedByName,
    string? CreatedByEmail,
    DateTimeOffset CreatedAt,
    bool IsCurrent,
    bool CollectedResponses);

/// <param name="CurrentVersion">
/// <c>surveys.version</c>. A draft that has never been published reports 1 with an empty
/// list: the number is what the NEXT publish will be, and there is no snapshot until then.
/// </param>
/// <param name="ResponseCount">
/// Present so a caller can see, without a second request, that this survey's answers all
/// belong to <paramref name="CurrentVersion"/>.
/// </param>
public sealed record SurveyVersionListResponse(
    Guid SurveyId,
    int CurrentVersion,
    int ResponseCount,
    IReadOnlyList<SurveyVersionSummary> Versions);

/// <summary>
/// One version, resolved and rendered exactly like <c>SurveyDetail</c> -- same
/// <see cref="SurveyQuestionDto"/>, same <see cref="SurveySettingsDto"/>, same
/// <c>resolvedLocale</c>/<c>fallbackFields</c> contract.
/// </summary>
public sealed record SurveyVersionDetail(
    Guid Id,
    Guid SurveyId,
    int VersionNumber,
    string? Title,
    string? Description,
    string Type,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    IReadOnlyList<Guid> DepartmentIds,
    int? TargetAudienceCount,
    IReadOnlyList<SurveyQuestionDto> Questions,
    SurveySettingsDto Settings,
    string Reason,
    IReadOnlyList<string> Changes,
    Guid CreatedBy,
    string? CreatedByName,
    string? CreatedByEmail,
    DateTimeOffset CreatedAt,
    bool IsCurrent,
    bool CollectedResponses);

/// <summary>
/// Two versions side by side plus the field paths that differ.
///
/// Both sides are returned whole rather than as per-field before/after strings: half the
/// interesting differences (an option's stable value moving, a question appearing at
/// order 3) are structural and have no honest string rendering, and a client that has both
/// resolved payloads can highlight <paramref name="Changes"/> itself with the components
/// it already uses to render a survey.
/// </summary>
public sealed record SurveyVersionComparison(
    Guid SurveyId,
    SurveyVersionDetail From,
    SurveyVersionDetail To,
    IReadOnlyList<string> Changes);

/// <param name="Changes">
/// Field paths for an update, <c>from</c>/<c>to</c> for a status change, the number for a
/// version snapshot. Null when the action carries no payload.
/// </param>
public sealed record SurveyAuditEntry(
    Guid Id,
    Guid SurveyId,
    string Action,
    string EntityType,
    string? EntityId,
    SurveyAuditChangeSet? Changes,
    Guid UserId,
    string UserName,
    string UserEmail,
    string UserRole,
    DateTimeOffset Timestamp,
    string? IpAddress);

public sealed record SurveyHistoryResponse(Guid SurveyId, IReadOnlyList<SurveyAuditEntry> Entries);
