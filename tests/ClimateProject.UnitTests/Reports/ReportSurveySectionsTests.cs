using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// The report's survey section is a pure projection of the shared
/// <see cref="SurveyAggregate"/>, so its whole contract -- including the anonymity
/// floor -- is provable here without Docker. Every aggregate below is produced by the
/// real <see cref="SurveyAggregation.Compute"/>, not hand-built, so these tests break
/// if EITHER the aggregation stops suppressing OR the projection starts recomputing
/// what the aggregation decided.
/// </summary>
public class ReportSurveySectionsTests
{
    private static readonly Guid SurveyId = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Engineering = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Sales = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static string Stored(string value) => JsonSerializer.Serialize(value);

    private static AggregationQuestion ScaleQuestion(string category = "leadership")
        => new(QuestionId, 0, QuestionTypes.Likert, "How supported do you feel?", category, 1, 5,
        [
            new AggregationOption(0, "2", "Two"),
            new AggregationOption(1, "4", "Four"),
        ]);

    private static AggregationResponse Response(int n, Guid? departmentId)
        => new(
            Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}"),
            "en",
            departmentId,
            true,
            new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero),
            300,
            new Dictionary<string, string>(StringComparer.Ordinal));

    /// <summary>
    /// An aggregate over 5 Engineering respondents answering "4" and 2 Sales
    /// respondents answering "2" -- Sales below the segment floor of
    /// <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>, Engineering above.
    /// </summary>
    private static SurveyAggregate Aggregate()
    {
        var responses = Enumerable.Range(1, 5).Select(n => Response(n, Engineering))
            .Concat(Enumerable.Range(6, 2).Select(n => Response(n, Sales)))
            .ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored(r.DepartmentId == Sales ? "2" : "4"), null))
            .ToList();

        return SurveyAggregation.Compute(
            [ScaleQuestion()],
            responses,
            answers,
            [new AggregationDepartment(Engineering, "Engineering", 10), new AggregationDepartment(Sales, "Sales", 4)],
            targetAudienceCount: 14);
    }

    /// <summary>
    /// THE privacy property of #88: a department the results screen suppresses stays
    /// suppressed in the report. A report that prints a protected department's count is
    /// a privacy defect, and the withheld headcount must appear only as the breakdown's
    /// own reconciliation counters, never on the department's row.
    /// </summary>
    [Fact]
    public void A_department_below_the_segment_floor_stays_suppressed_in_the_report_section()
    {
        var section = ReportSurveySections.ToSection(SurveyId, "Q3 Climate", SurveyStatuses.Closed, Aggregate());

        var sales = Assert.Single(section.Departments, d => d.DepartmentId == Sales.ToString());
        Assert.True(sales.IsSuppressed);
        Assert.Equal(0, sales.RespondentCount);
        Assert.Null(sales.ParticipationRate);

        var engineering = Assert.Single(section.Departments, d => d.DepartmentId == Engineering.ToString());
        Assert.False(engineering.IsSuppressed);
        Assert.Equal(5, engineering.RespondentCount);

        Assert.Equal(1, section.SuppressedDepartmentCount);
        Assert.Equal(2, section.SuppressedRespondentCount);
        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, section.MinimumGroupSize);
    }

    /// <summary>
    /// The section's numbers are the aggregate's numbers -- participation verbatim, and
    /// the dimension score is the same pooled mean the results screens serve.
    /// </summary>
    [Fact]
    public void The_section_carries_the_aggregates_participation_and_dimension_scores_verbatim()
    {
        var aggregate = Aggregate();
        var section = ReportSurveySections.ToSection(SurveyId, "Q3 Climate", SurveyStatuses.Closed, aggregate);

        Assert.Same(aggregate.Summary, section.Participation);
        Assert.Same(aggregate.Dimensions, section.Dimensions);
        Assert.Equal(7, section.Participation.CompletedCount);

        var leadership = Assert.Single(section.Dimensions);
        Assert.Equal("leadership", leadership.Dimension);
        // (4 x 5 + 2 x 2) / 7 -- the same number /surveys/{id}/results reports as the
        // question's Average, because it IS that number.
        Assert.Equal(3.43d, leadership.AverageScore);
        Assert.Equal(Assert.Single(aggregate.Questions).Average, leadership.AverageScore);
    }

    /// <summary>
    /// Below the whole-survey floor the section carries the participation counters and
    /// the suppression flag, and nothing else -- no dimensions, no departments.
    /// </summary>
    [Fact]
    public void A_survey_below_the_floor_yields_a_suppressed_section_with_counters_only()
    {
        var responses = Enumerable
            .Range(1, SurveyResultsPrivacy.MinimumRespondents - 1)
            .Select(n => Response(n, Engineering))
            .ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("4"), null))
            .ToList();
        var aggregate = SurveyAggregation.Compute(
            [ScaleQuestion()], responses, answers,
            [new AggregationDepartment(Engineering, "Engineering", 10)], targetAudienceCount: 40);

        var section = ReportSurveySections.ToSection(SurveyId, "Q3 Climate", SurveyStatuses.Active, aggregate);

        Assert.True(section.IsSuppressed);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, section.SuppressionReason);
        Assert.Empty(section.Dimensions);
        Assert.Empty(section.Departments);
        Assert.Equal(SurveyResultsPrivacy.MinimumRespondents - 1, section.Participation.CompletedCount);
    }
}
