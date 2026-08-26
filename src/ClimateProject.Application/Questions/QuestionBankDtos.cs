namespace ClimateProject.Application.Questions;

// ---------------------------------------------------------------------------
// THE CURATION REPOSITORY (#110)
//
// Monolingual on purpose, and that is the single largest shape difference from the
// library's DTOs next door. Legacy `QuestionBank.text` was ONE string; the entity routes
// it into TextEn/TextEs by the owning company's language and records which one that was in
// `Language`, never "both" (see QuestionBankItem's remarks). So every read shape here
// carries a resolved `Text` plus the `Language` it is actually in, and every write shape
// takes one `Text`. A caller never sees a TextEn/TextEs pair for a bank item, because for a
// bank item exactly one of them is ever populated and handing out both invites a client to
// render the null one as an empty question.
// ---------------------------------------------------------------------------

/// <summary>
/// An option on a bank item: the stable, locale-independent value plus the ONE display
/// label, in the item's own language.
/// </summary>
/// <remarks>
/// Not <see cref="RepositoryOptionDto"/>, which carries a LabelEn/LabelEs pair. A bank item
/// is monolingual, so a paired label would always be half null, and a client rendering the
/// null half shows a blank option -- the same failure the single <c>Text</c> above avoids.
/// The stored columns are still the pair (they are shared with the library's option table);
/// the routing between them is the endpoint's job, not the caller's.
/// </remarks>
public sealed record QuestionBankOptionDto(int Order, string Value, string? Label);

/// <param name="Value">May be omitted, and is then derived from the label -- see the endpoints.</param>
public sealed record QuestionBankOptionInput(string? Value, string? Label);

/// <param name="Text">The one authored string. <paramref name="Language"/> says which language it is in.</param>
public sealed record QuestionBankListItem(
    Guid Id,
    Guid? CompanyId,
    string? Text,
    string Language,
    string Type,
    string Category,
    string? Subcategory,
    string? Industry,
    string? CompanySize,
    int UsageCount,
    double ResponseRate,
    double InsightScore,
    DateTimeOffset? LastUsedAt,
    bool IsActive,
    bool IsAiGenerated,
    int Version,
    Guid? ParentQuestionBankItemId,
    IReadOnlyList<string> Tags);

public sealed record QuestionBankListResponse(IReadOnlyList<QuestionBankListItem> Items, int Total);

public sealed record QuestionBankItemDetail(
    Guid Id,
    Guid? CompanyId,
    string? Text,
    string Language,
    string Type,
    string Category,
    string? Subcategory,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMin,
    string? ScaleLabelMax,
    string? Industry,
    string? CompanySize,
    int UsageCount,
    double ResponseRate,
    double InsightScore,
    DateTimeOffset? LastUsedAt,
    bool IsActive,
    bool IsAiGenerated,
    int Version,
    Guid? ParentQuestionBankItemId,
    int VariationCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<string> Tags,
    IReadOnlyList<QuestionBankOptionDto> Options);

/// <param name="Language">
/// 'en' or 'es'. Omitted, it is taken from the owning company's own language, and for a
/// global item (<paramref name="CompanyId"/> null) from the platform fallback locale.
/// Never 'both' -- a bank item holds one string, so "both" would mean storing the same
/// text twice and calling it a translation.
/// </param>
public sealed record CreateQuestionBankItemRequest(
    string Text,
    string Type,
    string Category,
    Guid? CompanyId = null,
    string? Subcategory = null,
    string? Language = null,
    int? ScaleMin = null,
    int? ScaleMax = null,
    string? ScaleLabelMin = null,
    string? ScaleLabelMax = null,
    string? Industry = null,
    string? CompanySize = null,
    IReadOnlyList<string>? Tags = null,
    IReadOnlyList<QuestionBankOptionInput>? Options = null);

/// <summary>
/// <c>CompanyId</c>, <c>Type</c> and <c>Language</c> are all absent, and each for its own
/// reason. CompanyId decides who may write the row, so a mutable one is a privilege
/// escalation wearing an update's clothing. Type decides how every answer to an
/// instantiated copy is encoded. Language names which column the text is in, so changing
/// it without moving the text would make the row claim a translation it does not have --
/// re-authoring in another language is a new item, and <c>/variations</c> is where that
/// lives.
/// </summary>
public sealed record UpdateQuestionBankItemRequest(
    string Text,
    string Category,
    string? Subcategory = null,
    int? ScaleMin = null,
    int? ScaleMax = null,
    string? ScaleLabelMin = null,
    string? ScaleLabelMax = null,
    string? Industry = null,
    string? CompanySize = null,
    bool? IsActive = null,
    IReadOnlyList<string>? Tags = null,
    IReadOnlyList<QuestionBankOptionInput>? Options = null);

/// <summary>
/// An alternate phrasing of an existing question. Type and category are inherited from the
/// parent rather than restated: a "variation" that asks a different thing in a different
/// format is not a variation, and letting a caller supply them is how a lineage comes to
/// hold two unrelated questions.
/// </summary>
public sealed record CreateQuestionBankVariationRequest(
    string Text,
    string? Language = null,
    string? Subcategory = null,
    IReadOnlyList<string>? Tags = null,
    IReadOnlyList<QuestionBankOptionInput>? Options = null);

public sealed record QuestionBankVariationsResponse(
    Guid QuestionBankItemId,
    IReadOnlyList<QuestionBankListItem> Variations);

// ---------------------------------------------------------------------------
// BULK / IMPORT
// ---------------------------------------------------------------------------

/// <param name="Items">
/// The whole batch, written or not written together. See QuestionBankEndpoints for why a
/// partial bulk write is refused rather than reported.
/// </param>
public sealed record BulkCreateQuestionBankItemsRequest(IReadOnlyList<CreateQuestionBankItemRequest> Items);

