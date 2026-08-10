using ClimateProject.Application.Search;

namespace ClimateProject.UnitTests.Search;

public class SearchEntityTypesTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_absent_filter_searches_every_kind(string? raw)
        => Assert.Equal(SearchEntityTypes.All, SearchEntityTypes.Parse(raw));

    [Fact]
    public void A_filter_narrows_to_the_named_kinds()
        => Assert.Equal(["survey", "report"], SearchEntityTypes.Parse("report,survey"));

    [Fact]
    public void The_canonical_grouping_order_is_kept_regardless_of_the_argument_order()
    {
        // Two callers asking for the same kinds must get the same response shape, or the
        // client has to sort groups it did not choose the order of.
        Assert.Equal(SearchEntityTypes.Parse("report,survey"), SearchEntityTypes.Parse("survey,report"));
    }

    [Theory]
    [InlineData("SURVEY")]
    [InlineData(" survey ")]
    public void Casing_and_padding_are_tolerated(string raw)
        => Assert.Equal(["survey"], SearchEntityTypes.Parse(raw));

    [Fact]
    public void Duplicates_collapse()
        => Assert.Equal(["survey"], SearchEntityTypes.Parse("survey,survey"));

    [Theory]
    [InlineData("response")]
    [InlineData("survey,response")]
    [InlineData("audit_log")]
    public void An_unknown_kind_is_a_caller_error_and_not_a_silently_narrower_search(string raw)
    {
        // Returning "no results" for a typo'd kind is indistinguishable from an empty
        // tenant, and the caller never learns their filter was ignored.
        Assert.Null(SearchEntityTypes.Parse(raw));
    }

    [Fact]
    public void Respondent_level_data_is_not_searchable()
    {
        // Responses and question responses stay out: SurveyResultsPrivacy keeps them behind
        // aggregation thresholds, and a search index is not the place to reopen that.
        Assert.DoesNotContain("response", SearchEntityTypes.All);
        Assert.DoesNotContain("question_response", SearchEntityTypes.All);
    }
}
