using System.Globalization;
using System.Text.Json;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The one aggregation over survey responses, and the only place a distribution is
/// computed.
///
/// **The boundary with #88 (report generation), settled here.** Both this surface and
/// report generation turn the same rows into the same numbers, and two
/// implementations means two answers and eventually a support conversation about
/// which is right. The split: *aggregation* is this class -- pure, in Application,
/// dependent on nothing but its inputs; *presentation* is the endpoints, of which
/// there are now five (results, statistics, analytics, real-time-stats, and #88's
/// report generation) over one <see cref="SurveyAggregate"/>. Each must call
/// <see cref="Compute"/> and format the result; none may re-derive a percentage, a
/// mean, or a suppression decision. If a report needs a number this does not produce,
/// the number is added here and every surface gets it at once -- which is exactly how
/// the per-dimension rollup arrived.
///
/// **Why it is pure and lives in Application.** ClimateProject.Application references
/// only Domain, so this cannot reach for EF -- which is the point. The correctness
/// property this owns (grouping on the stable option value, never on display text) is
/// provable in a unit test with no Docker, and the API layer's only remaining job is
/// to project rows into the input records faithfully.
/// </summary>
public static class SurveyAggregation
{
    /// <summary>
    /// Words kept per language in an open-text cloud. Matches the 20-per-language rule
    /// <c>MicroclimateEndpoints</c> already applies, and for the same reason: top-N
    /// overall lets one busy language crowd the other out entirely, and the minority
    /// language is precisely the one an admin needs to see.
    /// </summary>
    public const int MaxWordsPerLanguage = 20;

    private static readonly char[] WordSeparators =
        [' ', '\t', '\n', '\r', '.', ',', '!', '?', ';', ':', '(', ')', '"'];

    /// <summary>
    /// Aggregates one survey's responses.
    /// </summary>
    /// <param name="questions">Every question on the survey, text and option labels already resolved for the request locale.</param>
    /// <param name="responses">Every response row, complete and partial.</param>
    /// <param name="answers">Every stored answer. Answers belonging to an incomplete response are ignored -- see the note in <see cref="CompleteResponseIds"/>.</param>
    /// <param name="departments">Departments of the owning company, for names and participation denominators.</param>
    /// <param name="targetAudienceCount">The survey's invited headcount, or null when it has none.</param>
    public static SurveyAggregate Compute(
        IReadOnlyList<AggregationQuestion> questions,
        IReadOnlyList<AggregationResponse> responses,
        IReadOnlyList<AggregationAnswer> answers,
        IReadOnlyList<AggregationDepartment> departments,
        int? targetAudienceCount)
    {
        ArgumentNullException.ThrowIfNull(questions);
        ArgumentNullException.ThrowIfNull(responses);
        ArgumentNullException.ThrowIfNull(answers);
        ArgumentNullException.ThrowIfNull(departments);

        // Demographic values arrive as raw jsonb payloads and are decoded exactly once,
        // here, before anything groups on them. Decoding at group time instead would run
        // the decoder once per breakdown and give a bare-string row (written by an
        // earlier tool or the ETL) a different fate on each surface.
        responses = [.. responses.Select(r => r with { Demographics = DecodeDemographics(r.Demographics) })];

        var completed = responses.Where(r => r.IsComplete).ToList();
        var summary = Summarise(responses, completed, targetAudienceCount);

        if (!SurveyResultsPrivacy.MeetsSurveyFloor(completed.Count))
        {
            // Counters only. See SurveyResultsPrivacy for why the participation numbers
            // survive the floor and everything per-question does not. Dimensions are
            // per-question numbers wearing a category label, so they are withheld too.
            return new SurveyAggregate(
                summary,
                [],
                [],
                [],
                IsSuppressed: true,
                SurveyResultsPrivacy.BelowMinimumRespondents,
                SurveyResultsPrivacy.MinimumRespondents);
        }

        var completeIds = CompleteResponseIds(completed);
        var counted = answers.Where(a => completeIds.Contains(a.ResponseId)).ToList();
        var answersByQuestion = counted.ToLookup(a => a.QuestionId);

        var questionResults = questions
            .OrderBy(q => q.Order)
            .Select(question => SummariseQuestion(question, answersByQuestion[question.QuestionId].ToList(), completed))
            .ToList();

        var breakdowns = new List<SurveyBreakdown>
        {
            DepartmentBreakdown(questions, completed, counted, departments),
        };
        breakdowns.AddRange(DemographicBreakdowns(questions, completed, counted));

        return new SurveyAggregate(
            summary,
            questionResults,
            DimensionRollup(questionResults),
            breakdowns,
            IsSuppressed: false,
            SuppressionReason: null,
            SurveyResultsPrivacy.MinimumSegmentRespondents);
    }

