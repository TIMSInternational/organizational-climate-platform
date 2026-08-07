namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES for results / statistics / analytics / real-time-stats.
//
// Same non-negotiable as SurveyDtos.cs (#195): not one property below is
// En/Es-shaped. Question text and option labels arrive already resolved for the
// request's locale, with ResolvedLocale and FallbackFields saying which locale that
// actually turned out to be.
//
// The one place a language appears as data rather than as a shape is
// SurveyLanguageCount and SurveyWordFrequency.Language -- and that is the point.
// Free text cannot be resolved into a requested locale (you cannot write "the
// Spanish" of a sentence somebody typed in English), so it is counted per language
// and labelled with the language it was written in. Adding a third language adds
// rows there, not fields.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AGGREGATION INPUTS
//
// Plain records rather than entities, because ClimateProject.Application references
// only Domain -- it cannot see EF, and the whole point of putting the aggregation
// here is that it is provable without Docker. The API layer projects rows into these.
// ---------------------------------------------------------------------------

/// <summary>
/// One option, already resolved for the request locale.
/// <see cref="Value"/> is the stable locale-independent key that
/// <c>question_responses.response_value</c> holds and that every distribution groups
/// on; <see cref="Label"/> is display only and is never grouped on.
/// </summary>
public sealed record AggregationOption(int Order, string Value, string? Label);

/// <summary>One question of the survey, reduced to what aggregating it needs.</summary>
public sealed record AggregationQuestion(
    Guid QuestionId,
    int Order,
    string Type,
    string? Text,
    string? Category,
    int? ScaleMin,
    int? ScaleMax,
    IReadOnlyList<AggregationOption> Options);

/// <summary>
/// One submitted response.
/// </summary>
/// <param name="Demographics">
/// The <c>{field: rawJsonbValue}</c> map from <c>response_demographics</c>. The values
/// are the **raw jsonb payloads**, not decoded strings -- same rule and same reason as
/// <see cref="AggregationAnswer.ResponseValue"/>: decoding is the aggregator's job, so
/// exactly one piece of code knows the encoding. The decoded values are the stable
/// locale-independent ones, never labels, exactly as <c>SnapshotEntryValues.Flatten</c>
/// produces them -- a breakdown whose groups changed name with the reader's language
/// would split every segment.
/// </param>
public sealed record AggregationResponse(
    Guid ResponseId,
    string Language,
    Guid? DepartmentId,
    bool IsComplete,
    DateTimeOffset StartTime,
    DateTimeOffset? CompletionTime,
    int? TotalTimeSeconds,
    IReadOnlyDictionary<string, string> Demographics);

/// <summary>
/// One stored answer. <paramref name="ResponseValue"/> is the **raw jsonb payload**,
/// not a decoded value -- decoding is the aggregator's job so exactly one piece of
/// code knows the encoding.
/// </summary>
public sealed record AggregationAnswer(
    Guid ResponseId,
    Guid QuestionId,
    string ResponseValue,
    string? ResponseText);

/// <summary>A department, for naming and for a participation denominator.</summary>
public sealed record AggregationDepartment(Guid DepartmentId, string Name, int Headcount);

// ---------------------------------------------------------------------------
// OUTPUTS
// ---------------------------------------------------------------------------

/// <summary>How many responses arrived in each language. Rows, not fields.</summary>
public sealed record SurveyLanguageCount(string Language, int Count);

/// <summary>
/// Participation, always returned -- even below the disclosure floor. A count of
/// responses identifies nobody, and it is the number that tells an admin whether to
/// keep chasing.
/// </summary>
/// <param name="ParticipationRate">
/// Completed / invited, 0-100 with two decimals. Null when the survey has no
/// <c>TargetAudienceCount</c>, rather than a fabricated denominator.
/// </param>
/// <param name="CompletionRate">Completed / started, 0-100 with two decimals. Zero when nothing has started.</param>
public sealed record SurveyResultsSummary(
    int? InvitedCount,
    int ResponseCount,
    int CompletedCount,
    int PartialCount,
    double? ParticipationRate,
    double CompletionRate,
    double? AverageCompletionSeconds,
    DateTimeOffset? FirstResponseAt,
    DateTimeOffset? LastResponseAt,
    IReadOnlyList<SurveyLanguageCount> ByLanguage);

