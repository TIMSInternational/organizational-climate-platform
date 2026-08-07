using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyTemplateQuestionsTests
{
    private static readonly Guid TemplateId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid QuestionId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static LocalizedInput Both(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = en, ["es"] = es });

    private static bool Prepare(
        List<CreateSurveyTemplateQuestionInput> inputs,
        string language,
        out IReadOnlyList<PreparedTemplateQuestion> prepared,
        out string? error)
        => SurveyTemplateQuestions.TryPrepare(inputs, TemplateId, language, () => QuestionId, out prepared, out error);

    [Fact]
    public void A_bare_string_is_attributed_to_the_declared_authoring_language()
    {
        Assert.True(Prepare(
            [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("¿Cómo estás?"), QuestionTypes.OpenEnded)],
            ContentLanguages.Spanish,
            out var prepared,
            out _));

        var question = Assert.Single(prepared).Question;
        Assert.Null(question.TextEn);
        Assert.Equal("¿Cómo estás?", question.TextEs);
        Assert.Equal(TemplateId, question.TemplateId);
    }

    [Fact]
    public void A_bare_string_is_REJECTED_when_the_template_is_authored_in_both()
    {
        // The rule that keeps a monolingual string from being filed into one column and
        // presented as the other language's content.
        Assert.False(Prepare(
            [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("How are you?"), QuestionTypes.OpenEnded)],
            ContentLanguages.Both,
            out _,
            out var error));

        Assert.Contains("authored in both languages", error);
    }

    [Fact]
    public void Locale_keyed_text_writes_both_columns()
    {
        Assert.True(Prepare(
            [new CreateSurveyTemplateQuestionInput(Both("How are you?", "¿Cómo estás?"), QuestionTypes.OpenEnded)],
            ContentLanguages.Both,
            out var prepared,
            out _));

        var question = Assert.Single(prepared).Question;
        Assert.Equal(("How are you?", "¿Cómo estás?"), (question.TextEn, question.TextEs));
    }

    [Fact]
    public void An_option_value_is_derived_from_the_english_label_when_none_is_given()
    {
        Assert.True(Prepare(
            [
                new CreateSurveyTemplateQuestionInput(
                    Both("Which area?", "¿Qué área?"),
                    QuestionTypes.MultipleChoice,
                    Options:
                    [
                        new CreateSurveyTemplateQuestionOptionInput(null, Both("Leadership", "Liderazgo")),
                        new CreateSurveyTemplateQuestionOptionInput("tooling", Both("Tooling", "Herramientas")),
                    ]),
            ],
            ContentLanguages.Both,
            out var prepared,
            out _));

        var options = Assert.Single(prepared).Options.OrderBy(o => o.Order).ToList();
        Assert.Equal(["Leadership", "tooling"], options.Select(o => o.Value));
        Assert.All(options, o => Assert.Equal(QuestionId, o.TemplateQuestionId));
    }

    [Fact]
    public void The_derived_value_matches_the_survey_paths_rule_exactly()
    {
        // Both write paths call SurveyValidation.DeriveOptionValue. If a template and a
        // survey ever derived different values from the same labels, answers to the
        // template's surveys would stop aggregating with answers to hand-built ones -- no
        // error, reconciling row counts, every chart silently split.
        Assert.Equal("Leadership", SurveyValidation.DeriveOptionValue(null, "Leadership", "Liderazgo"));
        Assert.Equal("Liderazgo", SurveyValidation.DeriveOptionValue(null, null, "Liderazgo"));
        Assert.Equal("explicit", SurveyValidation.DeriveOptionValue("  explicit  ", "Leadership", null));
        Assert.Null(SurveyValidation.DeriveOptionValue(null, null, null));
    }

    [Fact]
    public void Duplicate_option_values_are_rejected_by_name()
    {
        Assert.False(Prepare(
            [
                new CreateSurveyTemplateQuestionInput(
                    LocalizedInput.FromBare("Which area?"),
                    QuestionTypes.MultipleChoice,
                    Options:
                    [
                        new CreateSurveyTemplateQuestionOptionInput("leadership", LocalizedInput.FromBare("Leadership")),
                        new CreateSurveyTemplateQuestionOptionInput("leadership", LocalizedInput.FromBare("Liderazgo")),
                    ]),
            ],
            ContentLanguages.English,
            out _,
            out var error));

        Assert.Contains("duplicate option value 'leadership'", error);
    }

    [Fact]
    public void Multiple_choice_needs_at_least_two_options()
    {
        Assert.False(Prepare(
            [
                new CreateSurveyTemplateQuestionInput(
                    LocalizedInput.FromBare("Which area?"),
                    QuestionTypes.MultipleChoice,
                    Options: [new CreateSurveyTemplateQuestionOptionInput("leadership", LocalizedInput.FromBare("Leadership"))]),
            ],
            ContentLanguages.English,
            out _,
            out var error));

        Assert.Contains("require at least 2 options", error);
    }

    [Fact]
    public void The_question_type_vocabulary_is_the_surveys_own()
    {
        // emoji_rating is a real platform type but not a survey type (QuestionTypes.ForSurvey).
        // A template that could hold one would produce a survey that cannot.
        Assert.False(Prepare(
            [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("How do you feel?"), QuestionTypes.EmojiRating)],
            ContentLanguages.English,
            out _,
            out var error));

        Assert.Contains("Invalid question type: emoji_rating", error);
    }

    [Fact]
    public void Text_is_required()
    {
        Assert.False(Prepare(
            [new CreateSurveyTemplateQuestionInput(null, QuestionTypes.OpenEnded, Order: 3)],
            ContentLanguages.English,
            out _,
            out var error));

        Assert.Contains("Question 3 requires text", error);
    }

    [Fact]
    public void Two_questions_may_not_share_an_order()
    {
        Assert.False(SurveyTemplateQuestions.TryPrepare(
            [
                new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("First"), QuestionTypes.OpenEnded, Order: 0),
                new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("Second"), QuestionTypes.OpenEnded, Order: 0),
            ],
            TemplateId,
            ContentLanguages.English,
            Guid.NewGuid,
            out _,
            out var error));

        Assert.Contains("Two questions share order 0", error);
    }

    [Fact]
    public void Scale_bounds_must_be_ordered()
    {
        Assert.False(Prepare(
            [
                new CreateSurveyTemplateQuestionInput(
                    LocalizedInput.FromBare("Rate it"),
                    QuestionTypes.Rating,
                    ScaleMin: 5,
                    ScaleMax: 1),
            ],
            ContentLanguages.English,
            out _,
            out var error));

        Assert.Contains("ScaleMin must be less than ScaleMax", error);
    }

    [Fact]
    public void An_unsupplied_comment_prompt_keeps_BOTH_per_language_defaults()
    {
        // #195 added the Spanish default precisely because the single shared column served
        // an English prompt to Spanish-only content. Writing null here would put a null in
        // a NOT NULL column and discard that fix.
        Assert.True(Prepare(
            [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("¿Cómo estás?"), QuestionTypes.OpenEnded)],
            ContentLanguages.Spanish,
            out var prepared,
            out _));

        var question = Assert.Single(prepared).Question;
        Assert.Equal("Please explain your answer:", question.CommentPromptEn);
        Assert.Equal("Por favor explica tu respuesta:", question.CommentPromptEs);
    }

    [Fact]
    public void No_questions_prepares_nothing_and_succeeds()
    {
        Assert.True(SurveyTemplateQuestions.TryPrepare(null, TemplateId, ContentLanguages.English, Guid.NewGuid, out var prepared, out var error));
        Assert.Empty(prepared);
        Assert.Null(error);
    }
}