    /// <summary>
    /// Rolls the per-question results up into per-dimension (category) scores.
    ///
    /// Derived from the already-computed <see cref="SurveyQuestionResult"/> rows rather
    /// than from the raw answers, so the rollup is arithmetic over the exact numbers
    /// every surface displays -- it cannot disagree with them. Only scale questions
    /// (<see cref="QuestionTypes.NumericScale"/>) carry a score; a categorised
    /// multiple_choice question still counts toward <c>QuestionCount</c> so a reader can
    /// see the dimension is wider than its score. Questions with no category belong to
    /// no dimension -- inventing an "uncategorised" dimension would put a score on a
    /// grouping nobody designed.
    /// </summary>
    private static List<SurveyDimensionResult> DimensionRollup(IReadOnlyList<SurveyQuestionResult> questionResults)
    {
        return questionResults
            .Where(q => !string.IsNullOrWhiteSpace(q.Category))
            .GroupBy(q => q.Category!, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(group =>
            {
                // Weighted by answered count: a question 40 people answered moves the
                // dimension more than one 3 people answered, exactly as pooling every
                // numeric answer would. NumericStats already made Average null for any
                // question whose values do not all parse, so such a question contributes
                // no weight here either -- one rule, applied once.
                var scored = group.Where(q => q.Average is not null).ToList();
                var weight = scored.Sum(q => q.AnsweredCount);

                return new SurveyDimensionResult(
                    group.Key,
                    group.Count(),
                    group.Sum(q => q.AnsweredCount),
                    weight == 0
                        ? null
                        : Math.Round(scored.Sum(q => q.Average!.Value * q.AnsweredCount) / weight, 2));
            })
            .ToList();
    }

    /// <summary>
    /// Only completed responses are aggregated.
    ///
    /// A partial response is a respondent mid-thought: their answers can still change,
    /// and including them makes a published percentage move *backwards* between two
    /// polls, which reads as a bug in the numbers rather than as a person changing
    /// their mind. Both counts are reported on the summary, so nothing is hidden -- the
    /// partial respondents are visible as <c>partialCount</c>, they simply do not vote.
    /// </summary>
    private static HashSet<Guid> CompleteResponseIds(IReadOnlyList<AggregationResponse> completed)
        => [.. completed.Select(r => r.ResponseId)];

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------

    private static SurveyResultsSummary Summarise(
        IReadOnlyList<AggregationResponse> all,
        IReadOnlyList<AggregationResponse> completed,
        int? targetAudienceCount)
    {
        var partial = all.Count - completed.Count;

        double? participationRate = targetAudienceCount is > 0
            ? Percent(completed.Count, targetAudienceCount.Value)
            : null;

        var completionRate = all.Count == 0 ? 0d : Percent(completed.Count, all.Count);

        var durations = completed
            .Select(r => r.TotalTimeSeconds ?? ElapsedSeconds(r))
            .Where(seconds => seconds is > 0)
            .Select(seconds => (double)seconds!.Value)
            .ToList();

        var byLanguage = all
            .GroupBy(r => r.Language, StringComparer.Ordinal)
            .Select(g => new SurveyLanguageCount(g.Key, g.Count()))
            .OrderByDescending(l => l.Count)
            .ThenBy(l => l.Language, StringComparer.Ordinal)
            .ToList();

        return new SurveyResultsSummary(
            targetAudienceCount,
            all.Count,
            completed.Count,
            partial,
            participationRate,
            completionRate,
            durations.Count == 0 ? null : Math.Round(durations.Average(), 2),
            all.Count == 0 ? null : all.Min(r => r.StartTime),
            LastActivity(all),
            byLanguage);
    }

    private static int? ElapsedSeconds(AggregationResponse response)
        => response.CompletionTime is null
            ? null
            : (int)Math.Round((response.CompletionTime.Value - response.StartTime).TotalSeconds);

    private static DateTimeOffset? LastActivity(IReadOnlyList<AggregationResponse> all)
    {
        if (all.Count == 0)
        {
            return null;
        }

        return all.Max(r => r.CompletionTime ?? r.StartTime);
    }

    // ------------------------------------------------------------------
    // Per-question
    // ------------------------------------------------------------------

    private static SurveyQuestionResult SummariseQuestion(
        AggregationQuestion question,
        IReadOnlyList<AggregationAnswer> answers,
        IReadOnlyList<AggregationResponse> completed)
    {
        if (question.Type == QuestionTypes.OpenEnded)
        {
            var (words, suppressedWords) = WordFrequencies(answers, completed);
            return new SurveyQuestionResult(
                question.QuestionId,
                question.Order,
                question.Type,
                question.Text,
                question.Category,
                answers.Count,
                [],
                Average: null,
                Median: null,
                words,
                suppressedWords);
        }

        if (question.Type == QuestionTypes.Ranking)
        {
            return RankingResult(question, answers);
        }

        var values = new List<string>(answers.Count);
        foreach (var answer in answers)
        {
            var (value, _) = ReadStoredValue(answer.ResponseValue);
            if (value is not null)
            {
                values.Add(value);
            }
        }

        // THE group key: the stable, locale-independent option value that
        // question_responses.response_value holds. Never question.Options[..].Label --
        // a bilingual survey would then split every distribution into two buckets of
        // one, silently, with row counts that still reconcile exactly. That is the
        // failure #195's child table with its own Value column exists to prevent, and
        // it is why the option label is only ever attached *after* grouping, below.
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var value in values)
        {
            counts[value] = counts.GetValueOrDefault(value) + 1;
        }

        var buckets = OrderBuckets(question, counts.Select(c => (c.Key, c.Value, (double?)null)), values.Count);
        var (average, median) = NumericStats(question, values);

        return new SurveyQuestionResult(
            question.QuestionId,
            question.Order,
            question.Type,
            question.Text,
            question.Category,
            values.Count,
            buckets,
            average,
            median,
            [],
            0);
    }

