using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES
//
// Non-negotiable, inherited from #195: not one property below is En/Es-shaped.
// Every authored string arrives already resolved for the request's locale, with
// ResolvedLocale and FallbackFields saying so. That is the whole reason a third
// language stays a migration instead of a rewrite of every page that renders a
// survey -- adding 'pt' adds a column pair and changes nothing here.
// ---------------------------------------------------------------------------

/// <summary>
/// One option as a respondent sees it and as the server stores it.
/// <see cref="Value"/> is the stable, locale-independent key that lands in
/// <c>question_responses.response_value</c>; <see cref="Label"/> is display only.
/// </summary>
public sealed record SurveyQuestionOptionDto(int Order, string Value, string? Label);

public sealed record SurveyQuestionDto(
    Guid Id,
    string? Text,
    string Type,
    List<SurveyQuestionOptionDto>? Options,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMin,
    string? ScaleLabelMax,
    bool Required,
    bool CommentRequired,
    string? CommentPrompt,
    int Order,
    string? Category);

/// <summary>
/// <c>InvitationCustomMessage</c>/<c>InvitationCustomSubject</c> are resolved here for
/// the same reason the title is: they are authored text that gets emailed to a
/// respondent, which the entity itself calls Tier 1 despite living in a settings blob.
/// </summary>
public sealed record SurveySettingsDto(
    bool Anonymous,
    bool AllowPartialResponses,
    bool RandomizeQuestions,
    bool ShowProgress,
    bool AutoSave,
    int? TimeLimitMinutes,
    int? ResponseLimit,
    bool NotificationSendInvitations,
    bool NotificationSendReminders,
    int NotificationReminderFrequencyDays,
    string? InvitationCustomMessage,
    string? InvitationCustomSubject,
    bool InvitationIncludeCredentials,
    bool InvitationSendImmediately,
    bool InvitationBrandingEnabled);

public sealed record SurveyListItem(
    Guid Id,
    string? Title,
    Guid CompanyId,
    string Type,
    string Status,
    string Language,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount,
    int? TargetAudienceCount,
    int QuestionCount,
    DateTimeOffset CreatedAt);

public sealed record SurveyListResponse(IReadOnlyList<SurveyListItem> Surveys);

/// <summary>
/// The distinct question categories a company's surveys have actually used -- the
/// wizard's dimension picker offers these alongside the fixed catalogue, so an admin
/// re-uses last quarter's spelling instead of minting a near-duplicate key. Raw
/// authored values, trimmed only; the server neither controls nor translates them.
/// </summary>
public sealed record SurveyDimensionsResponse(IReadOnlyList<string> Dimensions);

