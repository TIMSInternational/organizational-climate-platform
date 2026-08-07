using ClimateProject.Application.Analytics;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The three floors, pinned. A suppression threshold that nobody asserts is a threshold
/// that gets "simplified" to a single constant by the next person who reads three
/// numbers and assumes they are a mistake.
/// </summary>
public class SurveyResultsPrivacyTests
{
    /// <summary>
    /// The segment floor and #87's snapshot floor protect the same quasi-identifiers over
    /// the same workforce. Two surfaces with different floors can be differenced against
    /// each other, which defeats a suppression rule without anyone breaking it.
    /// </summary>
    [Fact]
    public void The_segment_floor_is_bound_to_the_demographic_snapshot_floor()
    {
        Assert.Equal(DemographicSnapshotPrivacy.MinimumGroupSize, SurveyResultsPrivacy.MinimumSegmentRespondents);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, false)]
    [InlineData(4, false)]
    [InlineData(5, true)]
    [InlineData(50, true)]
    public void The_survey_floor_admits_exactly_five_and_above(int completed, bool expected)
    {
        Assert.Equal(expected, SurveyResultsPrivacy.MeetsSurveyFloor(completed));
    }

    [Theory]
    [InlineData(1, false)]
    [InlineData(4, false)]
    [InlineData(5, true)]
    public void The_segment_floor_admits_exactly_five_and_above(int respondents, bool expected)
    {
        Assert.Equal(expected, SurveyResultsPrivacy.MeetsSegmentFloor(respondents));
    }

    /// <summary>
    /// A word cloud leaks by distinctiveness rather than by group size, so its floor is 2
    /// rather than 5. Raising it to 5 was considered and rejected: it empties the cloud at
    /// the survey sizes this product runs at, which deletes a feature rather than removing
    /// a risk.
    /// </summary>
    [Theory]
    [InlineData(1, false)]
    [InlineData(2, true)]
    public void The_word_floor_admits_two_and_above(int respondents, bool expected)
    {
        Assert.Equal(expected, SurveyResultsPrivacy.MeetsWordFloor(respondents));
    }

    [Fact]
    public void The_word_floor_is_deliberately_lower_than_the_segment_floor()
    {
        Assert.True(SurveyResultsPrivacy.MinimumWordRespondents < SurveyResultsPrivacy.MinimumSegmentRespondents);
    }

    /// <summary>
    /// Reason codes are machine-readable keys, not display copy -- the client renders them
    /// through its own i18n keys. A sentence here would be untranslatable English baked
    /// into an API contract.
    /// </summary>
    [Fact]
    public void Suppression_reasons_are_machine_readable_codes()
    {
        foreach (var code in new[]
                 {
                     SurveyResultsPrivacy.BelowMinimumRespondents,
                     SurveyResultsPrivacy.BelowMinimumSegmentRespondents,
                 })
        {
            Assert.DoesNotContain(' ', code);
            Assert.Equal(code.ToLowerInvariant(), code);
        }
    }
}