    /// <summary>
    /// A ranking's distribution is keyed by the same stable option value as every other
    /// type. <c>Count</c> is how many respondents put that option **first** -- the
    /// headline a ranking is read for -- and <c>AverageRank</c> is its mean 1-based
    /// position across every submitted ranking, which is the number that actually
    /// orders the options. Percentage is over first-place votes, so it sums to 100.
    /// </summary>
    private static SurveyQuestionResult RankingResult(
        AggregationQuestion question,
        IReadOnlyList<AggregationAnswer> answers)
    {
        var firstPlace = new Dictionary<string, int>(StringComparer.Ordinal);
        var rankSum = new Dictionary<string, int>(StringComparer.Ordinal);
        var rankCount = new Dictionary<string, int>(StringComparer.Ordinal);
        var ranked = 0;

        foreach (var answer in answers)
        {
            var (_, ordered) = ReadStoredValue(answer.ResponseValue);
            if (ordered is null || ordered.Count == 0)
            {
                continue;
            }

            ranked++;
            for (var position = 0; position < ordered.Count; position++)
            {
                var value = ordered[position];
                rankSum[value] = rankSum.GetValueOrDefault(value) + position + 1;
                rankCount[value] = rankCount.GetValueOrDefault(value) + 1;
                if (position == 0)
                {
                    firstPlace[value] = firstPlace.GetValueOrDefault(value) + 1;
                }
            }
        }

        var rows = rankCount.Keys.Select(value => (
            Value: value,
            Count: firstPlace.GetValueOrDefault(value),
            AverageRank: (double?)Math.Round((double)rankSum[value] / rankCount[value], 2)));

        return new SurveyQuestionResult(
            question.QuestionId,
            question.Order,
            question.Type,
            question.Text,
            question.Category,
            ranked,
            OrderBuckets(question, rows, ranked),
            Average: null,
            Median: null,
            [],
            0);
    }

