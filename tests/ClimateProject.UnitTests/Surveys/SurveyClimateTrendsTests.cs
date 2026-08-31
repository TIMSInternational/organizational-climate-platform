using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The climate-over-time matrix, proved without Postgres, Docker or an HTTP round trip --
/// <see cref="SurveyClimateTrends"/> takes <see cref="SurveyAggregate"/> values and is pure,
/// which is the whole reason it is not written inside the endpoint.
///
/// The properties that matter here are the ones a screenshot cannot check: that a withheld
/// group never ships a number OR a count, that columns stay aligned when the instrument
/// changes between waves, and that a department's dimension score is the SAME arithmetic the
/// single-survey climate map already prints.
/// </summary>
public class SurveyClimateTrendsTests
{
    private static readonly Guid EarlySurvey = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid LateSurvey = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid QuestionA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid QuestionB = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");

    private static readonly DateTimeOffset Jan = new(2026, 1, 31, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Jun = new(2026, 6, 30, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Now = new(2026, 7, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly Guid Company = Guid.Parse("99999999-9999-9999-9999-999999999999");

    // ------------------------------------------------------------------
    // Fixture builders
    // ------------------------------------------------------------------

    private static SurveyQuestionResult Question(Guid id, string category, int answered, double? average)
        // Likert, a member of QuestionTypes.NumericScale -- that constant is the SET of
        // numeric types, not one of them.
        => new(id, 0, QuestionTypes.Likert, "How is it?", category, answered,
            [], average, null, 1, 5, null, null, [], 0);

    private static SurveyResultsSummary Summary(int completed)
        => new(completed + 2, completed, completed, 0, null, 100, null, null, null, []);

    private static SurveyAggregate Aggregate(
        IReadOnlyList<SurveyQuestionResult> questions,
        int completed,
        IReadOnlyList<SurveyBreakdown>? breakdowns = null,
        bool suppressed = false)
    {
        if (suppressed)
        {
            return new SurveyAggregate(
                Summary(completed), [], [], [], true,
                SurveyResultsPrivacy.BelowMinimumRespondents,
                SurveyResultsPrivacy.MinimumSegmentRespondents);
        }

        // The rollup is computed by the same code the product uses, not hand-written here:
        // a fixture that asserted its own arithmetic would pass while disagreeing with the
        // aggregation it is supposed to mirror.
        var dimensions = questions
            .Where(q => q.Category is not null)
            .GroupBy(q => q.Category!, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new SurveyDimensionResult(
                g.Key,
                g.Count(),
                g.Sum(q => q.AnsweredCount),
                Pooled(g.Select(q => (q.AnsweredCount, q.Average)))))
            .ToList();

        return new SurveyAggregate(
            Summary(completed), questions, dimensions, breakdowns ?? [], false, null,
            SurveyResultsPrivacy.MinimumSegmentRespondents);
    }

    /// <summary>The published formula, restated once so the expectations below are readable.</summary>
    private static double? Pooled(IEnumerable<(int Answered, double? Average)> questions)
    {
        var scored = questions.Where(q => q.Average is not null).ToList();
        var weight = scored.Sum(q => q.Answered);
        return weight == 0 ? null : Math.Round(scored.Sum(q => q.Average!.Value * q.Answered) / weight, 2);
    }

    private static IReadOnlyList<SurveyBreakdown> Departments(params SurveySegmentResult[] segments)
        => [new SurveyBreakdown("department", segments, segments.Count(s => s.IsSuppressed), 0, 0)];

    private static SurveySegmentResult Segment(
        string key, string label, int respondents, params (Guid Question, int Answered, double? Average)[] questions)
        => new("department", key, label, respondents, null, null, false,
            questions.Select(q => new SurveySegmentQuestionResult(q.Question, q.Answered, q.Average)).ToList());

    private static SurveySegmentResult SuppressedSegment(string key, string label)
        => new("department", key, label, 0, null, null, true, []);

    private static SurveyClimateTrends.Input Input(
        Guid id, DateTimeOffset endDate, SurveyAggregate aggregate, string title = "Wave")
        => new(id, title, SurveyStatuses.Closed, endDate, aggregate);

    // ==================================================================
    // Ordering and column alignment
    // ==================================================================

    [Fact]
    public void Surveys_are_returned_oldest_first_whatever_order_they_arrive_in()
    {
        var result = SurveyClimateTrends.Build(Company, null,
        [
            Input(LateSurvey, Jun, Aggregate([Question(QuestionA, "trust", 10, 4.0)], 10)),
            Input(EarlySurvey, Jan, Aggregate([Question(QuestionA, "trust", 10, 3.0)], 10)),
        ], Now);

        Assert.Equal([EarlySurvey, LateSurvey], result.Surveys.Select(s => s.SurveyId));
        Assert.Equal([3.0, 4.0], result.Groups.Single().Points.Select(p => p.Scores[0]));
    }

    /// <summary>
    /// The instrument changes between waves, and the matrix must show that rather than hide
    /// it. A dimension only the later survey asked about is a column with a hole at the top,
    /// not a column that does not exist -- intersecting the dimensions would delete exactly
    /// the change this screen is for.
    /// </summary>
    [Fact]
    public void A_dimension_only_one_survey_asked_is_a_column_with_a_gap_not_a_missing_column()
    {
        var result = SurveyClimateTrends.Build(Company, null,
        [
            Input(EarlySurvey, Jan, Aggregate([Question(QuestionA, "trust", 10, 3.0)], 10)),
            Input(LateSurvey, Jun, Aggregate(
            [
                Question(QuestionA, "trust", 10, 4.0),
                Question(QuestionB, "wellbeing", 10, 4.5),
            ], 10)),
        ], Now);

        Assert.Equal(["trust", "wellbeing"], result.Dimensions.Select(d => d.Key));
        Assert.Equal([2, 1], result.Dimensions.Select(d => d.SurveyCount));

        var points = result.Groups.Single().Points;
        Assert.Null(points[0].Scores[1]);       // January never asked about wellbeing
        Assert.Equal(4.5, points[1].Scores[1]);
        // Every row is the full width, so a client aligning by index cannot misread one
        // survey's number under another survey's heading.
        Assert.All(points, p => Assert.Equal(2, p.Scores.Count));
    }

    // ==================================================================
    // THE PROPERTY THIS FILE OWNS: the floor, per group per survey
    // ==================================================================

    /// <summary>
    /// The same department, disclosable in one wave and withheld in the next. The floor is a
    /// property of (group, survey) and nothing else -- a group large enough once is not
    /// thereby readable forever, which is the mistake a per-group-only check would make.
    /// </summary>
    [Fact]
    public void A_group_is_suppressed_per_survey_not_once_for_the_window()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
                [Question(QuestionA, "trust", 20, 3.0)], 20,
                Departments(Segment("sales", "Sales", 20, (QuestionA, 20, 3.0))))),
            Input(LateSurvey, Jun, Aggregate(
                [Question(QuestionA, "trust", 8, 4.0)], 8,
                Departments(SuppressedSegment("sales", "Sales")))),
        ], Now);

        var sales = result.Groups.Single(g => g.Key == "sales");

        Assert.False(sales.Points[0].IsSuppressed);
        Assert.Equal(3.0, sales.Points[0].Scores[0]);

        Assert.True(sales.Points[1].IsSuppressed);
        Assert.Null(sales.Points[1].Scores[0]);
    }

    /// <summary>
    /// A withheld point ships no score AND no count. The count is what the floor protects:
    /// publishing "3 responses" beside a hatched cell hands over exactly the number the
    /// suppression exists to withhold, and two adjacent waves' counts can be differenced.
    /// </summary>
    [Fact]
    public void A_suppressed_point_publishes_neither_a_score_nor_its_size()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
                [Question(QuestionA, "trust", 8, 4.0)], 8,
                Departments(SuppressedSegment("sales", "Sales")))),
        ], Now);

        var point = result.Groups.Single().Points.Single();

        Assert.True(point.IsSuppressed);
        Assert.Equal(0, point.RespondentCount);
        Assert.All(point.Scores, Assert.Null);
    }

    /// <summary>
    /// A survey below its own floor arrives from <c>Compute</c> with empty dimensions, and
    /// every group's row for that wave is withheld -- not just the small ones. The
    /// whole-survey floor is about the survey, so it cannot be satisfied by a large
    /// department inside a small survey.
    /// </summary>
    [Fact]
    public void A_survey_below_its_own_floor_withholds_every_group_in_that_wave()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate([], 3, suppressed: true)),
            Input(LateSurvey, Jun, Aggregate(
                [Question(QuestionA, "trust", 20, 4.0)], 20,
                Departments(Segment("sales", "Sales", 20, (QuestionA, 20, 4.0))))),
        ], Now);

        var sales = result.Groups.Single(g => g.Key == "sales");

        Assert.True(sales.Points[0].IsSuppressed);
        Assert.True(result.Surveys[0].IsSuppressed);
        Assert.False(sales.Points[1].IsSuppressed);
    }

    /// <summary>
    /// A group withheld in every wave is kept and counted, never dropped. Removing it would
    /// misreport the organisation's shape -- the reader would conclude the department does
    /// not exist -- which is the rule <c>ClimateMap</c> already applies within one survey.
    /// </summary>
    [Fact]
    public void A_group_withheld_in_every_wave_is_kept_and_counted()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
                [Question(QuestionA, "trust", 20, 3.0)], 20,
                Departments(
                    Segment("sales", "Sales", 20, (QuestionA, 20, 3.0)),
                    SuppressedSegment("legal", "Legal")))),
            Input(LateSurvey, Jun, Aggregate(
                [Question(QuestionA, "trust", 20, 4.0)], 20,
                Departments(
                    Segment("sales", "Sales", 20, (QuestionA, 20, 4.0)),
                    SuppressedSegment("legal", "Legal")))),
        ], Now);

        var legal = result.Groups.Single(g => g.Key == "legal");

        Assert.Equal("Legal", legal.Label);
        Assert.All(legal.Points, p => Assert.True(p.IsSuppressed));
        Assert.Equal(1, result.SuppressedGroupCount);
    }

    /// <summary>
    /// A department that did not exist for the earlier wave still gets a point there, so
    /// every series is the same length. "Absent" and "too small" are one suppressed value on
    /// purpose: told apart, they would let a reader difference a named group's size.
    /// </summary>
    [Fact]
    public void A_group_absent_from_a_wave_still_gets_a_suppressed_point_there()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
                [Question(QuestionA, "trust", 20, 3.0)], 20,
                Departments(Segment("sales", "Sales", 20, (QuestionA, 20, 3.0))))),
            Input(LateSurvey, Jun, Aggregate(
                [Question(QuestionA, "trust", 20, 4.0)], 20,
                Departments(
                    Segment("sales", "Sales", 10, (QuestionA, 10, 4.0)),
                    Segment("newteam", "New Team", 10, (QuestionA, 10, 5.0))))),
        ], Now);

        var newTeam = result.Groups.Single(g => g.Key == "newteam");

        Assert.Equal(2, newTeam.Points.Count);
        Assert.True(newTeam.Points[0].IsSuppressed);
        Assert.Equal(0, newTeam.Points[0].RespondentCount);
        Assert.Equal(5.0, newTeam.Points[1].Scores[0]);
    }

    // ==================================================================
    // The arithmetic is the product's, not a second copy
    // ==================================================================

    /// <summary>
    /// A group's dimension score is the answered-count-weighted pool of its questions -- the
    /// identical rule <c>DimensionRollup</c> applies, through the identical function. Two
    /// questions with different weights, so a plain unweighted mean would give 4.0 and fail.
    /// </summary>
    [Fact]
    public void A_groups_dimension_score_is_the_weighted_pool_of_its_questions()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
            [
                Question(QuestionA, "trust", 30, 3.0),
                Question(QuestionB, "trust", 10, 5.0),
            ], 30,
            Departments(Segment("sales", "Sales", 30, (QuestionA, 30, 3.0), (QuestionB, 10, 5.0))))),
        ], Now);

        var score = result.Groups.Single().Points.Single().Scores[0];

        // (3.0*30 + 5.0*10) / 40 = 3.5, not the unweighted 4.0.
        Assert.Equal(3.5, score);
        Assert.NotEqual(4.0, score);
    }

    /// <summary>
    /// The whole-company row is the aggregation's OWN dimension score, passed through
    /// untouched. If this ever drifts, the trend screen and the climate map print different
    /// numbers for the same survey -- the drift #88's boundary exists to make impossible.
    /// </summary>
    [Fact]
    public void The_whole_company_row_is_the_aggregations_own_dimension_score()
    {
        var aggregate = Aggregate(
        [
            Question(QuestionA, "trust", 30, 3.0),
            Question(QuestionB, "trust", 10, 5.0),
        ], 40);

        var result = SurveyClimateTrends.Build(Company, null, [Input(EarlySurvey, Jan, aggregate)], Now);

        Assert.Equal(
            aggregate.Dimensions.Single(d => d.Dimension == "trust").AverageScore,
            result.Groups.Single().Points.Single().Scores[0]);
    }

    /// <summary>
    /// A question with no computable average contributes no weight, so a dimension whose
    /// every question is unscored is null rather than zero. Zero is a reading; null is the
    /// absence of one, and a chart that plots the first prints a catastrophe that did not
    /// happen.
    /// </summary>
    [Fact]
    public void A_dimension_with_no_scored_question_is_null_not_zero()
    {
        var result = SurveyClimateTrends.Build(Company, "department",
        [
            Input(EarlySurvey, Jan, Aggregate(
                [Question(QuestionA, "trust", 20, null)], 20,
                Departments(Segment("sales", "Sales", 20, (QuestionA, 20, null))))),
        ], Now);

        Assert.Null(result.Groups.Single().Points.Single().Scores[0]);
    }

    // ==================================================================
    // Shape
    // ==================================================================

    [Fact]
    public void An_ungrouped_response_is_one_series_under_the_whole_company_key()
    {
        var result = SurveyClimateTrends.Build(Company, null,
            [Input(EarlySurvey, Jan, Aggregate([Question(QuestionA, "trust", 10, 3.0)], 10))], Now);

        var group = Assert.Single(result.Groups);
        Assert.Equal(SurveyClimateTrends.WholeCompanyKey, group.Key);
        Assert.Null(group.Label);
        Assert.Null(result.GroupBy);
    }

    /// <summary>
    /// An unrecognised <c>groupBy</c> is an empty matrix, not an exception. A demographic
    /// field is per-company configuration, so "no such field" and "a field nobody answered"
    /// are indistinguishable from here.
    /// </summary>
    [Fact]
    public void An_unknown_group_by_yields_no_groups_rather_than_throwing()
    {
        var result = SurveyClimateTrends.Build(Company, "nonexistent",
            [Input(EarlySurvey, Jan, Aggregate([Question(QuestionA, "trust", 10, 3.0)], 10))], Now);

        Assert.Empty(result.Groups);
        Assert.Equal("nonexistent", result.GroupBy);
        Assert.Single(result.Surveys);
    }

    [Fact]
    public void The_floor_reported_is_the_floor_applied()
    {
        var result = SurveyClimateTrends.Build(Company, null,
            [Input(EarlySurvey, Jan, Aggregate([Question(QuestionA, "trust", 10, 3.0)], 10))], Now);

        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, result.MinimumGroupSize);
    }
}
