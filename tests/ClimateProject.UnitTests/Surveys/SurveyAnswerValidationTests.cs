using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The rules that decide whether a respondent's answer is counted, and in what form it
/// lands in <c>question_responses</c>.
///
/// These run without Docker on purpose. A corrupted response cannot be re-collected, so
/// the encoding and the option-value rule have to be provable on every push rather than
/// only where a Postgres container is available.
/// </summary>
public class SurveyAnswerValidationTests
{
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static SurveyAnswerableQuestion Question(
        string type,
        bool required = false,
        int? scaleMin = null,
        int? scaleMax = null,
        params string[] optionValues)
        => new(QuestionId, type, required, scaleMin, scaleMax, optionValues);

    private static SurveyAnswerValidationResult Validate(
        SurveyAnswerableQuestion question,
        SurveyAnswerSubmission submission,
        bool completing = true)
        => SurveyAnswerValidation.Validate([question], [submission], completing, []);

    // ------------------------------------------------------------------
    // The encoding. response_value is jsonb.
    // ------------------------------------------------------------------

    [Fact]
    public void A_stored_answer_is_valid_json_not_a_bare_value()
    {
        var result = Validate(
            Question(QuestionTypes.MultipleChoice, optionValues: ["remote", "hybrid"]),
            new SurveyAnswerSubmission(QuestionId, "remote", null, null, null));

        Assert.Null(result.Error);
        var stored = Assert.Single(result.Answers).ResponseValue;

        // A bare "remote" is not JSON and Postgres rejects a jsonb insert of it with
        // 22P02. The quotes are the fix, and they are what this asserts.
        Assert.Equal("\"remote\"", stored);
        Assert.Equal(JsonValueKind.String, JsonDocument.Parse(stored).RootElement.ValueKind);
    }

