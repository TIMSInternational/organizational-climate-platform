using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES
//
// Same non-negotiable as SurveyDtos, inherited from #195: not one property below is
// En/Es-shaped. Template question text arrives already resolved for the request's
// locale, with ResolvedLocale and FallbackFields saying so.
//
// Name/Description/Category are NOT localized here because the columns are not paired
// -- survey_templates.name and .description are single `text` columns and #195 gave
// paired treatment to template_questions only. Adding a pair would be a migration, and
// this wave adds none. Reported as a parity gap rather than faked: a template's
// catalogue metadata is currently monolingual whatever the questions are authored in.
// ---------------------------------------------------------------------------

/// <summary>
/// One template option. <see cref="Value"/> is the stable, locale-independent key that
/// survives instantiation into <c>question_options.value</c> and therefore into
/// <c>question_responses.response_value</c>; <see cref="Label"/> is display only.
/// </summary>
public sealed record SurveyTemplateQuestionOptionDto(int Order, string Value, string? Label);

public sealed record SurveyTemplateQuestionDto(
    Guid Id,
    string? Text,
    string Type,
    List<SurveyTemplateQuestionOptionDto>? Options,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMin,
    string? ScaleLabelMax,
    bool Required,
    bool CommentRequired,
    string? CommentPrompt,
    int Order,
    string? Category);

/// <param name="IsGlobal">
/// <c>CompanyId == null</c>, restated as a flag so a client does not have to infer a
/// security-relevant property from a null. Global templates are visible to every tenant
/// and writable only by a super_admin.
/// </param>
public sealed record SurveyTemplateListItem(
    Guid Id,
    string Name,
    string Description,
    string Category,
    string? Industry,
    string? CompanySize,
    bool IsPublic,
    Guid? CompanyId,
    bool IsGlobal,
    IReadOnlyList<string> Tags,
    int UsageCount,
    double Rating,
    int QuestionCount,
    DateTimeOffset? LastUsed,
    DateTimeOffset CreatedAt);

public sealed record SurveyTemplateListResponse(IReadOnlyList<SurveyTemplateListItem> Templates);

/// <param name="Language">
/// The language the template's questions are actually authored in ('es' | 'en' |
/// 'both'), INFERRED from the rows rather than stored: survey_templates has no
/// language column and adding one would be a migration. See
/// <see cref="SurveyTemplateLanguage.Infer"/>.
/// </param>
/// <param name="ResolvedLocale">
/// The locale this payload is actually written in, which is not necessarily the one
/// requested -- a Spanish-only template fetched with <c>?lang=en</c> comes back in
/// Spanish and says so.
/// </param>
public sealed record SurveyTemplateDetail(
    Guid Id,
    string Name,
    string Description,
    string Category,
    string? Industry,
    string? CompanySize,
    bool IsPublic,
    Guid? CompanyId,
    bool IsGlobal,
    IReadOnlyList<string> Tags,
    int UsageCount,
    double Rating,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    IReadOnlyList<SurveyTemplateQuestionDto> Questions,
    Guid? SourceSurveyId,
    DateTimeOffset? LastUsed,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

// ---------------------------------------------------------------------------
// WRITE SHAPES
//
// Locale-keyed LocalizedInput, never En/Es properties. A bare string is attributed to
// the authoring language declared on the request, and rejected when that language is
// 'both'.
// ---------------------------------------------------------------------------

public sealed record CreateSurveyTemplateQuestionOptionInput(string? Value, LocalizedInput? Label);

public sealed record CreateSurveyTemplateQuestionInput(
    LocalizedInput? Text,
    string Type,
    List<CreateSurveyTemplateQuestionOptionInput>? Options = null,
    int? ScaleMin = null,
    int? ScaleMax = null,
    LocalizedInput? ScaleLabelMin = null,
    LocalizedInput? ScaleLabelMax = null,
    bool Required = false,
    bool CommentRequired = true,
    LocalizedInput? CommentPrompt = null,
    int Order = 0,
    string? Category = null);

/// <param name="CompanyId">
/// Null means a GLOBAL template, visible to every tenant. Super-admin only to write --
/// the same rule as Benchmark and NotificationTemplate, and the hole #207 closed.
/// </param>
/// <param name="Language">
/// The language the supplied question content is authored in, used ONLY to attribute
/// bare strings to a column. It is not persisted: the read side infers it back from the
/// rows, so declaring 'es' and then sending only English text cannot produce a template
/// that lies about itself. Defaults to the owning company's language, or 'en' for a
/// global template.
/// </param>
public sealed record CreateSurveyTemplateRequest(
    string Name,
    string Description,
    string Category,
    Guid? CompanyId = null,
    string? Industry = null,
    string? CompanySize = null,
    bool IsPublic = false,
    List<string>? Tags = null,
    List<CreateSurveyTemplateQuestionInput>? Questions = null,
    Guid? SourceSurveyId = null,
    string? Language = null);

/// <summary>
/// Every member is nullable and means "leave this alone" when omitted.
///
/// Note the absence of CompanyId. Re-scoping a template between tenants -- or promoting
/// a company template to global -- is a privilege change wearing an update's clothes,
/// and an update that can also do that is an update that does it by accident. Delete and
/// recreate instead.
/// </summary>
public sealed record UpdateSurveyTemplateRequest(
    string? Name = null,
    string? Description = null,
    string? Category = null,
    string? Industry = null,
    string? CompanySize = null,
    bool? IsPublic = null,
    List<string>? Tags = null,
    List<CreateSurveyTemplateQuestionInput>? Questions = null,
    string? Language = null);

/// <param name="CompanyId">
/// The tenant the new survey belongs to. Optional for a company_admin (their own
/// company is the only legal answer); required for a super_admin, who has no implicit
/// tenant since #191.
/// </param>
/// <param name="Title">
/// Optional. When omitted the template's Name is used, attributed to the new survey's
/// language by the ordinary bare-string rule -- which means a survey created as 'both'
/// must supply a localized title rather than have one language's name silently filed in
/// both columns.
/// </param>
/// <param name="Language">
/// Optional override for the new survey's content language. Defaults to the language the
/// template's questions are actually authored in, so instantiating an English-only
/// template does not produce a survey that fails its own publish gate for Spanish it
/// never had.
/// </param>
public sealed record UseSurveyTemplateRequest(
    Guid? CompanyId = null,
    LocalizedInput? Title = null,
    LocalizedInput? Description = null,
    string? Type = null,
    DateTimeOffset? StartDate = null,
    DateTimeOffset? EndDate = null,
    List<Guid>? DepartmentIds = null,
    int? TargetAudienceCount = null,
    string? Language = null);
