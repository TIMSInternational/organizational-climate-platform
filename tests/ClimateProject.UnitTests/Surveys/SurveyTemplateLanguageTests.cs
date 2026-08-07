using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyTemplateLanguageTests
{
    private static TemplateQuestion Question(string? textEn, string? textEs, int order = 0)
        => new()
        {
            Id = Guid.NewGuid(),
            TemplateId = Guid.NewGuid(),
            TextEn = textEn,
            TextEs = textEs,
            Type = QuestionTypes.OpenEnded,
            Order = order,
        };

    [Fact]
    public void Both_halves_authored_is_both()
        => Assert.Equal(ContentLanguages.Both, SurveyTemplateLanguage.Infer([Question("How are you?", "¿Cómo estás?")]));

    [Fact]
    public void English_only_is_english()
        => Assert.Equal(ContentLanguages.English, SurveyTemplateLanguage.Infer([Question("How are you?", null)]));

    [Fact]
    public void Spanish_only_is_spanish()
        => Assert.Equal(ContentLanguages.Spanish, SurveyTemplateLanguage.Infer([Question(null, "¿Cómo estás?")]));

    [Fact]
    public void A_template_is_bilingual_when_ANY_question_carries_both_halves()
    {
        // Deliberately the union rather than the intersection. A half-translated template
        // is bilingual content with a gap, and calling it monolingual would hide the gap
        // instead of letting the survey's publish gate name it.
        var language = SurveyTemplateLanguage.Infer(
        [
            Question("How are you?", null, 0),
            Question(null, "¿Qué cambiarías?", 1),
        ]);

        Assert.Equal(ContentLanguages.Both, language);
    }

    [Fact]
    public void Whitespace_is_not_authored_content()
        => Assert.Equal(ContentLanguages.English, SurveyTemplateLanguage.Infer([Question("How are you?", "   ")]));

    [Fact]
    public void A_template_with_no_questions_has_no_inferable_language()
    {
        // Null, not "en". There is nothing to read, so the caller decides -- guessing
        // English here is how an empty Spanish company's template would come back
        // labelled English for no reason a user could see.
        Assert.Null(SurveyTemplateLanguage.Infer([]));
    }

    [Fact]
    public void The_comment_prompt_defaults_do_not_make_every_template_bilingual()
    {
        // Both comment_prompt columns are NOT NULL with per-language DB defaults (#195),
        // so every row on earth has both. Inferring from them would report every template
        // as 'both' and silently disable the Spanish fallback for English-only content.
        var englishOnly = Question("How are you?", null);
        Assert.Equal("Please explain your answer:", englishOnly.CommentPromptEn);
        Assert.Equal("Por favor explica tu respuesta:", englishOnly.CommentPromptEs);

        Assert.Equal(ContentLanguages.English, SurveyTemplateLanguage.Infer([englishOnly]));
    }

    [Fact]
    public void A_spanish_only_template_read_in_english_resolves_to_spanish_and_says_so()
    {
        // The end-to-end reason inference exists. Without a content language,
        // LocalizedContent.Resolve has no single-language fallback to reach for and a
        // Spanish-only template requested with ?lang=en resolves to NOTHING.
        var question = Question(null, "¿Qué cambiarías?");
        var inferred = SurveyTemplateLanguage.Infer([question]);

        var withInference = LocalizedContent.Resolve(question.TextEn, question.TextEs, "en", inferred);
        Assert.Equal("¿Qué cambiarías?", withInference.Text);
        Assert.Equal(ContentLanguages.Spanish, withInference.ResolvedLocale);
        Assert.True(withInference.IsFallback);

        var withoutInference = LocalizedContent.Resolve(question.TextEn, question.TextEs, "en", null);
        Assert.Null(withoutInference.Text);
    }
}
