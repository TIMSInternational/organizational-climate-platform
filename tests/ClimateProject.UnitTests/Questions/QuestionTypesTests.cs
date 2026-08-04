using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Questions;

namespace ClimateProject.UnitTests.Questions;

/// <summary>
/// #196. These tests exist because the product had five disagreeing question-type
/// vocabularies and nothing noticed. They pin each context's accepted set exactly --
/// both what it accepts and what it rejects -- so a future divergence is a failing
/// test rather than a silent import failure at cutover.
///
/// Asserting exact set equality rather than "contains" is deliberate: a vocabulary
/// check that only asserts membership passes vacuously when someone adds a type, and
/// adding a type without rendering or answer validation for it is precisely how
/// unanswerable questions get created.
/// </summary>
public class QuestionTypesTests
{
    [Fact]
    public void Canonical_set_is_exactly_the_documented_vocabulary()
    {
        Assert.Equal(
            ["likert", "multiple_choice", "ranking", "open_ended", "yes_no", "rating", "emoji_rating"],
            QuestionTypes.All);
    }

    // Legacy Survey.ts:4-11 allowed exactly these six. Surveys have no write endpoint
    // yet (#56-#61), so this set exists to be built against -- which is the point of
    // defining it before the survey path exists rather than after it diverges.
    [Fact]
    public void Survey_set_matches_the_six_legacy_survey_types()
    {
        Assert.Equal(
            ["likert", "multiple_choice", "ranking", "open_ended", "yes_no", "rating"],
            QuestionTypes.ForSurvey);
    }

    [Fact]
    public void Microclimate_set_is_exactly_the_five_supported_types()
    {
        Assert.Equal(
            ["likert", "multiple_choice", "open_ended", "yes_no", "rating"],
            QuestionTypes.ForMicroclimate);
    }

    // The bug this issue was filed for: the old list was
    // ["multiple_choice", "open_text", "rating", "yes_no"], which rejected three types
    // legacy microclimates allowed.
    [Theory]
    [InlineData("likert")]
    [InlineData("open_ended")]
    public void Microclimate_accepts_the_legacy_types_it_used_to_reject(string type)
    {
        Assert.Contains(type, MicroclimateValidation.ValidQuestionTypes);
    }

    // "open_text" was a target-only invention and is gone. Keeping an explicit
    // rejection test means a well-meaning revert to the old name fails loudly instead
    // of quietly reintroducing the mismatch with legacy data.
    [Fact]
    public void Open_text_is_no_longer_a_recognised_type_anywhere()
    {
        Assert.DoesNotContain("open_text", QuestionTypes.All);
        Assert.DoesNotContain("open_text", QuestionTypes.ForSurvey);
        Assert.DoesNotContain("open_text", QuestionTypes.ForMicroclimate);
        Assert.DoesNotContain("open_text", MicroclimateValidation.ValidQuestionTypes);
    }

    // emoji_rating is canonical but deliberately not valid on a microclimate: a
    // MicroclimateQuestion has nowhere to store an emoji set (QuestionEmojiOption is
    // keyed to survey QuestionId), so accepting it would create unanswerable
    // questions. This test pins that as intentional rather than forgotten.
    [Fact]
    public void Emoji_rating_is_canonical_but_not_yet_valid_on_a_microclimate()
    {
        Assert.Contains("emoji_rating", QuestionTypes.All);
        Assert.DoesNotContain("emoji_rating", QuestionTypes.ForMicroclimate);
    }

    // Nothing in the schema can represent a matrix question -- no row/column
    // structure on Question -- so it must not appear in a vocabulary that claims to
    // describe what the product supports. Tracked as a parity gap against legacy
    // QuestionLibrary.
    [Fact]
    public void Matrix_is_not_claimed_as_supported()
    {
        Assert.DoesNotContain("matrix", QuestionTypes.All);
    }

    [Fact]
    public void Every_context_subset_is_drawn_from_the_canonical_set()
    {
        Assert.All(QuestionTypes.ForSurvey, t => Assert.Contains(t, QuestionTypes.All));
        Assert.All(QuestionTypes.ForMicroclimate, t => Assert.Contains(t, QuestionTypes.All));
        Assert.All(QuestionTypes.FreeText, t => Assert.Contains(t, QuestionTypes.All));
        Assert.All(QuestionTypes.NumericScale, t => Assert.Contains(t, QuestionTypes.All));
    }

    // Guard the guard: the assertion above passes vacuously against an empty subset.
    [Fact]
    public void Subsets_are_non_empty()
    {
        Assert.NotEmpty(QuestionTypes.All);
        Assert.NotEmpty(QuestionTypes.ForSurvey);
        Assert.NotEmpty(QuestionTypes.ForMicroclimate);
        Assert.NotEmpty(QuestionTypes.FreeText);
        Assert.NotEmpty(QuestionTypes.NumericScale);
    }

    // The word cloud must count free text only. If a constrained type ever leaked
    // into FreeText, rating values and option labels would be fed into
    // word-frequency counting.
    [Fact]
    public void Free_text_contains_only_open_ended()
    {
        Assert.Equal(["open_ended"], QuestionTypes.FreeText);
    }

    [Fact]
    public void Numeric_scale_is_likert_and_rating()
    {
        Assert.Equal(["likert", "rating"], QuestionTypes.NumericScale);
    }

    // MicroclimateValidation must stay derived rather than reverting to its own
    // literal list -- reference equality proves it is the same array instance.
    [Fact]
    public void Microclimate_validation_is_derived_from_the_canonical_set()
    {
        Assert.Same(QuestionTypes.ForMicroclimate, MicroclimateValidation.ValidQuestionTypes);
    }
}
