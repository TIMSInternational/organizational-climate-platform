using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Microclimates;

/// <summary>
/// One option as a respondent sees it and as the server stores it.
///
/// <see cref="Value"/> is the stable, locale-independent key that must be submitted
/// and that lands in <c>question_responses.response_value</c>. <see cref="Label"/> is
/// display only, already resolved for the request's locale. A client that submits the
/// label instead of the value is rejected -- which is the point: it is the only way
/// two respondents answering the same question in different languages can be counted
/// as having given the same answer.
/// </summary>
public sealed record QuestionOptionDto(int Order, string Value, string? Label);

/// <summary>
/// One point on an <c>emoji_rating</c> question's scale (#198).
/// </summary>
/// <param name="Emoji">
/// The glyph, for the eye only. A client must render it with the accessible name
/// hidden from it (<c>aria-hidden</c>) and name the control with
/// <paramref name="Label"/> instead: an emoji-only radio is announced by whatever the
/// reader's own emoji dictionary calls the character, in whatever language that
/// dictionary happens to be in.
/// </param>
/// <param name="Value">
/// The stable key. This is what must be submitted -- as its decimal string, since
/// answers travel as text -- and what lands in the stored answer, for exactly the
/// reason <see cref="QuestionOptionDto.Value"/> gives.
/// </param>
/// <param name="Label">
/// The option's accessible name, already resolved for the request's locale.
/// </param>
public sealed record QuestionEmojiOptionDto(int Order, string Emoji, int Value, string? Label);

/// <summary>
/// Read shape. Note there is no <c>textEn</c>/<c>textEs</c>: <see cref="Text"/> is
/// already resolved for the requested locale. Adding a third language changes nothing
/// here, which is the entire reason #195 chose paired columns over a translation
/// table.
/// </summary>
/// <param name="EmojiOptions">
/// The scale of an <c>emoji_rating</c> question, and null on every other type -- a
/// separate field from <paramref name="Options"/> rather than a reuse of it, because
/// the glyph and the name it is announced by are two values, not one (#198).
/// </param>
public sealed record QuestionDto(
    Guid Id,
    string? Text,
    string Type,
    List<QuestionOptionDto>? Options,
    bool Required,
    int Order,
    List<QuestionEmojiOptionDto>? EmojiOptions = null);

public sealed record CreateQuestionOptionInput(string? Value, LocalizedInput? Label);

/// <param name="Value">
/// Optional. Defaults to the option's 1-based position on the scale, so an author who
/// simply lists five faces gets 1..5 without having to say so.
/// </param>
/// <param name="Label">
/// Required in practice: it is the option's accessible name, and a scale point with no
/// name is rejected rather than stored. Localized like every other authored string.
/// </param>
public sealed record CreateQuestionEmojiOptionInput(string? Emoji, int? Value, LocalizedInput? Label);

public sealed record CreateQuestionInput(
    LocalizedInput? Text,
    string Type,
    List<CreateQuestionOptionInput>? Options,
    bool Required,
    int Order,
    List<CreateQuestionEmojiOptionInput>? EmojiOptions = null);

public sealed record MicroclimateListItem(
    Guid Id,
    string? Title,
    Guid CompanyId,
    string Status,
    string Language,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset CreatedAt);

public sealed record MicroclimateListResponse(IReadOnlyList<MicroclimateListItem> Microclimates);