public sealed record SurveyDetail(
    Guid Id,
    string? Title,
    string? Description,
    Guid CompanyId,
    Guid CreatedBy,
    string Type,
    string Status,
    // The content's own language ('es' | 'en' | 'both'), the locale this payload was
    // actually resolved for, and the fields that had to reach for another language to
    // produce a value. Every fallback self-reports rather than silently substituting.
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int ResponseCount,
    int? TargetAudienceCount,
    int Version,
    IReadOnlyList<Guid> DepartmentIds,
    IReadOnlyList<SurveyQuestionDto> Questions,
    SurveySettingsDto Settings,
    // What the caller may do next, computed server-side. The wizard would otherwise
    // reimplement the transition matrix in TypeScript, which is how a client comes to
    // offer a button the server rejects.
    IReadOnlyList<string> AllowedStatusTransitions,
    bool IsContentEditable,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// A survey the caller is expected to answer, as served to a non-admin. Deliberately
/// reduced: no CompanyId, no CreatedBy, no ResponseCount, no settings, no questions --
/// an employee's inbox needs to know what to open and by when, and nothing else. The
/// questions come from the respond endpoint (#106), not from a listing.
/// </summary>
public sealed record MySurveyListItem(
    Guid Id,
    string? Title,
    string? Description,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int QuestionCount,
    bool Anonymous,
    int? TimeLimitMinutes);

public sealed record MySurveyListResponse(IReadOnlyList<MySurveyListItem> Surveys);

// ---------------------------------------------------------------------------
// WRITE SHAPES
//
// Locale-keyed LocalizedInput, never En/Es properties -- a third language adds a key,
// not a request-DTO field. A bare string is attributed to the survey's own single
// language, and rejected when the survey is authored in 'both'.
// ---------------------------------------------------------------------------

public sealed record CreateSurveyQuestionOptionInput(string? Value, LocalizedInput? Label);

public sealed record CreateSurveyQuestionInput(
    LocalizedInput? Text,
    string Type,
    List<CreateSurveyQuestionOptionInput>? Options = null,
    int? ScaleMin = null,
    int? ScaleMax = null,
    LocalizedInput? ScaleLabelMin = null,
    LocalizedInput? ScaleLabelMax = null,
    bool Required = false,
    bool CommentRequired = true,
    LocalizedInput? CommentPrompt = null,
    int Order = 0,
    string? Category = null,
    // Provenance, not a reference (#110). Set it when the author picked this question out
    // of the question bank; the text below is still what gets stored and still what the
    // answer belongs to, so a later edit or retirement of the bank item cannot reach a
    // survey that has already been asked. It is what makes bank usage and effectiveness a
    // COUNT over existing rows instead of a counter incremented on the respondent's own
    // transaction -- see QuestionBankMetrics.
    Guid? SourceQuestionBankItemId = null);

/// <summary>
/// Every member is nullable and means "leave this alone" when omitted, so a partial
/// settings patch does not silently reset the fifteen fields it did not mention.
/// </summary>
public sealed record SurveySettingsInput(
    bool? Anonymous = null,
    bool? AllowPartialResponses = null,
    bool? RandomizeQuestions = null,
    bool? ShowProgress = null,
    bool? AutoSave = null,
    int? TimeLimitMinutes = null,
    int? ResponseLimit = null,
    bool? NotificationSendInvitations = null,
    bool? NotificationSendReminders = null,
    int? NotificationReminderFrequencyDays = null,
    LocalizedInput? InvitationCustomMessage = null,
    LocalizedInput? InvitationCustomSubject = null,
    bool? InvitationIncludeCredentials = null,
    bool? InvitationSendImmediately = null,
    bool? InvitationBrandingEnabled = null);

public sealed record CreateSurveyRequest(
    LocalizedInput? Title,
    Guid CompanyId,
    string Type,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    LocalizedInput? Description = null,
    List<Guid>? DepartmentIds = null,
    List<CreateSurveyQuestionInput>? Questions = null,
    SurveySettingsInput? Settings = null,
    int? TargetAudienceCount = null,
    // 'es' | 'en' | 'both'. Defaults to the company's own language, so 'both' is an
    // opt-in rather than something every survey inherits.
    string? Language = null);

/// <summary>
/// Note the absence of Status. Lifecycle changes go through
/// <c>PUT /surveys/{id}/status</c> and nowhere else: an update that can also publish is
/// an update that can publish by accident, and the publish gate is the one irreversible
/// checkpoint in the domain. (The microclimate surface conflates the two; #104's own
/// scope calls status "the crux", so surveys separate them.)
/// </summary>
public sealed record UpdateSurveyRequest(
    LocalizedInput? Title = null,
    LocalizedInput? Description = null,
    string? Type = null,
    DateTimeOffset? StartDate = null,
    DateTimeOffset? EndDate = null,
    List<Guid>? DepartmentIds = null,
    List<CreateSurveyQuestionInput>? Questions = null,
    SurveySettingsInput? Settings = null,
    int? TargetAudienceCount = null,
    string? Language = null);

public sealed record UpdateSurveyStatusRequest(string Status);

public sealed record DuplicateSurveyRequest(
    LocalizedInput? Title = null,
    DateTimeOffset? StartDate = null,
    DateTimeOffset? EndDate = null);

public sealed record BulkSurveyActionRequest(string Action, List<Guid> SurveyIds);

/// <param name="Message">Null on success; the same message a single-survey call would have returned otherwise.</param>
public sealed record BulkSurveyActionResult(Guid SurveyId, bool Succeeded, string? Message);

/// <summary>
/// Per-survey outcomes rather than a single status code. A bulk archive over twelve
/// surveys where one is already archived is a partial success, and collapsing that to
/// 400 would strand the other eleven while telling the caller nothing about which.
/// </summary>
public sealed record BulkSurveyActionResponse(IReadOnlyList<BulkSurveyActionResult> Results);