/// <param name="DeduplicateOnText">
/// When true (the default) an incoming row whose text already exists in the same scope,
/// type and category is reported as a duplicate and skipped rather than inserted again.
/// An import is run more than once -- that is what makes it an import rather than a create.
/// </param>
public sealed record ImportQuestionBankItemsRequest(
    IReadOnlyList<CreateQuestionBankItemRequest> Items,
    bool DeduplicateOnText = true);

/// <param name="SkippedAsDuplicate">Rows the import recognised as already present, by index into the request.</param>
public sealed record QuestionBankWriteResultResponse(
    int Created,
    IReadOnlyList<int> SkippedAsDuplicate,
    IReadOnlyList<QuestionBankListItem> Items);

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

public static class QuestionBankLifecycleStates
{
    /// <summary>In the corpus and offered to authors.</summary>
    public const string Active = "active";

    /// <summary>
    /// Withdrawn from the picker, still in the corpus. NOT a delete: a question that has
    /// been asked of real respondents has to stay resolvable for as long as their answers
    /// do (#106), so retirement is the only removal this API offers.
    /// </summary>
    public const string Retired = "retired";

    public static readonly string[] All = [Active, Retired];

    public static bool IsValid(string? value) => value is Active or Retired;

    /// <summary>The stored representation. There is one bit, so the vocabulary maps onto it exactly.</summary>
    public static string From(bool isActive) => isActive ? Active : Retired;
}

public sealed record QuestionBankLifecycleRequest(string State);

/// <param name="InstantiatedQuestionCount">
/// How many survey questions were copied from this item. Reported on the transition because
/// it is the number that makes retirement rather than deletion the right answer.
/// </param>
public sealed record QuestionBankLifecycleResponse(
    Guid Id,
    string State,
    int InstantiatedQuestionCount,
    DateTimeOffset UpdatedAt);

// ---------------------------------------------------------------------------
// METRICS, EFFECTIVENESS, USAGE, ANALYTICS
//
// Every number below is DERIVED at read time from questions/responses/question_responses.
// Nothing on the respondent path writes a bank row; see QuestionBankEndpoints for the
// argument, and QuestionBankMetrics for the queries.
// ---------------------------------------------------------------------------

/// <param name="TimesAsked">
/// Completed responses to surveys carrying a copy of this question. The denominator, and
/// deliberately completed-only: a respondent who abandoned a survey on page one never saw
/// question nine, so counting them would report an effective question as a skipped one.
/// </param>
/// <param name="TimesAnswered">Stored answers to those copies.</param>
/// <param name="ResponseRate">TimesAnswered / TimesAsked as a percentage, 0 when never asked.</param>
/// <param name="SkipRate">The complement. Carried explicitly because it is the number an author acts on.</param>
public sealed record QuestionBankMetricsDto(
    Guid QuestionBankItemId,
    int SurveysUsedIn,
    int QuestionsCreated,
    int TimesAsked,
    int TimesAnswered,
    double ResponseRate,
    double SkipRate,
    double? AverageTimeSpentSeconds,
    DateTimeOffset? LastUsedAt);

public sealed record QuestionBankEffectivenessItem(
    Guid QuestionBankItemId,
    string? Text,
    string Language,
    string Category,
    string? Subcategory,
    bool IsActive,
    QuestionBankMetricsDto Metrics);

public sealed record QuestionBankEffectivenessResponse(IReadOnlyList<QuestionBankEffectivenessItem> Items);

/// <param name="ItemIds">
/// The rows to re-measure. Omitted or empty means every row the caller may WRITE, which is
/// narrower than every row they may read: a CompanyAdmin re-measuring the corpus must not
/// end up publishing a snapshot onto the global rows every other tenant reads.
/// </param>
public sealed record QuestionBankEffectivenessMeasurementRequest(
    IReadOnlyList<Guid>? ItemIds = null,
    Guid? CompanyId = null);

/// <param name="Refreshed">Rows whose stored snapshot changed.</param>
/// <param name="Examined">Rows the measurement covered.</param>
public sealed record QuestionBankEffectivenessMeasurementResponse(
    int Examined,
    int Refreshed,
    DateTimeOffset MeasuredAt,
    IReadOnlyList<QuestionBankEffectivenessItem> Items);

/// <param name="SurveyStatus">Where the survey stands now, so "used" can be told from "used and published".</param>
public sealed record QuestionBankUsageSurvey(
    Guid SurveyId,
    string? SurveyTitle,
    string SurveyStatus,
    Guid QuestionId,
    DateTimeOffset UsedAt);

public sealed record QuestionBankUsageItem(
    Guid QuestionBankItemId,
    string? Text,
    bool IsActive,
    int UsageCount,
    DateTimeOffset? LastUsedAt,
    IReadOnlyList<QuestionBankUsageSurvey> Surveys);

public sealed record QuestionBankUsageResponse(IReadOnlyList<QuestionBankUsageItem> Items);

public sealed record QuestionBankCategoryCount(
    string Category,
    string? Subcategory,
    int ItemCount,
    int ActiveItemCount);

public sealed record QuestionBankCategoriesResponse(IReadOnlyList<QuestionBankCategoryCount> Categories);

public sealed record QuestionBankTypeCount(string Type, int ItemCount);

public sealed record QuestionBankAnalyticsResponse(
    int TotalItems,
    int ActiveItems,
    int RetiredItems,
    int GlobalItems,
    int AiGeneratedItems,
    int ItemsWithVariations,
    int ItemsEverUsed,
    double AverageResponseRate,
    IReadOnlyList<QuestionBankTypeCount> ByType,
    IReadOnlyList<QuestionBankCategoryCount> ByCategory);