public sealed record MicroclimateDetail(
    Guid Id,
    string? Title,
    string? Description,
    Guid CompanyId,
    Guid CreatedBy,
    string Status,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool AnonymousResponses,
    bool ShowLiveResults,
    List<QuestionDto> Questions,
    // The content's own language ('es' | 'en' | 'both'), the locale this payload was
    // actually resolved for, and the fields that had to fall back to a different
    // language to produce a value. Every fallback self-reports rather than silently
    // substituting -- an admin gets a badge, an export gets a label, and "no
    // untranslated strings" is checkable rather than hoped for.
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

// Deliberately reduced view served to unauthenticated callers (the public
// MicroclimateRespondPage) -- see GetAsync. Must never carry CompanyId, CreatedBy,
// Description, ResponseCount/TargetParticipantCount, or any other internal/participation
// data that an anonymous visitor holding a GUID has no business seeing.
public sealed record PublicMicroclimateDetail(
    Guid Id,
    string? Title,
    string Status,
    List<QuestionDto> Questions,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

public sealed record CreateMicroclimateRequest(
    LocalizedInput? Title,
    LocalizedInput? Description,
    Guid CompanyId,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    int TargetParticipantCount,
    bool AnonymousResponses,
    Guid? TemplateId,
    List<CreateQuestionInput>? Questions,
    string? Timezone = null,
    // 'es' | 'en' | 'both'. Defaults to the company's own language, so 'both' is an
    // opt-in rather than something every survey inherits.
    string? Language = null);

public sealed record UpdateMicroclimateRequest(
    LocalizedInput? Title,
    LocalizedInput? Description,
    string? Status,
    DateTimeOffset? EndTime,
    string? Language = null);

/// <summary>
/// Word counts are kept per respondent language. Before <c>Response.Language</c> and
/// this field existed, "trabajo" and "work" were separate entries in one map with
/// nothing recording which language a respondent had answered in.
/// </summary>
public sealed record WordCloudEntry(string Text, int Value, string Language);

public sealed record LiveResultsDetail(
    double SentimentScore,
    string EngagementLevel,
    List<WordCloudEntry> WordCloud,
    int ResponseCount,
    int TargetParticipantCount);

/// <param name="Language">
/// The locale the respondent was served. Recorded, never inferred from the answer
/// text -- see Response.Language. Defaults to the microclimate's own language when
/// it has exactly one.
/// </param>
public sealed record SubmitResponseRequest(Dictionary<Guid, string> Answers, string? Language = null);

// ---------------------------------------------------------------------------
// Status lifecycle (#131)
// ---------------------------------------------------------------------------

/// <summary>
/// Body of <c>PUT /microclimates/{id}/status</c>. A dedicated route rather than a field on
/// <c>PUT /microclimates/{id}</c> because a lifecycle move is not a content edit: it has its
/// own legality rules, its own 409, and -- unlike a title change -- it is the thing that
/// makes content visible to respondents. Mirrors <c>PUT /surveys/{id}/status</c>.
/// </summary>
public sealed record UpdateMicroclimateStatusRequest(string Status);

/// <summary>
/// Body of <c>POST /microclimates/bulk</c>.
/// </summary>
/// <param name="Action">One of <c>MicroclimateValidation.BulkActions</c>.</param>
public sealed record BulkMicroclimateActionRequest(string Action, List<Guid> MicroclimateIds);

/// <param name="Message">
/// Null on success. On failure, why -- including "Microclimate not found" for a row in
/// another tenant, which is deliberate: see the handler.
/// </param>
public sealed record BulkMicroclimateActionResult(Guid MicroclimateId, bool Succeeded, string? Message);

/// <summary>
/// Per-item outcomes. A bulk call is 200 even when every item failed: the transport
/// succeeded, and the caller needs the breakdown to know which ids to retry.
/// </summary>
public sealed record BulkMicroclimateActionResponse(IReadOnlyList<BulkMicroclimateActionResult> Results);

// ---------------------------------------------------------------------------
// Insights (#131, blocked on #67)
// ---------------------------------------------------------------------------

public sealed record MicroclimateInsightItem(
    Guid Id,
    string Type,
    string Message,
    double Confidence,
    DateTimeOffset Timestamp);

/// <param name="Generated">
/// False whenever no generator has ever run for this microclimate. Stated explicitly so a
/// client can tell "the model found nothing worth saying" from "nothing has analysed this",
/// which an empty <paramref name="Insights"/> list alone cannot express.
/// </param>
/// <param name="Reason">
/// Machine-readable, null when <paramref name="Generated"/> is true. The client renders it
/// through its own i18n keys -- this is not display copy.
/// </param>
public sealed record MicroclimateInsightsResponse(
    Guid MicroclimateId,
    bool Generated,
    string? Reason,
    IReadOnlyList<MicroclimateInsightItem> Insights);

// ---------------------------------------------------------------------------
// Export (#131)
// ---------------------------------------------------------------------------

/// <param name="Occurrences">
/// Word occurrences, NOT distinct respondents -- one person writing "visa visa" contributes
/// 2. See <see cref="MicroclimateExport"/> for why that distinction bounds what the word
/// floor can promise.
/// </param>
public sealed record MicroclimateExportWord(string Text, string Language, int Occurrences);

/// <summary>
/// A microclimate session reduced to everything that survives disclosure control.
/// </summary>
/// <param name="IsSuppressed">
/// True when the session is below <c>SurveyResultsPrivacy.MinimumRespondents</c>. Free text
/// is then withheld entirely and <paramref name="Words"/> is empty.
/// </param>
/// <param name="WithheldWordCount">
/// Distinct words withheld, by either floor. Reported rather than silently dropped so the
/// reader can tell "nobody wrote anything" from "this was withheld" -- and so the export
/// still reconciles against <paramref name="ResponseCount"/>, which is never suppressed.
/// </param>
/// <param name="SuppressionReason">Machine-readable, null when nothing was withheld.</param>
/// <param name="FallbackFields">
/// The fields that had to fall back to a different language to produce a value. Carried
/// because <see cref="MicroclimateDetail"/> promises exactly this -- "an admin gets a badge,
/// an export gets a label" -- and an export that resolved a missing Spanish title to the
/// English one without saying so is the silent substitution #195 exists to prevent, in the
/// one artefact that leaves the building.
/// </param>
public sealed record MicroclimateExport(
    Guid Id,
    string? Title,
    string? Description,
    Guid CompanyId,
    string Status,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    int ResponseCount,
    int TargetParticipantCount,
    double? ParticipationPercent,
    string EngagementLevel,
    double SentimentScore,
    IReadOnlyList<QuestionDto> Questions,
    IReadOnlyList<MicroclimateExportWord> Words,
    bool IsSuppressed,
    int WithheldWordCount,
    string? SuppressionReason,
    DateTimeOffset GeneratedAt);
