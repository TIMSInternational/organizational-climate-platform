using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// A variable a template declares. <see cref="DefaultValue"/> is stored in a
/// <c>jsonb</c> column, so it is a JSON document, not a bare string -- the write
/// path rejects anything that is not parseable rather than letting Postgres raise
/// a 22P02 and surface as a 500.
/// </summary>
public sealed record NotificationTemplateVariableDto(
    Guid Id,
    string Name,
    string Type,
    bool Required,
    string Description,
    string? DefaultValue);

/// <summary>
/// A personalization rule as stored.
///
/// <see cref="Condition"/> is validated on write with
/// <see cref="NotificationConditionParser.TryParse"/> so an admin gets a 400 instead of
/// a rule that silently never fires. It is deliberately still re-parsed at evaluation
/// time -- write-time validation is a guard on one door of a database that has had
/// others -- and it is never executed. <see cref="Modifications"/> stays opaque to this
/// endpoint (the notifications plan's global constraint); only its JSON validity is
/// checked, because the column is <c>jsonb</c>.
/// </summary>
public sealed record NotificationPersonalizationRuleDto(
    Guid Id,
    string Condition,
    string? Modifications);

public sealed record NotificationTemplateListItem(
    Guid Id,
    string Name,
    string Type,
    string Channel,
    Guid? CompanyId,
    bool IsActive,
    bool IsDefault);

public sealed record NotificationTemplateListResponse(IReadOnlyList<NotificationTemplateListItem> Templates);

/// <summary>
/// Read shape. Note what is *not* here: no <c>subjectEn</c>/<c>subjectEs</c>. Every
/// authored field is already resolved for the request's locale, per #195 -- adding a
/// third language changes nothing on this record, which is the whole reason the paired
/// column design was affordable.
/// </summary>
/// <param name="ContentLanguage">
/// The language this template is authored in. NotificationTemplate has no
/// <c>Language</c> column of its own, so it is derived: a company template inherits
/// <c>Company.Settings.Language</c>, and a global template (<c>CompanyId == null</c>,
/// served to every tenant regardless of that tenant's language) is <c>both</c>.
/// </param>
/// <param name="ResolvedLocale">The locale the fields above were actually resolved to.</param>
/// <param name="FallbackFields">
/// Fields that had to reach for another language to produce a value. Every fallback
/// self-reports rather than silently substituting English into a Spanish email.
/// </param>
public sealed record NotificationTemplateDetail(
    Guid Id,
    string Name,
    string Type,
    string Channel,
    string? Subject,
    string? Title,
    string? Content,
    string? HtmlContent,
    Guid? CompanyId,
    bool IsActive,
    bool IsDefault,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<NotificationTemplateVariableDto> Variables,
    IReadOnlyList<NotificationPersonalizationRuleDto> Rules,
    string ContentLanguage,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

public sealed record NotificationTemplateVariableInput(
    string? Name,
    string? Type,
    bool Required,
    string? Description,
    string? DefaultValue);

public sealed record NotificationPersonalizationRuleInput(string? Condition, string? Modifications);

public sealed record CreateNotificationTemplateRequest(
    string? Name,
    string? Type,
    string? Channel,
    LocalizedInput? Subject,
    LocalizedInput? Title,
    LocalizedInput? Content,
    LocalizedInput? HtmlContent,
    Guid? CompanyId,
    bool IsDefault,
    IReadOnlyList<NotificationTemplateVariableInput>? Variables,
    IReadOnlyList<NotificationPersonalizationRuleInput>? Rules,
    // Templates are created active, matching the notifications plan. An admin who is
    // still drafting a translation sends false and escapes the activation gate until
    // both languages exist.
    bool IsActive = true);

public sealed record UpdateNotificationTemplateRequest(
    string? Name,
    LocalizedInput? Subject,
    LocalizedInput? Title,
    LocalizedInput? Content,
    LocalizedInput? HtmlContent,
    bool? IsActive,
    IReadOnlyList<NotificationTemplateVariableInput>? Variables,
    IReadOnlyList<NotificationPersonalizationRuleInput>? Rules);

/// <param name="Variables">Values to substitute, keyed by declared variable name.</param>
/// <param name="Lang">The locale to render, defaulting to the template's own language.</param>
public sealed record NotificationTemplatePreviewRequest(
    Dictionary<string, string?>? Variables,
    string? Lang);

/// <param name="MatchedRuleIds">
/// The personalization rules whose condition evaluated true for
/// <see cref="NotificationTemplatePreviewRequest.Variables"/>. An unparseable condition
/// is false, never executed -- see <see cref="NotificationConditionParser.Evaluate"/>.
/// </param>
/// <param name="MissingRequiredVariables">
/// Declared-required variables the caller supplied no value and no default for. Reported
/// rather than thrown: a preview of an under-specified template is still useful.
/// </param>
public sealed record NotificationTemplatePreview(
    string? Subject,
    string? Title,
    string? Content,
    string? HtmlContent,
    IReadOnlyList<Guid> MatchedRuleIds,
    IReadOnlyList<string> MissingRequiredVariables,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);
