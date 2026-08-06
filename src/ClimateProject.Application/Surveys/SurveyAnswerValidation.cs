using System.Globalization;
using System.Text.Json;
using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The encoding rule for <c>question_responses.response_value</c>, in one place.
///
/// **The column is <c>jsonb</c>** (see <c>QuestionResponseConfiguration</c>). A bare
/// option value is not valid JSON, and Postgres rejects it with 22P02 rather than
/// coercing it -- so every write goes through here.
///
/// **One encoding for every question type**, deliberately:
/// <list type="bullet">
/// <item>a single-valued answer is the JSON string of the option's stable, locale
/// independent <c>Value</c> -- <c>"agree"</c>, <c>"yes"</c>, <c>"4"</c>;</item>
/// <item>a ranking is a JSON array of those same strings, in the respondent's order;</item>
/// <item>an open-ended answer is the JSON string of the text the respondent typed.</item>
/// </list>
///
/// Numeric scales are stored as the string form of their value rather than as a JSON
/// number on purpose. Aggregation joins <c>response_value</c> back to
/// <c>question_options.value</c>, which is <c>character varying</c>; keeping one
/// encoding means one join for every type and no branch that could disagree with
/// itself. A mean over a scale casts once, at read time, in the one place that wants a
/// number.
/// </summary>
public static class SurveyResponseValues
{
    /// <summary>The jsonb payload for a single-valued answer.</summary>
    public static string Single(string value) => JsonSerializer.Serialize(value);

    /// <summary>The jsonb payload for an ordered (ranking) answer.</summary>
    public static string Ordered(IEnumerable<string> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return JsonSerializer.Serialize(values.ToArray());
    }

    /// <summary>
    /// Reads a stored payload back into either a single value or an ordered list, for
    /// resume. Returns null for anything that is not one of the two shapes this class
    /// writes, so a hand-written row cannot crash the respond page.
    /// </summary>
    public static (string? Value, IReadOnlyList<string>? Values) Read(string? json)
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
                JsonValueKind.Array => (null, document.RootElement
                    .EnumerateArray()
                    .Select(element => element.ValueKind == JsonValueKind.String
                        ? element.GetString()
                        : element.ToString())
                    .Where(value => value is not null)
                    .Select(value => value!)
                    .ToList()),
                _ => (null, null),
            };
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }
}

/// <summary>One question of a survey, reduced to everything answering it depends on.</summary>
/// <param name="OptionValues">
/// The question's stable, locale-independent option values -- never labels. This is the
/// list an answer is checked against and the list it is stored from, and it is the whole
/// reason options moved into a child table in #195: two respondents choosing the same
/// option in two languages must produce the same string, or every distribution, chart,
/// benchmark and export splits with row counts that still reconcile exactly.
/// </param>
public sealed record SurveyAnswerableQuestion(
    Guid QuestionId,
    string Type,
    bool Required,
    int? ScaleMin,
    int? ScaleMax,
    IReadOnlyList<string> OptionValues);

/// <summary>One answer as submitted, before validation.</summary>
/// <param name="Value">The single answer: an option value, a scale point, or -- for an open-ended question -- the text.</param>
/// <param name="Values">The ordered answer, for <see cref="QuestionTypes.Ranking"/> only.</param>
/// <param name="Text">The respondent's free-text comment. Not accepted on an open-ended question, whose answer is already text.</param>
public sealed record SurveyAnswerSubmission(
    Guid QuestionId,
    string? Value,
    IReadOnlyList<string>? Values,
    string? Text,
    int? TimeSpentSeconds);

/// <summary>One answer that passed validation, in the exact shape the two columns take.</summary>
public sealed record ValidatedSurveyAnswer(
    Guid QuestionId,
    string ResponseValue,
    string? ResponseText,
    int? TimeSpentSeconds);

/// <param name="Error">Null when every answer validated; otherwise the first failure, addressed to the caller.</param>
public sealed record SurveyAnswerValidationResult(
    IReadOnlyList<ValidatedSurveyAnswer> Answers,
    string? Error)
{
    public static SurveyAnswerValidationResult Failed(string error) => new([], error);
}

