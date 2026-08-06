using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyValidationTests
{
    [Fact]
    public void Question_types_are_derived_from_the_canonical_vocabulary_not_redeclared()
    {
        // Same assertion MicroclimateValidation earns: reference equality, so a future
        // edit cannot quietly fork this list from QuestionTypes and reintroduce the
        // five-disagreeing-vocabularies problem #196 fixed.
        Assert.Same(QuestionTypes.ForSurvey, SurveyValidation.ValidQuestionTypes);
    }

    [Fact]
    public void Every_valid_survey_question_type_is_a_member_of_the_canonical_set()
        => Assert.All(SurveyValidation.ValidQuestionTypes, type => Assert.Contains(type, QuestionTypes.All));

    [Fact]
    public void Bulk_actions_are_the_three_that_map_onto_existing_single_survey_operations()
        => Assert.Equal(["archive", "close", "delete"], SurveyValidation.BulkActions);

    [Fact]
    public void Copy_suffixes_are_per_locale_so_a_spanish_title_never_gets_an_english_one()
    {
        Assert.Equal("Team pulse (Copy)", SurveyValidation.WithCopySuffix("Team pulse", SurveyValidation.CopySuffixEn));
        Assert.Equal("Pulso de equipo (Copia)", SurveyValidation.WithCopySuffix("Pulso de equipo", SurveyValidation.CopySuffixEs));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_unauthored_title_is_left_alone_rather_than_becoming_a_bare_suffix(string? title)
        => Assert.Equal(title, SurveyValidation.WithCopySuffix(title, SurveyValidation.CopySuffixEn));

    [Fact]
    public void A_title_at_the_column_limit_is_truncated_so_the_copy_does_not_fail_on_a_constraint()
    {
        var atLimit = new string('a', SurveyValidation.TitleMaxLength);

        var suffixed = SurveyValidation.WithCopySuffix(atLimit, SurveyValidation.CopySuffixEn);

        Assert.NotNull(suffixed);
        Assert.Equal(SurveyValidation.TitleMaxLength, suffixed.Length);
        Assert.EndsWith(SurveyValidation.CopySuffixEn, suffixed, StringComparison.Ordinal);
    }

    [Fact]
    public void Title_max_length_matches_the_column_it_is_protecting()
        => Assert.Equal(200, SurveyValidation.TitleMaxLength);
}
