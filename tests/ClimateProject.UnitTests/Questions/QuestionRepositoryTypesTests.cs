using ClimateProject.Application.Questions;

namespace ClimateProject.UnitTests.Questions;

/// <summary>
/// The repository vocabulary (#58/#112).
///
/// A unit test rather than an integration one because the property that matters — that the set is
/// DERIVED from both wizards' vocabularies rather than written out — is a property of a pure
/// expression, and pinning it here means it is checked on every build.
/// </summary>
public class QuestionRepositoryTypesTests
{
    [Fact]
    public void The_vocabulary_is_the_intersection_of_both_wizards_not_a_third_list()
    {
        // If someone adds a type to one wizard and not the other, this stays correct by construction.
        Assert.Equal(
            QuestionTypes.ForSurvey.Intersect(QuestionTypes.ForMicroclimate, StringComparer.Ordinal).Order(StringComparer.Ordinal),
            QuestionRepositoryTypes.Supported);
    }

    [Fact]
    public void Every_supported_type_can_be_instantiated_into_either_wizard()
    {
        // The whole point: an item that cannot be picked into one of the two surfaces the library
        // serves is a validation failure discovered at pick time instead of authoring time.
        Assert.All(QuestionRepositoryTypes.Supported, type =>
        {
            Assert.Contains(type, QuestionTypes.ForSurvey);
            Assert.Contains(type, QuestionTypes.ForMicroclimate);
        });
    }

    [Fact]
    public void Ranking_is_excluded_because_only_surveys_accept_it()
    {
        Assert.Contains(QuestionTypes.Ranking, QuestionTypes.ForSurvey);
        Assert.DoesNotContain(QuestionTypes.Ranking, QuestionTypes.ForMicroclimate);
        Assert.False(QuestionRepositoryTypes.IsSupported(QuestionTypes.Ranking));
    }

    [Fact]
    public void Emoji_rating_is_excluded_because_neither_wizard_accepts_it_today()
    {
        // #198 is the issue that would change this. Until it lands, an emoji_rating library item
        // would be uninstantiable anywhere, which is worse than not being authorable.
        Assert.False(QuestionRepositoryTypes.IsSupported(QuestionTypes.EmojiRating));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("matrix")]
    [InlineData("LIKERT")]
    public void An_unknown_or_wrongly_cased_type_is_not_supported(string? type)
    {
        // Ordinal comparison on purpose: these are machine tokens, and "LIKERT" is not one of them.
        Assert.False(QuestionRepositoryTypes.IsSupported(type));
    }

    [Fact]
    public void Only_multiple_choice_needs_a_caller_supplied_option_set()
    {
        Assert.True(QuestionRepositoryTypes.RequiresOptions(QuestionTypes.MultipleChoice));
        Assert.False(QuestionRepositoryTypes.RequiresOptions(QuestionTypes.Likert));
        Assert.False(QuestionRepositoryTypes.RequiresOptions(QuestionTypes.YesNo));
    }
}