/// <summary>
/// One bucket of a question's distribution, keyed by the stable option value.
/// </summary>
/// <param name="Value">
/// The stable, locale-independent option value. **This is the group key.** Two
/// respondents reading different languages who pick the same option land here
/// together; grouping on <paramref name="Label"/> instead would split them into two
/// buckets of one with row counts that still reconcile exactly, which is the silent
/// failure #195's child table exists to prevent.
/// </param>
/// <param name="Label">Display text for <paramref name="Value"/>, resolved for the request locale. Null when the option carries no label in any locale, or when the value is a bare scale point.</param>
/// <param name="AverageRank">Mean 1-based position for a ranking question, null for every other type.</param>
public sealed record SurveyDistributionBucket(
    string Value,
    string? Label,
    int Count,
    double Percentage,
    double? AverageRank);

/// <summary>One word of one language's cloud, with the number of distinct responses it appeared in.</summary>
public sealed record SurveyWordFrequency(string Language, string Word, int Count, int ResponseCount);

/// <param name="Distribution">Empty for an open-ended question, which has no option set.</param>
/// <param name="Average">Mean of the numeric answers, for scale questions whose values all parse as numbers. Null otherwise.</param>
/// <param name="Words">Word frequencies bucketed by <c>Response.Language</c>, for open-ended questions only. Verbatim text is never returned.</param>
/// <param name="SuppressedWordCount">Distinct words withheld for appearing in fewer than <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/> responses.</param>
public sealed record SurveyQuestionResult(
    Guid QuestionId,
    int Order,
    string Type,
    string? Text,
    string? Category,
    int AnsweredCount,
    IReadOnlyList<SurveyDistributionBucket> Distribution,
    double? Average,
    double? Median,
    IReadOnlyList<SurveyWordFrequency> Words,
    int SuppressedWordCount);

/// <summary>One question's numbers within one segment. Deliberately not a full distribution -- see <see cref="SurveySegmentResult"/>.</summary>
public sealed record SurveySegmentQuestionResult(Guid QuestionId, int AnsweredCount, double? Average);

/// <summary>
/// One department or one demographic value, and how it answered.
///
/// <see cref="Questions"/> carries answered counts and averages, **not** full
/// distributions: a per-segment distribution is departments x questions x options
/// rows, which is unbounded in a way the whole-survey distribution is not, and the
/// question a breakdown answers is "which group is unhappier", not "what did each
/// group's histogram look like". A caller that needs one segment's histogram asks
/// for that segment.
/// </summary>
/// <param name="Dimension">"department", or the demographic field key.</param>
/// <param name="Key">The department id, or the stable demographic value. Locale-independent, like every other group key here.</param>
/// <param name="IsSuppressed">True when the segment is below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>. <see cref="Questions"/> is then empty and <see cref="RespondentCount"/> is 0 -- the withheld headcount is reported once, on the breakdown, not per segment.</param>
public sealed record SurveySegmentResult(
    string Dimension,
    string Key,
    string? Label,
    int RespondentCount,
    double? ParticipationRate,
    bool IsSuppressed,
    IReadOnlyList<SurveySegmentQuestionResult> Questions);

/// <param name="UnsegmentedRespondentCount">
/// Completed responses that carry no value for this dimension at all. For departments
/// that is mostly anonymous responses, whose department #118 strips at write time --
/// they are counted here so the breakdown reconciles against
/// <see cref="SurveyResultsSummary.CompletedCount"/> rather than appearing to lose people.
/// </param>
public sealed record SurveyBreakdown(
    string Dimension,
    IReadOnlyList<SurveySegmentResult> Segments,
    int SuppressedSegmentCount,
    int SuppressedRespondentCount,
    int UnsegmentedRespondentCount);