/// <summary>
/// Answer validation for the survey respond path.
///
/// Lives in Application rather than in the endpoint for the same reason
/// <see cref="SurveyStatuses"/> does: this is the rule that decides whether a
/// respondent's answer is counted, it is the least recoverable thing in the domain --
/// a corrupted response cannot be re-collected -- and it has to be provable without
/// Docker.
///
/// <c>MicroclimateEndpoints.SubmitResponseAsync</c> is the structural precedent and
/// the rules below match it deliberately, so the two surfaces cannot drift into
/// disagreeing about what "yes" or a 1-5 rating means. Two survey-only differences:
/// surveys carry <c>scale_min</c>/<c>scale_max</c> columns, which are honoured here
/// instead of a hard-coded 1-5; and surveys support
/// <see cref="QuestionTypes.Ranking"/>, which a microclimate has no rendering for.
/// </summary>
public static class SurveyAnswerValidation
{
    /// <summary>The scale bounds used when a question configures neither an option set nor explicit bounds.</summary>
    public const int DefaultScaleMin = 1;

    /// <inheritdoc cref="DefaultScaleMin"/>
    public const int DefaultScaleMax = 5;

    /// <summary>The two canonical yes/no codes. Codes, not labels -- they are locale independent by construction.</summary>
    public const string YesCode = "yes";

    /// <inheritdoc cref="YesCode"/>
    public const string NoCode = "no";

    /// <param name="completing">
    /// True when this submission finishes the response. Required questions and the
    /// "a response must contain something" rule are only enforced then, so a partial save
    /// of question 1 of 40 is not rejected for the 39 it has not reached.
    /// </param>
    /// <param name="alreadyAnswered">
    /// Question ids already stored on the response being resumed. A required question
    /// answered in an earlier partial save must not be demanded again at completion.
    /// </param>
    public static SurveyAnswerValidationResult Validate(
        IReadOnlyList<SurveyAnswerableQuestion> questions,
        IReadOnlyList<SurveyAnswerSubmission> submissions,
        bool completing,
        IReadOnlyCollection<Guid> alreadyAnswered)
    {
        ArgumentNullException.ThrowIfNull(questions);
        ArgumentNullException.ThrowIfNull(submissions);
        ArgumentNullException.ThrowIfNull(alreadyAnswered);

        var questionsById = questions.ToDictionary(q => q.QuestionId);
        var validated = new List<ValidatedSurveyAnswer>(submissions.Count);
        var seen = new HashSet<Guid>();

        foreach (var submission in submissions)
        {
            if (!questionsById.TryGetValue(submission.QuestionId, out var question))
            {
                // Not skipped, unlike the microclimate path: an answer to a question that
                // is not on this survey is a client bug, and silently dropping it loses a
                // respondent's answer with nothing anywhere recording that it happened.
                return SurveyAnswerValidationResult.Failed(
                    $"Question {submission.QuestionId} does not belong to this survey");
            }

            if (!seen.Add(submission.QuestionId))
            {
                return SurveyAnswerValidationResult.Failed(
                    $"Question {submission.QuestionId} was answered more than once in this submission");
            }

            var answer = ValidateOne(question, submission, out var error);
            if (error is not null)
            {
                return SurveyAnswerValidationResult.Failed(
                    $"Invalid answer for question {submission.QuestionId}: {error}");
            }

            validated.Add(answer!);
        }

        if (!completing)
        {
            return new SurveyAnswerValidationResult(validated, null);
        }

        var answeredIds = new HashSet<Guid>(alreadyAnswered);
        answeredIds.UnionWith(seen);

        var missing = questions
            .Where(q => q.Required && !answeredIds.Contains(q.QuestionId))
            .Select(q => q.QuestionId)
            .ToList();
        if (missing.Count > 0)
        {
            return SurveyAnswerValidationResult.Failed(
                $"Required questions are unanswered: {string.Join(", ", missing)}");
        }

        // An empty completed response is not a response. It would still increment
        // ResponseCount, move the participation rate and count towards every
        // small-group threshold, while contributing nothing any of them can read.
        if (answeredIds.Count == 0 && questions.Count > 0)
        {
            return SurveyAnswerValidationResult.Failed("A completed response must answer at least one question");
        }

        return new SurveyAnswerValidationResult(validated, null);
    }