    [Fact]
    public void A_ranking_is_stored_as_a_json_array_of_the_same_stable_values()
    {
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.Ranking, optionValues: ["pay", "growth", "balance"])],
            [new SurveyAnswerSubmission(QuestionId, null, ["balance", "pay", "growth"], null, null)],
            completing: true,
            alreadyAnswered: []);

        Assert.Null(result.Error);
        Assert.Equal("[\"balance\",\"pay\",\"growth\"]", Assert.Single(result.Answers).ResponseValue);
    }

    [Fact]
    public void A_scale_point_is_stored_as_a_json_string_so_one_join_reads_every_type()
    {
        var result = Validate(
            Question(QuestionTypes.Rating),
            new SurveyAnswerSubmission(QuestionId, "4", null, null, null));

        Assert.Null(result.Error);
        Assert.Equal("\"4\"", Assert.Single(result.Answers).ResponseValue);
    }

    [Theory]
    [InlineData("\"remote\"", "remote")]
    [InlineData("\"4\"", "4")]
    public void A_stored_single_value_reads_back_unchanged(string json, string expected)
    {
        var (value, values) = SurveyResponseValues.Read(json);
        Assert.Equal(expected, value);
        Assert.Null(values);
    }

    [Fact]
    public void A_stored_ranking_reads_back_in_order()
    {
        var (value, values) = SurveyResponseValues.Read("[\"b\",\"a\"]");
        Assert.Null(value);
        Assert.Equal(["b", "a"], values);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json at all")]
    [InlineData("{\"unexpected\":true}")]
    public void An_unreadable_stored_value_yields_nothing_rather_than_throwing(string? json)
    {
        var (value, values) = SurveyResponseValues.Read(json);
        Assert.Null(value);
        Assert.Null(values);
    }

    // ------------------------------------------------------------------
    // The option-value rule -- the whole reason options moved to a child table.
    // ------------------------------------------------------------------

    [Fact]
    public void An_answer_is_matched_against_the_stable_value_not_the_label()
    {
        // "remote" is the stable value; "Remoto"/"Remote" are the labels a respondent
        // reads. Accepting a label is what splits one option into two strings the moment
        // a bilingual survey is answered in both languages -- with no error and with row
        // counts that reconcile exactly.
        var question = Question(QuestionTypes.MultipleChoice, optionValues: ["remote", "hybrid"]);

        Assert.Null(Validate(question, new SurveyAnswerSubmission(QuestionId, "remote", null, null, null)).Error);
        Assert.NotNull(Validate(question, new SurveyAnswerSubmission(QuestionId, "Remoto", null, null, null)).Error);
        Assert.NotNull(Validate(question, new SurveyAnswerSubmission(QuestionId, "Remote", null, null, null)).Error);
    }

    [Fact]
    public void Two_respondents_reading_different_languages_store_the_same_string()
    {
        var question = Question(QuestionTypes.MultipleChoice, optionValues: ["very_satisfied", "satisfied"]);

        var fromEnglish = Validate(question, new SurveyAnswerSubmission(QuestionId, "very_satisfied", null, null, null));
        var fromSpanish = Validate(question, new SurveyAnswerSubmission(QuestionId, "very_satisfied", null, null, null));

        Assert.Equal(
            Assert.Single(fromEnglish.Answers).ResponseValue,
            Assert.Single(fromSpanish.Answers).ResponseValue);
    }

    [Fact]
    public void Option_values_are_matched_case_sensitively()
    {
        var result = Validate(
            Question(QuestionTypes.MultipleChoice, optionValues: ["remote"]),
            new SurveyAnswerSubmission(QuestionId, "Remote", null, null, null));

        Assert.NotNull(result.Error);
    }

    // ------------------------------------------------------------------
    // Per-type rules
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("yes", "\"yes\"")]
    [InlineData("YES", "\"yes\"")]
    [InlineData("No", "\"no\"")]
    public void Yes_no_normalises_to_the_canonical_code(string submitted, string expected)
    {
        var result = Validate(Question(QuestionTypes.YesNo), new SurveyAnswerSubmission(QuestionId, submitted, null, null, null));

        Assert.Null(result.Error);
        Assert.Equal(expected, Assert.Single(result.Answers).ResponseValue);
    }

    [Theory]
    [InlineData("maybe")]
    [InlineData("si")]
    [InlineData("1")]
    public void Yes_no_rejects_anything_else(string submitted)
        => Assert.NotNull(Validate(Question(QuestionTypes.YesNo), new SurveyAnswerSubmission(QuestionId, submitted, null, null, null)).Error);

    [Theory]
    [InlineData(QuestionTypes.Likert)]
    [InlineData(QuestionTypes.Rating)]
    public void A_numeric_scale_without_options_defaults_to_one_through_five(string type)
    {
        Assert.Null(Validate(Question(type), new SurveyAnswerSubmission(QuestionId, "1", null, null, null)).Error);
        Assert.Null(Validate(Question(type), new SurveyAnswerSubmission(QuestionId, "5", null, null, null)).Error);
        Assert.NotNull(Validate(Question(type), new SurveyAnswerSubmission(QuestionId, "0", null, null, null)).Error);
        Assert.NotNull(Validate(Question(type), new SurveyAnswerSubmission(QuestionId, "6", null, null, null)).Error);
        Assert.NotNull(Validate(Question(type), new SurveyAnswerSubmission(QuestionId, "3.5", null, null, null)).Error);
    }

    [Fact]
    public void A_numeric_scale_honours_the_questions_own_bounds()
    {
        // The survey schema carries scale_min/scale_max, which the microclimate one does
        // not. Hard-coding 1-5 here would silently reject the top half of a 0-10 NPS
        // question the authoring surface is perfectly able to create.
        var question = Question(QuestionTypes.Likert, scaleMin: 0, scaleMax: 10);

        Assert.Null(Validate(question, new SurveyAnswerSubmission(QuestionId, "0", null, null, null)).Error);
        Assert.Null(Validate(question, new SurveyAnswerSubmission(QuestionId, "10", null, null, null)).Error);
        Assert.NotNull(Validate(question, new SurveyAnswerSubmission(QuestionId, "11", null, null, null)).Error);
    }

    [Fact]
    public void A_numeric_scale_with_an_option_set_uses_the_option_set_instead()
    {
        var question = Question(QuestionTypes.Likert, optionValues: ["strongly_disagree", "neutral", "strongly_agree"]);

        Assert.Null(Validate(question, new SurveyAnswerSubmission(QuestionId, "neutral", null, null, null)).Error);
        Assert.NotNull(Validate(question, new SurveyAnswerSubmission(QuestionId, "3", null, null, null)).Error);
    }

    [Fact]
    public void Multiple_choice_without_options_is_unanswerable_rather_than_free_text()
    {
        var result = Validate(
            Question(QuestionTypes.MultipleChoice),
            new SurveyAnswerSubmission(QuestionId, "anything", null, null, null));

        Assert.Contains("no configured options", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void A_ranking_must_be_a_permutation_of_the_option_set()
    {
        var question = Question(QuestionTypes.Ranking, optionValues: ["a", "b", "c"]);

        SurveyAnswerValidationResult Rank(params string[] order)
            => SurveyAnswerValidation.Validate(
                [question],
                [new SurveyAnswerSubmission(QuestionId, null, order, null, null)],
                completing: true,
                alreadyAnswered: []);

        Assert.Null(Rank("c", "a", "b").Error);
        Assert.NotNull(Rank("a", "b").Error);           // incomplete
        Assert.NotNull(Rank("a", "b", "b").Error);      // repeated
        Assert.NotNull(Rank("a", "b", "d").Error);      // unknown option
    }

    [Fact]
    public void A_single_valued_type_refuses_an_ordered_list()
    {
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.MultipleChoice, optionValues: ["a", "b"])],
            [new SurveyAnswerSubmission(QuestionId, null, ["a", "b"], null, null)],
            completing: true,
            alreadyAnswered: []);

        Assert.NotNull(result.Error);
    }

    [Fact]
    public void An_open_ended_answer_is_its_own_text_in_both_columns()
    {
        var result = Validate(
            Question(QuestionTypes.OpenEnded),
            new SurveyAnswerSubmission(QuestionId, "  Too many meetings.  ", null, null, null));

        Assert.Null(result.Error);
        var answer = Assert.Single(result.Answers);
        Assert.Equal("\"Too many meetings.\"", answer.ResponseValue);
        Assert.Equal("Too many meetings.", answer.ResponseText);
    }

    [Fact]
    public void An_open_ended_question_refuses_a_separate_comment()
    {
        // Two free-text fields on one question with nothing saying which the word cloud,
        // the sentiment score and the export should read is a fork waiting to happen.
        var result = Validate(
            Question(QuestionTypes.OpenEnded),
            new SurveyAnswerSubmission(QuestionId, "Too many meetings.", null, "and too long", null));

        Assert.NotNull(result.Error);
    }

    [Fact]
    public void A_comment_on_any_other_type_lands_in_response_text()
    {
        var result = Validate(
            Question(QuestionTypes.YesNo),
            new SurveyAnswerSubmission(QuestionId, "no", null, "  the tooling is the problem  ", 12));

        var answer = Assert.Single(result.Answers);
        Assert.Equal("\"no\"", answer.ResponseValue);
        Assert.Equal("the tooling is the problem", answer.ResponseText);
        Assert.Equal(12, answer.TimeSpentSeconds);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_submitted_answer_with_no_value_is_an_error_not_a_blank_row(string? value)
        => Assert.NotNull(Validate(Question(QuestionTypes.YesNo), new SurveyAnswerSubmission(QuestionId, value, null, null, null)).Error);

    // ------------------------------------------------------------------
    // Shape of the submission
    // ------------------------------------------------------------------

    [Fact]
    public void An_answer_to_a_question_from_another_survey_is_refused_not_dropped()
    {
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.YesNo)],
            [new SurveyAnswerSubmission(Guid.NewGuid(), "yes", null, null, null)],
            completing: true,
            alreadyAnswered: []);

        Assert.Contains("does not belong to this survey", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void The_same_question_answered_twice_in_one_payload_is_refused()
    {
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.YesNo)],
            [
                new SurveyAnswerSubmission(QuestionId, "yes", null, null, null),
                new SurveyAnswerSubmission(QuestionId, "no", null, null, null),
            ],
            completing: true,
            alreadyAnswered: []);

        Assert.Contains("more than once", result.Error, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Completion vs partial save
    // ------------------------------------------------------------------

    [Fact]
    public void A_partial_save_does_not_demand_the_required_questions()
    {
        var answered = Guid.NewGuid();
        var required = Guid.NewGuid();

        var result = SurveyAnswerValidation.Validate(
            [
                new SurveyAnswerableQuestion(answered, QuestionTypes.YesNo, false, null, null, []),
                new SurveyAnswerableQuestion(required, QuestionTypes.YesNo, true, null, null, []),
            ],
            [new SurveyAnswerSubmission(answered, "yes", null, null, null)],
            completing: false,
            alreadyAnswered: []);

        Assert.Null(result.Error);
    }

    [Fact]
    public void Completing_demands_every_required_question()
    {
        var required = Guid.NewGuid();

        var result = SurveyAnswerValidation.Validate(
            [new SurveyAnswerableQuestion(required, QuestionTypes.YesNo, true, null, null, [])],
            [],
            completing: true,
            alreadyAnswered: []);

        Assert.Contains("Required questions are unanswered", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void A_required_question_answered_in_an_earlier_partial_save_is_not_demanded_again()
    {
        var required = Guid.NewGuid();

        var result = SurveyAnswerValidation.Validate(
            [new SurveyAnswerableQuestion(required, QuestionTypes.YesNo, true, null, null, [])],
            [],
            completing: true,
            alreadyAnswered: [required]);

        Assert.Null(result.Error);
    }

    [Fact]
    public void A_completed_response_must_contain_at_least_one_answer()
    {
        // An empty completed response still increments ResponseCount, moves the
        // participation rate and counts towards every small-group threshold, while
        // contributing nothing any of them can read.
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.YesNo)],
            [],
            completing: true,
            alreadyAnswered: []);

        Assert.Contains("at least one question", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void The_first_failure_stops_the_whole_submission()
    {
        // All-or-nothing, deliberately: a half-stored response is worse than a rejected
        // one, because nothing afterwards can tell which half is missing.
        var good = Guid.NewGuid();

        var result = SurveyAnswerValidation.Validate(
            [
                new SurveyAnswerableQuestion(good, QuestionTypes.YesNo, false, null, null, []),
                new SurveyAnswerableQuestion(QuestionId, QuestionTypes.MultipleChoice, false, null, null, ["a"]),
            ],
            [
                new SurveyAnswerSubmission(good, "yes", null, null, null),
                new SurveyAnswerSubmission(QuestionId, "z", null, null, null),
            ],
            completing: true,
            alreadyAnswered: []);

        Assert.NotNull(result.Error);
        Assert.Empty(result.Answers);
    }

    [Fact]
    public void Every_survey_question_type_can_be_answered()
    {
        // Derived from the canonical vocabulary rather than a second literal list, so a
        // type added to QuestionTypes.ForSurvey fails here until it has an answer rule --
        // the alternative is a type that authors fine and then rejects every answer.
        foreach (var type in QuestionTypes.ForSurvey)
        {
            var question = Question(type, optionValues: ["a", "b"]);
            var submission = type == QuestionTypes.Ranking
                ? new SurveyAnswerSubmission(QuestionId, null, ["a", "b"], null, null)
                : new SurveyAnswerSubmission(
                    QuestionId,
                    type switch
                    {
                        QuestionTypes.YesNo => "yes",
                        QuestionTypes.OpenEnded => "some words",
                        _ => "a",
                    },
                    null,
                    null,
                    null);

            var result = SurveyAnswerValidation.Validate([question], [submission], completing: true, alreadyAnswered: []);
            Assert.Null(result.Error);
        }
    }

    // ------------------------------------------------------------------
    // Taking an answer back (#369).
    // ------------------------------------------------------------------

    private static readonly Guid SecondQuestionId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void A_cleared_question_is_reported_for_deletion()
    {
        var question = Question(QuestionTypes.MultipleChoice, optionValues: ["remote", "hybrid"]);

        var result = SurveyAnswerValidation.Validate(
            [question],
            [],
            completing: false,
            alreadyAnswered: [QuestionId],
            cleared: [QuestionId]);

        Assert.Null(result.Error);
        Assert.Empty(result.Answers);
        Assert.Equal(QuestionId, Assert.Single(result.ClearedQuestionIds));
    }

    /// <summary>
    /// Same reason an answer to a foreign question is refused rather than dropped: a
    /// delete naming a question this survey does not have is a client bug, and obeying it
    /// quietly is a destructive no-op nobody ever finds.
    /// </summary>
    [Fact]
    public void Clearing_a_question_that_is_not_on_this_survey_is_refused()
    {
        var result = SurveyAnswerValidation.Validate(
            [Question(QuestionTypes.MultipleChoice, optionValues: ["remote"])],
            [],
            completing: false,
            alreadyAnswered: [],
            cleared: [SecondQuestionId]);

        Assert.NotNull(result.Error);
        Assert.Empty(result.ClearedQuestionIds);
    }

    [Fact]
    public void Answering_and_clearing_the_same_question_at_once_is_refused_rather_than_guessed()
    {
        var question = Question(QuestionTypes.MultipleChoice, optionValues: ["remote"]);

        var result = SurveyAnswerValidation.Validate(
            [question],
            [new SurveyAnswerSubmission(QuestionId, "remote", null, null, null)],
            completing: false,
            alreadyAnswered: [],
            cleared: [QuestionId]);

        Assert.NotNull(result.Error);
    }

    /// <summary>
    /// The interaction that makes this a validation concern and not only a writer one.
    ///
    /// <c>alreadyAnswered</c> exists so a required question answered on an earlier tick is
    /// not demanded again at completion. A question cleared in the SAME submission is
    /// about to stop being answered, so counting it would let a respondent answer a
    /// required question, erase it, and still complete -- leaving a response marked
    /// complete with the required answer missing.
    /// </summary>
    [Fact]
    public void A_required_answer_cleared_in_the_same_submission_cannot_be_completed_around()
    {
        var required = Question(QuestionTypes.MultipleChoice, required: true, optionValues: ["remote"]);

        var result = SurveyAnswerValidation.Validate(
            [required],
            [],
            completing: true,
            alreadyAnswered: [QuestionId],
            cleared: [QuestionId]);

        Assert.NotNull(result.Error);
        Assert.Contains("Required questions are unanswered", result.Error);
    }

    /// <summary>
    /// The same subtraction, on the "a completed response must contain something" gate:
    /// erasing the only answer must not leave a completed response with nothing in it.
    /// </summary>
    [Fact]
    public void Clearing_the_only_answer_cannot_produce_an_empty_completed_response()
    {
        var optional = Question(QuestionTypes.MultipleChoice, optionValues: ["remote"]);

        var result = SurveyAnswerValidation.Validate(
            [optional],
            [],
            completing: true,
            alreadyAnswered: [QuestionId],
            cleared: [QuestionId]);

        Assert.NotNull(result.Error);
        Assert.Contains("must answer at least one question", result.Error);
    }
}
