using ClimateProject.Application.Analytics;

namespace ClimateProject.UnitTests.Analytics;

public class AIInsightValidationTests
{
    private static CreateAIInsightRequest Request(
        string type = "trend",
        string category = "engagement",
        string title = "Declining engagement in Sales",
        string description = "Engagement fell nine points quarter over quarter.",
        int confidenceScore = 80,
        string priority = "high",
        IReadOnlyList<string>? affectedSegments = null,
        IReadOnlyList<string>? recommendedActions = null)
        => new(null, Guid.NewGuid(), null, type, category, title, description, confidenceScore,
            priority, affectedSegments, recommendedActions);

    [Fact]
    public void A_well_formed_request_validates_and_comes_back_trimmed()
    {
        var result = AIInsightValidation.ValidateCreate(Request(
            type: "  trend  ", category: " engagement ", title: "  Declining engagement  ",
            description: " It fell. ", priority: " high "));

        Assert.Null(result.Error);
        var fields = Assert.IsType<NormalizedAIInsightFields>(result.Fields);
        Assert.Equal("trend", fields.Type);
        Assert.Equal("engagement", fields.Category);
        Assert.Equal("Declining engagement", fields.Title);
        Assert.Equal("It fell.", fields.Description);
        Assert.Equal("high", fields.Priority);
    }

    [Theory]
    [InlineData("Type")]
    [InlineData("Category")]
    [InlineData("Title")]
    [InlineData("Description")]
    [InlineData("Priority")]
    public void A_missing_required_field_names_itself(string field)
    {
        var result = AIInsightValidation.ValidateCreate(field switch
        {
            "Type" => Request(type: "   "),
            "Category" => Request(category: ""),
            "Title" => Request(title: null!),
            "Description" => Request(description: "\t"),
            _ => Request(priority: ""),
        });

        Assert.Null(result.Fields);
        Assert.Equal($"{field} is required", result.Error);
    }

    [Fact]
    public void The_first_missing_field_wins_so_the_message_is_deterministic()
    {
        var result = AIInsightValidation.ValidateCreate(Request(type: "", category: "", title: ""));

        Assert.Equal("Type is required", result.Error);
    }

    [Theory]
    [InlineData("Type", AIInsightValidation.MaxTypeLength)]
    [InlineData("Category", AIInsightValidation.MaxCategoryLength)]
    [InlineData("Title", AIInsightValidation.MaxTitleLength)]
    [InlineData("Description", AIInsightValidation.MaxDescriptionLength)]
    [InlineData("Priority", AIInsightValidation.MaxPriorityLength)]
    public void An_over_long_field_is_rejected_at_the_columns_own_limit(string field, int maxLength)
    {
        var tooLong = new string('x', maxLength + 1);
        var atLimit = new string('x', maxLength);

        var over = AIInsightValidation.ValidateCreate(field switch
        {
            "Type" => Request(type: tooLong),
            "Category" => Request(category: tooLong),
            "Title" => Request(title: tooLong),
            "Description" => Request(description: tooLong),
            _ => Request(priority: tooLong),
        });
        Assert.Equal($"{field} exceeds {maxLength} characters", over.Error);

        // The boundary itself is legal -- an off-by-one here would reject valid LLM output.
        var exact = AIInsightValidation.ValidateCreate(field switch
        {
            "Type" => Request(type: atLimit),
            "Category" => Request(category: atLimit),
            "Title" => Request(title: atLimit),
            "Description" => Request(description: atLimit),
            _ => Request(priority: atLimit),
        });
        Assert.Null(exact.Error);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    [InlineData(int.MaxValue)]
    public void A_confidence_score_outside_0_to_100_is_rejected(int score)
    {
        var result = AIInsightValidation.ValidateCreate(Request(confidenceScore: score));

        Assert.Null(result.Fields);
        Assert.Equal("ConfidenceScore must be between 0 and 100", result.Error);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(100)]
    public void Both_ends_of_the_confidence_range_are_accepted(int score)
    {
        // 1 is included on purpose: a caller sending the 0-1 fraction of #152 lands here, and
        // this test records that the range check cannot catch that -- only the >100 half.
        Assert.Null(AIInsightValidation.ValidateCreate(Request(confidenceScore: score)).Error);
    }

    [Fact]
    public void Null_arrays_become_empty_lists_rather_than_nulls()
    {
        var fields = AIInsightValidation.ValidateCreate(Request()).Fields!;

        Assert.Empty(fields.AffectedSegments);
        Assert.Empty(fields.RecommendedActions);
    }

    [Fact]
    public void Blank_and_null_array_entries_are_dropped_and_the_rest_trimmed()
    {
        // text[] NOT NULL has no element constraint, so without this a body of [null, ""] would
        // store a NULL element that reads back as a null inside a List<string>.
        var fields = AIInsightValidation.ValidateCreate(Request(
            affectedSegments: [" Sales ", "", "   ", null!, "Support"],
            recommendedActions: ["  Schedule 1:1s  "])).Fields!;

        Assert.Equal(new[] { "Sales", "Support" }, fields.AffectedSegments);
        Assert.Equal(new[] { "Schedule 1:1s" }, fields.RecommendedActions);
    }

    [Fact]
    public void An_all_blank_array_normalises_to_empty_rather_than_failing_the_insight()
    {
        Assert.Empty(AIInsightValidation.NormalizeList(["", "  ", null!]));
        Assert.Empty(AIInsightValidation.NormalizeList(null));
    }
}