    private static ValidatedSurveyAnswer? ValidateOne(
        SurveyAnswerableQuestion question,
        SurveyAnswerSubmission submission,
        out string? error)
    {
        error = null;

        if (question.Type == QuestionTypes.Ranking)
        {
            return ValidateRanking(question, submission, out error);
        }

        if (submission.Values is { Count: > 0 })
        {
            error = $"type '{question.Type}' takes a single value, not an ordered list";
            return null;
        }

        var value = submission.Value?.Trim();
        if (string.IsNullOrEmpty(value))
        {
            error = "an answer is required; omit the question entirely to leave it unanswered";
            return null;
        }

        if (question.Type == QuestionTypes.OpenEnded)
        {
            // The answer IS the text. Accepting a separate comment as well would leave two
            // free-text fields on one question with nothing saying which one a word cloud,
            // a sentiment score or an export should read.
            if (!string.IsNullOrWhiteSpace(submission.Text))
            {
                error = "an open_ended question's answer is already its text, so it takes no separate comment";
                return null;
            }

            return new ValidatedSurveyAnswer(
                question.QuestionId,
                SurveyResponseValues.Single(value),
                value,
                submission.TimeSpentSeconds);
        }

        var stored = question.Type switch
        {
            QuestionTypes.YesNo => ValidateYesNo(value, out error),
            QuestionTypes.MultipleChoice => ValidateChoice(question, value, allowScaleFallback: false, out error),
            _ when QuestionTypes.NumericScale.Contains(question.Type)
                => ValidateChoice(question, value, allowScaleFallback: true, out error),
            // Every member of QuestionTypes.ForSurvey is handled above; this arm exists so
            // a type added to the vocabulary later fails loudly here instead of storing
            // whatever arbitrary string a client sent.
            _ => Unsupported(question.Type, out error),
        };

        if (error is not null)
        {
            return null;
        }

        var comment = string.IsNullOrWhiteSpace(submission.Text) ? null : submission.Text.Trim();
        return new ValidatedSurveyAnswer(question.QuestionId, stored!, comment, submission.TimeSpentSeconds);
    }

    private static string? Unsupported(string type, out string? error)
    {
        error = $"question type '{type}' cannot be answered through this endpoint";
        return null;
    }

    private static string? ValidateYesNo(string value, out string? error)
    {
        if (value.Equals(YesCode, StringComparison.OrdinalIgnoreCase))
        {
            error = null;
            return SurveyResponseValues.Single(YesCode);
        }

        if (value.Equals(NoCode, StringComparison.OrdinalIgnoreCase))
        {
            error = null;
            return SurveyResponseValues.Single(NoCode);
        }

        error = $"must be '{YesCode}' or '{NoCode}'";
        return null;
    }

    /// <param name="allowScaleFallback">
    /// True for likert/rating, which fall back to a numeric scale when no option set is
    /// configured. False for multiple_choice, which has no valid answer without one --
    /// accepting free text there is how an unanswerable question comes to look answered.
    /// </param>
    private static string? ValidateChoice(
        SurveyAnswerableQuestion question,
        string value,
        bool allowScaleFallback,
        out string? error)
    {
        if (question.OptionValues.Count > 0)
        {
            if (question.OptionValues.Contains(value, StringComparer.Ordinal))
            {
                error = null;
                return SurveyResponseValues.Single(value);
            }

            error = $"must be one of: {string.Join(", ", question.OptionValues)}";
            return null;
        }

        if (!allowScaleFallback)
        {
            error = "this question has no configured options to answer";
            return null;
        }

        var min = question.ScaleMin ?? DefaultScaleMin;
        var max = question.ScaleMax ?? DefaultScaleMax;
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var point)
            && point >= min
            && point <= max)
        {
            error = null;
            return SurveyResponseValues.Single(point.ToString(CultureInfo.InvariantCulture));
        }

        error = $"must be a whole number between {min} and {max}";
        return null;
    }

    private static ValidatedSurveyAnswer? ValidateRanking(
        SurveyAnswerableQuestion question,
        SurveyAnswerSubmission submission,
        out string? error)
    {
        if (question.OptionValues.Count == 0)
        {
            error = "this question has no configured options to rank";
            return null;
        }

        var submitted = submission.Values?
            .Select(v => v?.Trim() ?? string.Empty)
            .ToList() ?? [];

        // A ranking must be a permutation, not a subset and not a multiset. A partial or
        // repeated ranking has no defined meaning to any aggregation that reads it back.
        if (submitted.Count != question.OptionValues.Count
            || submitted.Distinct(StringComparer.Ordinal).Count() != submitted.Count
            || submitted.Except(question.OptionValues, StringComparer.Ordinal).Any())
        {
            error = $"must rank each of these exactly once: {string.Join(", ", question.OptionValues)}";
            return null;
        }

        error = null;
        var comment = string.IsNullOrWhiteSpace(submission.Text) ? null : submission.Text.Trim();
        return new ValidatedSurveyAnswer(
            question.QuestionId,
            SurveyResponseValues.Ordered(submitted),
            comment,
            submission.TimeSpentSeconds);
    }
}