/// <summary>
/// The one aggregation every results surface is a presentation over.
/// </summary>
/// <param name="IsSuppressed">True when the survey is below <see cref="SurveyResultsPrivacy.MinimumRespondents"/>. <paramref name="Questions"/> and <paramref name="Breakdowns"/> are then empty; <paramref name="Summary"/> is still populated.</param>
public sealed record SurveyAggregate(
    SurveyResultsSummary Summary,
    IReadOnlyList<SurveyQuestionResult> Questions,
    IReadOnlyList<SurveyBreakdown> Breakdowns,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize);

/// <summary>
/// <c>GET /surveys/{id}/results</c> -- the per-question view.
/// </summary>
public sealed record SurveyResultsResponse(
    Guid SurveyId,
    string? Title,
    string Status,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    SurveyResultsSummary Summary,
    IReadOnlyList<SurveyQuestionResult> Questions,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize,
    DateTimeOffset GeneratedAt);

/// <summary>
/// <c>GET /surveys/{id}/statistics</c> -- the segment view. Same aggregation, other half.
/// </summary>
public sealed record SurveyStatisticsResponse(
    Guid SurveyId,
    string? Title,
    string Status,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    SurveyResultsSummary Summary,
    IReadOnlyList<SurveyBreakdown> Breakdowns,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize,
    DateTimeOffset GeneratedAt);

/// <summary>
/// <c>GET /surveys/{id}/analytics</c> -- both halves in one round trip, for a dashboard
/// that renders distributions and breakdowns together. Not a third computation: it is
/// the same <see cref="SurveyAggregate"/> the other two serve, which is what makes
/// "results says 62% and analytics says 58%" impossible rather than unlikely.
/// </summary>
public sealed record SurveyAnalyticsResponse(
    Guid SurveyId,
    string? Title,
    string Status,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    SurveyResultsSummary Summary,
    IReadOnlyList<SurveyQuestionResult> Questions,
    IReadOnlyList<SurveyBreakdown> Breakdowns,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize,
    DateTimeOffset GeneratedAt);

/// <summary>One department's live participation.</summary>
public sealed record SurveyDepartmentParticipation(
    Guid DepartmentId,
    string Name,
    int CompletedCount,
    double? ParticipationRate);

/// <summary>
/// <c>GET /surveys/{id}/real-time-stats</c> -- counters only, for the polling loop.
///
/// This payload deliberately never touches <c>question_responses</c>: it is three
/// aggregate queries over <c>responses</c> filtered by <c>survey_id</c>, returning
/// O(departments) rows regardless of how many questions, options or answers exist. A
/// poll costs an index scan and a count, not a scan of every answer ever submitted.
/// The heavy per-question aggregation lives on <c>/results</c>, which is not a poll
/// endpoint.
/// </summary>
/// <param name="PollIntervalSeconds">
/// What the server wants the client's poll interval to be, so the cadence is a server
/// decision rather than a constant copied into each caller. 5s, matching the
/// microclimates design decision ("polling, not WebSockets") and
/// <c>web/src/components/charts/usePolling.ts</c>'s 3-5s permitted range.
/// </param>
/// <param name="IsLive">False once the survey can no longer accept responses -- the signal for the client to stop polling rather than keep asking a closed survey forever.</param>
public sealed record SurveyRealTimeStatsResponse(
    Guid SurveyId,
    string Status,
    bool IsLive,
    int? InvitedCount,
    int ResponseCount,
    int CompletedCount,
    int InProgressCount,
    double? ParticipationRate,
    double CompletionRate,
    DateTimeOffset? LastResponseAt,
    IReadOnlyList<SurveyDepartmentParticipation> ByDepartment,
    int SuppressedDepartmentCount,
    int SuppressedRespondentCount,
    int UnsegmentedRespondentCount,
    int MinimumGroupSize,
    int PollIntervalSeconds,
    DateTimeOffset GeneratedAt);
