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
    public void Emoji_rating_is_excluded_because_only_microclimates_accept_it()
    {
        // Was "because neither wizard accepts it today". #198 gave the microclimate side an
        // emoji-option table and added the type to ForMicroclimate, so half of that is no longer
        // true -- and the intersection is still the right answer for the other half: an
        // emoji_rating library item would be uninstantiable into a SURVEY, which is exactly the
        // pick-time failure this vocabulary exists to prevent. The assertion is unchanged
        // precisely because the set is derived; only the reason moved.
        Assert.Contains(QuestionTypes.EmojiRating, QuestionTypes.ForMicroclimate);
        Assert.DoesNotContain(QuestionTypes.EmojiRating, QuestionTypes.ForSurvey);
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
