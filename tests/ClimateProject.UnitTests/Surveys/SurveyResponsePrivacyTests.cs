using ClimateProject.Application.Analytics;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// What an anonymous response is allowed to carry. The interesting assertions are all
/// about what is NOT written.
/// </summary>
public class SurveyResponsePrivacyTests
{
    [Fact]
    public void The_cohort_floor_is_the_one_the_snapshot_surface_already_uses()
    {
        // Referenced rather than restated. Two constants that happen to agree today are
        // two constants that disagree after the first tuning, and they are protecting the
        // same quasi-identifiers against the same cross-reference.
        Assert.Equal(DemographicSnapshotPrivacy.MinimumGroupSize, SurveyResponsePrivacy.MinimumCohortSize);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, false)]
    [InlineData(4, false)]
    [InlineData(5, true)]
    [InlineData(500, true)]
    public void A_cohort_hides_a_respondent_only_once_it_is_big_enough(int size, bool expected)
        => Assert.Equal(expected, SurveyResponsePrivacy.CohortIsLargeEnough(size));

    // ------------------------------------------------------------------
    // Department
    // ------------------------------------------------------------------

    [Fact]
    public void An_identified_response_records_its_department_whatever_the_headcount()
    {
        var department = Guid.NewGuid();

        // user_id is already on the row, so the department adds no attributable
        // information -- and dropping it would break segmentation for nothing.
        Assert.Equal(department, SurveyResponsePrivacy.DepartmentFor(isAnonymous: false, department, departmentHeadcount: 1));
    }

    [Fact]
    public void An_anonymous_response_in_a_tiny_department_records_no_department()
    {
        // A response tagged to a two-person team is a named response with extra steps.
        Assert.Null(SurveyResponsePrivacy.DepartmentFor(isAnonymous: true, Guid.NewGuid(), departmentHeadcount: 2));
    }

    [Fact]
    public void An_anonymous_response_in_a_large_department_records_it()
    {
        var department = Guid.NewGuid();

        Assert.Equal(
            department,
            SurveyResponsePrivacy.DepartmentFor(isAnonymous: true, department, departmentHeadcount: SurveyResponsePrivacy.MinimumCohortSize));
    }

    [Fact]
    public void A_respondent_with_no_department_records_none_in_either_mode()
    {
        Assert.Null(SurveyResponsePrivacy.DepartmentFor(isAnonymous: false, null, departmentHeadcount: 100));
        Assert.Null(SurveyResponsePrivacy.DepartmentFor(isAnonymous: true, null, departmentHeadcount: 100));
    }

    // ------------------------------------------------------------------
    // Demographics
    // ------------------------------------------------------------------

    [Fact]
    public void An_identified_response_keeps_every_demographic()
    {
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: false,
            [
                new DemographicCandidate("tenure", "10_plus_years", 1),
                new DemographicCandidate("role", "director", 2),
            ]);

        Assert.Equal(2, capture.Kept.Count);
        Assert.Empty(capture.SuppressedFields);
    }

    [Fact]
    public void An_anonymous_response_drops_the_demographics_that_would_identify_the_respondent()
    {
        // "tenure = 10+ years" is one person here. Combined with the department it is a
        // name, and unlike an ip address nothing about it looks like an identifier -- so
        // it is the one that actually leaks.
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: true,
            [
                new DemographicCandidate("tenure", "10_plus_years", 1),
                new DemographicCandidate("location", "bogota", 40),
            ]);

        var kept = Assert.Single(capture.Kept);
        Assert.Equal("location", kept.Field);
        Assert.Equal(["tenure"], capture.SuppressedFields);
    }

    [Fact]
    public void Suppression_is_reported_rather_than_silent()
    {
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: true,
            [new DemographicCandidate("role", "vp", 1)]);

        // A reader has to be able to tell "this respondent answered nothing" from "we
        // refused to record it" -- the same reason DemographicSnapshotPrivacy reports its
        // suppressed buckets instead of dropping them.
        Assert.Empty(capture.Kept);
        Assert.Equal(["role"], capture.SuppressedFields);
    }

    [Fact]
    public void An_unmeasurable_cohort_is_treated_as_too_small()
    {
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: true,
            [new DemographicCandidate("tenure", "unknown", 0)]);

        Assert.Empty(capture.Kept);
        Assert.Equal(["tenure"], capture.SuppressedFields);
    }

    [Fact]
    public void Blank_fields_and_values_are_dropped_rather_than_stored_empty()
    {
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: false,
            [
                new DemographicCandidate("  ", "bogota", 40),
                new DemographicCandidate("tenure", "  ", 40),
                new DemographicCandidate("role", "engineer", 40),
            ]);

        Assert.Equal("role", Assert.Single(capture.Kept).Field);
    }

    [Fact]
    public void The_output_is_ordered_so_two_runs_agree()
    {
        var capture = SurveyResponsePrivacy.Filter(
            isAnonymous: true,
            [
                new DemographicCandidate("role", "engineer", 1),
                new DemographicCandidate("location", "bogota", 40),
                new DemographicCandidate("department", "sales", 1),
            ]);

        Assert.Equal("location", Assert.Single(capture.Kept).Field);
        Assert.Equal(["department", "role"], capture.SuppressedFields);
    }
}