    /// <summary>
    /// Attaches labels and orders the buckets.
    ///
    /// Ordering follows the question's own option order, not descending count: a likert
    /// scale rendered "agree, strongly disagree, neutral..." because that is the
    /// popularity order is unreadable, and every chart downstream assumes a stable
    /// x-axis. Values with no matching option (a scale point answered without a
    /// configured option set, or an option deleted after somebody answered it) sort
    /// after the known ones, ordinally, so the output is deterministic either way.
    /// </summary>
    private static List<SurveyDistributionBucket> OrderBuckets(
        AggregationQuestion question,
        IEnumerable<(string Value, int Count, double? AverageRank)> rows,
        int total)
    {
        var optionOrder = new Dictionary<string, int>(StringComparer.Ordinal);
        var optionLabel = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var option in question.Options)
        {
            optionOrder[option.Value] = option.Order;
            optionLabel[option.Value] = option.Label;
        }

        return rows
            .OrderBy(row => optionOrder.TryGetValue(row.Value, out var order) ? order : int.MaxValue)
            .ThenBy(row => row.Value, StringComparer.Ordinal)
            .Select(row => new SurveyDistributionBucket(
                row.Value,
                optionLabel.TryGetValue(row.Value, out var label) ? label : null,
                row.Count,
                Percent(row.Count, total),
                row.AverageRank))
            .ToList();
    }

    /// <summary>
    /// Mean and median, for scale questions only.
    ///
    /// Restricted to <see cref="QuestionTypes.NumericScale"/> rather than "whatever
    /// parses as a number": a multiple_choice question whose stable option values
    /// happen to be "1".."4" is a set of codes, and averaging codes produces a number
    /// with no meaning that a chart will nonetheless plot. Returns null unless *every*
    /// answered value parses, so a single unparseable row makes the mean absent rather
    /// than quietly computed over a subset.
    /// </summary>
    private static (double? Average, double? Median) NumericStats(AggregationQuestion question, IReadOnlyList<string> values)
    {
        if (values.Count == 0 || !QuestionTypes.NumericScale.Contains(question.Type))
        {
            return (null, null);
        }

        var numbers = new List<double>(values.Count);
        foreach (var value in values)
        {
            if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            {
                return (null, null);
            }

            numbers.Add(number);
        }

        numbers.Sort();
        var middle = numbers.Count / 2;
        var median = numbers.Count % 2 == 1
            ? numbers[middle]
            : (numbers[middle - 1] + numbers[middle]) / 2d;

        return (Math.Round(numbers.Average(), 2), Math.Round(median, 2));
    }

    // ------------------------------------------------------------------
    // Open text
    // ------------------------------------------------------------------

    /// <summary>
    /// Word frequencies **bucketed by <c>Response.Language</c>**.
    ///
    /// Counting into one frequency map is the live defect the column was added for:
    /// "trabajo" and "work" are the same sentiment expressed by two respondents who
    /// were served different locales, and a single map lists them as two unrelated
    /// words, each with half the weight, neither making the top of the cloud. Bucketing
    /// by the language the respondent actually answered in is the honest answer --
    /// translating free text to merge the buckets is a different feature (and an AI
    /// one), not something an aggregation may quietly do.
    ///
    /// Words appearing in fewer than <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/>
    /// distinct responses are withheld and counted; see that class for why the floor
    /// here is 2 rather than 5.
    /// </summary>
    private static (IReadOnlyList<SurveyWordFrequency> Words, int Suppressed) WordFrequencies(
        IReadOnlyList<AggregationAnswer> answers,
        IReadOnlyList<AggregationResponse> completed)
    {
        var languageByResponse = new Dictionary<Guid, string>();
        foreach (var response in completed)
        {
            languageByResponse[response.ResponseId] = response.Language;
        }

        var occurrences = new Dictionary<(string Language, string Word), int>();
        var respondents = new Dictionary<(string Language, string Word), HashSet<Guid>>();

        foreach (var answer in answers)
        {
            var (text, _) = ReadStoredValue(answer.ResponseValue);
            text ??= answer.ResponseText;
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            var language = languageByResponse.TryGetValue(answer.ResponseId, out var found)
                ? found
                : ContentLanguages.FallbackLocale;

            foreach (var word in text.ToLowerInvariant().Split(WordSeparators, StringSplitOptions.RemoveEmptyEntries))
            {
                var key = (language, word);
                occurrences[key] = occurrences.GetValueOrDefault(key) + 1;
                if (!respondents.TryGetValue(key, out var set))
                {
                    set = [];
                    respondents[key] = set;
                }

                set.Add(answer.ResponseId);
            }
        }

        var kept = new List<SurveyWordFrequency>();
        var suppressed = 0;
        foreach (var (key, count) in occurrences)
        {
            var responseCount = respondents[key].Count;
            if (!SurveyResultsPrivacy.MeetsWordFloor(responseCount))
            {
                suppressed++;
                continue;
            }

            kept.Add(new SurveyWordFrequency(key.Language, key.Word, count, responseCount));
        }

        var top = kept
            .GroupBy(w => w.Language, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .SelectMany(g => g
                .OrderByDescending(w => w.Count)
                .ThenBy(w => w.Word, StringComparer.Ordinal)
                .Take(MaxWordsPerLanguage))
            .ToList();

        return (top, suppressed);
    }

    // ------------------------------------------------------------------
    // Breakdowns
    // ------------------------------------------------------------------

    private static SurveyBreakdown DepartmentBreakdown(
        IReadOnlyList<AggregationQuestion> questions,
        IReadOnlyList<AggregationResponse> completed,
        IReadOnlyList<AggregationAnswer> answers,
        IReadOnlyList<AggregationDepartment> departments)
    {
        var byId = departments.ToDictionary(d => d.DepartmentId);
        var grouped = completed
            .Where(r => r.DepartmentId is not null)
            .GroupBy(r => r.DepartmentId!.Value)
            .ToList();

        var segments = new List<SurveySegmentResult>();
        var suppressedSegments = 0;
        var suppressedRespondents = 0;

        foreach (var group in grouped.OrderBy(g => byId.TryGetValue(g.Key, out var d) ? d.Name : string.Empty, StringComparer.Ordinal))
        {
            var members = group.ToList();
            byId.TryGetValue(group.Key, out var department);
            var name = department?.Name;

            if (!SurveyResultsPrivacy.MeetsSegmentFloor(members.Count))
            {
                suppressedSegments++;
                suppressedRespondents += members.Count;
                segments.Add(new SurveySegmentResult(
                    "department", group.Key.ToString(), name, 0, null, IsSuppressed: true, []));
                continue;
            }

            double? participation = department is { Headcount: > 0 }
                ? Percent(members.Count, department.Headcount)
                : null;

            segments.Add(new SurveySegmentResult(
                "department",
                group.Key.ToString(),
                name,
                members.Count,
                participation,
                IsSuppressed: false,
                SegmentQuestions(questions, members, answers)));
        }

        return new SurveyBreakdown(
            "department",
            segments,
            suppressedSegments,
            suppressedRespondents,
            completed.Count(r => r.DepartmentId is null));
    }

    private static IEnumerable<SurveyBreakdown> DemographicBreakdowns(
        IReadOnlyList<AggregationQuestion> questions,
        IReadOnlyList<AggregationResponse> completed,
        IReadOnlyList<AggregationAnswer> answers)
    {
        var fields = completed
            .SelectMany(r => r.Demographics.Keys)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        foreach (var field in fields)
        {
            var segments = new List<SurveySegmentResult>();
            var suppressedSegments = 0;
            var suppressedRespondents = 0;

            var grouped = completed
                .Where(r => r.Demographics.ContainsKey(field))
                .GroupBy(r => r.Demographics[field], StringComparer.Ordinal)
                .OrderBy(g => g.Key, StringComparer.Ordinal);

            foreach (var group in grouped)
            {
                var members = group.ToList();
                if (!SurveyResultsPrivacy.MeetsSegmentFloor(members.Count))
                {
                    suppressedSegments++;
                    suppressedRespondents += members.Count;
                    segments.Add(new SurveySegmentResult(field, group.Key, null, 0, null, IsSuppressed: true, []));
                    continue;
                }

                // No participation rate: there is no denominator for "how many people in
                // the company have tenure = 3-5 years and were invited to this survey"
                // that this aggregation can see. A fabricated one is worse than none.
                segments.Add(new SurveySegmentResult(
                    field, group.Key, null, members.Count, null, IsSuppressed: false,
                    SegmentQuestions(questions, members, answers)));
            }

            yield return new SurveyBreakdown(
                field,
                segments,
                suppressedSegments,
                suppressedRespondents,
                completed.Count(r => !r.Demographics.ContainsKey(field)));
        }
    }

    private static IReadOnlyList<SurveySegmentQuestionResult> SegmentQuestions(
        IReadOnlyList<AggregationQuestion> questions,
        IReadOnlyList<AggregationResponse> members,
        IReadOnlyList<AggregationAnswer> answers)
    {
        var memberIds = members.Select(m => m.ResponseId).ToHashSet();
        var mine = answers.Where(a => memberIds.Contains(a.ResponseId)).ToLookup(a => a.QuestionId);

        return questions
            .OrderBy(q => q.Order)
            .Select(question =>
            {
                var values = new List<string>();
                foreach (var answer in mine[question.QuestionId])
                {
                    var (value, _) = ReadStoredValue(answer.ResponseValue);
                    if (value is not null)
                    {
                        values.Add(value);
                    }
                }

                var (average, _) = NumericStats(question, values);
                return new SurveySegmentQuestionResult(question.QuestionId, mine[question.QuestionId].Count(), average);
            })
            .ToList();
    }

    // ------------------------------------------------------------------
    // Storage encoding
    // ------------------------------------------------------------------

    /// <summary>
    /// Decodes a <c>question_responses.response_value</c> payload.
    ///
    /// The column is <b>jsonb</b>, so a stored single answer is the JSON string
    /// <c>"remote"</c> -- quotes included -- and a ranking is a JSON array. Grouping on
    /// the raw payload would work by accident for single values and break for nothing
    /// visible, so it is decoded here instead, once.
    ///
    /// **Duplication, declared.** #118 (PR 250, open at the time of writing) introduces
    /// <c>SurveyResponseValues.Read</c> with exactly this behaviour, as the write side's
    /// half of the same encoding. This lane cannot reference an unmerged branch and a
    /// same-named type in a second file would fail to compile once both land, so this
    /// is a deliberate private copy. **When #118 merges, delete this method and call
    /// <c>SurveyResponseValues.Read</c>** -- the encoding must have one owner, and the
    /// write side is the right one.
    /// </summary>
    internal static (string? Value, IReadOnlyList<string>? Values) ReadStoredValue(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return (null, null);
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind switch
            {
                JsonValueKind.String => (document.RootElement.GetString(), null),
                JsonValueKind.Number => (document.RootElement.GetRawText(), null),
                JsonValueKind.Array => (null, (IReadOnlyList<string>)document.RootElement
                    .EnumerateArray()
                    .Select(element => element.ValueKind == JsonValueKind.String
                        ? element.GetString()
                        : element.GetRawText())
                    .Where(value => !string.IsNullOrEmpty(value))
                    .Select(value => value!)
                    .ToList()),
                _ => (null, null),
            };
        }
        catch (JsonException)
        {
            // A row written by an earlier tool or by the ETL can legitimately hold a
            // shape this code does not model. It contributes nothing rather than 500ing
            // the whole results page.
            return (null, null);
        }
    }

    /// <summary>
    /// Decodes one response's demographic payloads. A field whose value does not decode
    /// to a non-empty scalar is dropped rather than grouped under an empty key -- an
    /// empty-string segment is a bucket that means nothing and would still be counted
    /// against the disclosure floor.
    /// </summary>
    private static IReadOnlyDictionary<string, string> DecodeDemographics(IReadOnlyDictionary<string, string> raw)
    {
        var decoded = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (field, payload) in raw)
        {
            var (value, _) = ReadStoredValue(payload);
            if (!string.IsNullOrWhiteSpace(value))
            {
                decoded[field] = value;
            }
        }

        return decoded;
    }

    private static double Percent(int part, int whole)
        => whole <= 0 ? 0d : Math.Round(part * 100d / whole, 2);
}
