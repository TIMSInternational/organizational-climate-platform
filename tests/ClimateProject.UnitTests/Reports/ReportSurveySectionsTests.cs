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
///
/// <para>
/// The suppression tests assert against the RENDERED document -- the section serialised
/// exactly as <c>ReportGeneration</c> serialises it, with
/// <c>JsonSerializerOptions.Web</c> -- and not against the section object. That
/// distinction is the whole point: <c>report_output</c> is handed to the browser
/// verbatim, so "the aggregate withheld it" is not the guarantee anyone needs. The
/// guarantee is that it is not in the bytes.
/// </para>
/// </summary>
public class ReportSurveySectionsTests
{
    private static readonly Guid SurveyId = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Engineering = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Sales = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static string Stored(string value) => JsonSerializer.Serialize(value);

    private static AggregationQuestion ScaleQuestion(string category = "leadership", params string[] optionValues)
        => new(QuestionId, 0, QuestionTypes.Likert, "How supported do you feel?", category, 1, 5,
        null, null,
        [.. (optionValues.Length == 0 ? ["2", "4"] : optionValues)
            .Select((value, index) => new AggregationOption(index, value, $"Option {value}"))]);

    private static AggregationQuestion OpenQuestion()
        => new(QuestionId, 0, QuestionTypes.OpenEnded, "Anything else?", "leadership", null, null, null, null, []);

    private static AggregationResponse Response(int n, Guid? departmentId, IReadOnlyDictionary<string, string>? demographics = null)
        => new(
            Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}"),
            "en",
            departmentId,
            true,
            new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero),
            300,
            demographics ?? new Dictionary<string, string>(StringComparer.Ordinal));

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

    private static ReportSurveySection Section(SurveyAggregate aggregate, string status = SurveyStatuses.Closed)
        => ReportSurveySections.ToSection(SurveyId, "Q3 Climate", status, "en", aggregate);

    /// <summary>
    /// The section as <c>ReportGeneration</c> actually persists it: inside a
    /// <see cref="ReportOutputDocument"/>, serialised with the same
    /// <c>JsonSerializerOptions.Web</c>. Every privacy assertion below reads THIS string
    /// or the document parsed back out of it, never the in-memory section.
    /// </summary>
    private static string Render(ReportSurveySection section)
        => JsonSerializer.Serialize(
            new ReportOutputDocument("note", [section], [], []), JsonSerializerOptions.Web);

    private static ReportOutputDocument Reread(string rendered)
        => JsonSerializer.Deserialize<ReportOutputDocument>(rendered, JsonSerializerOptions.Web)!;

    /// <summary>
    /// THE privacy property of #88: a department the results screen suppresses stays
    /// suppressed in the report. A report that prints a protected department's count is
    /// a privacy defect, and the withheld headcount must appear only as the breakdown's
    /// own reconciliation counters, never on the department's row.
    /// </summary>
    [Fact]
    public void A_department_below_the_segment_floor_stays_suppressed_in_the_report_section()
    {
        var section = Section(Aggregate());

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
        var section = Section(aggregate);

        Assert.Same(aggregate.Summary, section.Participation);
        Assert.Same(aggregate.Dimensions, section.Dimensions);
        Assert.Same(aggregate.Questions, section.Questions);
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
    /// the suppression flag, and nothing else -- no questions, no dimensions, no
    /// departments, no demographic breakdowns.
    /// </summary>
    [Fact]
    public void A_survey_below_the_floor_yields_a_suppressed_section_with_counters_only()
    {
        var responses = Enumerable
            .Range(1, SurveyResultsPrivacy.MinimumRespondents - 1)
            .Select(n => Response(n, Engineering, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tenure"] = Stored("0-1"),
            }))
            .ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("4"), null))
            .ToList();
        var aggregate = SurveyAggregation.Compute(
            [ScaleQuestion()], responses, answers,
            [new AggregationDepartment(Engineering, "Engineering", 10)], targetAudienceCount: 40);

        var section = Section(aggregate, SurveyStatuses.Active);

        Assert.True(section.IsSuppressed);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, section.SuppressionReason);
        Assert.Empty(section.Questions);
        Assert.Empty(section.Dimensions);
        Assert.Empty(section.Departments);
        Assert.Empty(section.Demographics);
        Assert.Equal(SurveyResultsPrivacy.MinimumRespondents - 1, section.Participation.CompletedCount);

        // And the demographic value the four respondents carry is not in the bytes at
        // all: below the survey floor there is no breakdown for it to be a row of.
        Assert.DoesNotContain("tenure", Render(section), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // #88 follow-up: demographic breakdowns beyond department
    // ------------------------------------------------------------------

    /// <summary>
    /// 5 respondents with tenure "2-5" answering 4, and 2 with tenure "0-1" answering 1.
    /// "0-1" is below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>; the
    /// whole survey (7) is above <see cref="SurveyResultsPrivacy.MinimumRespondents"/>.
    /// The sub-floor group's own reading is 1.0, a number that must appear NOWHERE.
    /// </summary>
    private static SurveyAggregate DemographicAggregate()
    {
        var senior = Enumerable.Range(1, 5).Select(n => Response(n, Engineering,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["tenure"] = Stored("2-5") }));
        var newcomers = Enumerable.Range(6, 2).Select(n => Response(n, Engineering,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["tenure"] = Stored("0-1") }));

        var responses = senior.Concat(newcomers).ToList();
        var answers = responses
            .Select((r, index) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(index < 5 ? "4" : "1"), null))
            .ToList();

        return SurveyAggregation.Compute(
            [ScaleQuestion("leadership", "1", "4")],
            responses,
            answers,
            [new AggregationDepartment(Engineering, "Engineering", 10)],
            targetAudienceCount: 14);
    }

    /// <summary>
    /// req(#88 follow-up): the demographic breakdowns the aggregation already computes
    /// are printed, with the department breakdown NOT duplicated among them.
    /// </summary>
    [Fact]
    public void Demographic_breakdowns_beyond_department_are_printed_with_their_segment_dimension_scores()
    {
        var section = Section(DemographicAggregate());

        Assert.DoesNotContain(section.Demographics, b => b.Dimension == "department");
        var tenure = Assert.Single(section.Demographics);
        Assert.Equal("tenure", tenure.Dimension);

        var senior = Assert.Single(tenure.Segments, s => s.Key == "2-5");
        Assert.False(senior.IsSuppressed);
        Assert.Equal(5, senior.RespondentCount);
        var leadership = Assert.Single(senior.Dimensions);
        Assert.Equal("leadership", leadership.Dimension);
        // The group's own pooled mean, from SurveyAggregation.SegmentDimensionScores --
        // the same function the climate-over-time matrix and the department dashboard
        // read, not a fifth rollup written here.
        Assert.Equal(4d, leadership.AverageScore);

        // The whole-survey dimension score is a DIFFERENT number over the same answers:
        // (4 x 5 + 1 x 2) / 7. If the projection had reused it for the segment, or the
        // segment's for the survey, these two would be equal.
        Assert.Equal(3.14d, Assert.Single(section.Dimensions).AverageScore);
    }

    /// <summary>
    /// THE attack this whole slice exists to survive: a demographic group below the
    /// segment floor must be absent from the RENDERED document -- not merely flagged in
    /// the object graph. This asserts on the persisted bytes, re-parsed, so a projection
    /// that printed the raw <see cref="SurveyBreakdown.Segments"/> collection, or that
    /// carried a suppressed group's score, fails here.
    ///
    /// <para>The group's ROW survives, saying "withheld", exactly as a suppressed
    /// department's does -- that is what lets a reader tell "nobody answered" from "a
    /// group was withheld", and it is the aggregation's decision either way. What must
    /// not survive is any NUMBER about the group.</para>
    /// </summary>
    [Fact]
    public void A_demographic_group_below_the_segment_floor_carries_no_number_in_the_rendered_document()
    {
        var rendered = Render(Section(DemographicAggregate()));
        var document = Reread(rendered);

        var tenure = Assert.Single(Assert.Single(document.Surveys).Demographics);
        var newcomers = Assert.Single(tenure.Segments, s => s.Key == "0-1");
        Assert.True(newcomers.IsSuppressed);
        Assert.Equal(0, newcomers.RespondentCount);
        Assert.Empty(newcomers.Dimensions);

        // The withheld total survives exactly once, on the breakdown, where it
        // reconciles against the participation counters without naming a group.
        Assert.Equal(1, tenure.SuppressedSegmentCount);
        Assert.Equal(2, tenure.SuppressedRespondentCount);

        // Document-wide invariant rather than a check on one row: NO suppressed segment
        // anywhere in the document may carry a count or a score. A future breakdown that
        // forgot to honour the flag is caught by this without anybody adding a test.
        foreach (var section in document.Surveys)
        {
            foreach (var segment in section.Demographics.SelectMany(b => b.Segments).Where(s => s.IsSuppressed))
            {
                Assert.Equal(0, segment.RespondentCount);
                Assert.Empty(segment.Dimensions);
            }

            foreach (var department in section.Departments.Where(d => d.IsSuppressed))
            {
                Assert.Equal(0, department.RespondentCount);
                Assert.Null(department.ParticipationRate);
            }
        }

        // The sub-floor group answered 1 to every question, so 1.0 is ITS reading and
        // nobody else's. It must not be a score anywhere in the document.
        var scores = document.Surveys
            .SelectMany(s => s.Demographics)
            .SelectMany(b => b.Segments)
            .SelectMany(s => s.Dimensions)
            .Select(d => d.AverageScore)
            .ToList();
        Assert.DoesNotContain(1d, scores);
    }

    // ------------------------------------------------------------------
    // #88 follow-up: per-question distributions and open-text word clouds
    // ------------------------------------------------------------------

    /// <summary>
    /// req(#88 follow-up): the section prints per-question distributions, and every
    /// bucket count in one adds up to the answers that question actually received. A
    /// projection that dropped, filtered or re-derived a bucket breaks the sum.
    /// </summary>
    [Fact]
    public void Per_question_distributions_are_printed_and_sum_to_the_answered_count()
    {
        var document = Reread(Render(Section(DemographicAggregate())));

        var question = Assert.Single(Assert.Single(document.Surveys).Questions);
        Assert.Equal(QuestionId, question.QuestionId);
        Assert.Equal("How supported do you feel?", question.Text);
        Assert.Equal(7, question.AnsweredCount);
        Assert.Equal(question.AnsweredCount, question.Distribution.Sum(bucket => bucket.Count));
        Assert.Equal(100d, question.Distribution.Sum(bucket => bucket.Percentage), 2);

        // Ordered by the question's own option order, not by popularity -- the report
        // carries the axis every other surface draws.
        Assert.Equal(["1", "4"], question.Distribution.Select(b => b.Value));
        Assert.Equal([2, 5], question.Distribution.Select(b => b.Count));
    }

    /// <summary>
    /// Five completed responses to one open-ended question. One respondent writes a
    /// distinctive sentence nobody repeats; two pairs write words that recur.
    /// </summary>
    private static SurveyAggregate OpenTextAggregate()
    {
        string[] texts =
        [
            "the visa renewal paperwork is stressful",
            "workload is heavy",
            "workload is heavy",
            "morale is good",
            "morale is good",
        ];

        var responses = Enumerable.Range(1, texts.Length).Select(n => Response(n, Engineering)).ToList();
        var answers = responses
            .Select((r, index) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(texts[index]), null))
            .ToList();

        return SurveyAggregation.Compute(
            [OpenQuestion()],
            responses,
            answers,
            [new AggregationDepartment(Engineering, "Engineering", 10)],
            targetAudienceCount: 5);
    }

    /// <summary>
    /// THE open-text rule, asserted on the bytes: a report's word cloud is a frequency
    /// map floored at <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/>, and
    /// verbatim response content is never returned by this platform at all.
    ///
    /// <para>The two halves are different risks and are asserted separately. A word in
    /// only ONE response ("visa") is the distinctiveness leak the word floor exists for
    /// -- one respondent naming themselves to a reader who knows the team. The SENTENCE
    /// is the larger half: no arrangement of words, floor or no floor, may reconstruct
    /// what somebody typed.</para>
    /// </summary>
    [Fact]
    public void A_word_cloud_prints_frequencies_above_the_word_floor_and_never_verbatim_text()
    {
        var rendered = Render(Section(OpenTextAggregate()));
        var question = Assert.Single(Assert.Single(Reread(rendered).Surveys).Questions);

        // Kept: appears in two distinct responses.
        var workload = Assert.Single(question.Words, w => w.Word == "workload");
        Assert.Equal("en", workload.Language);
        Assert.Equal(2, workload.ResponseCount);
        Assert.True(SurveyResultsPrivacy.MeetsWordFloor(workload.ResponseCount));
        Assert.Contains(question.Words, w => w.Word == "morale" && w.ResponseCount == 2);

        // Withheld: every word of the one-off sentence appears in exactly one response.
        // Asserted against the RENDERED bytes, because "not in the parsed list" would
        // still pass if the text leaked through some other field.
        foreach (var word in new[] { "visa", "renewal", "paperwork", "stressful" })
        {
            Assert.DoesNotContain(word, rendered, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(question.Words, w => w.Word == word);
        }

        Assert.DoesNotContain("the visa renewal paperwork is stressful", rendered, StringComparison.OrdinalIgnoreCase);

        // Withheld words are COUNTED, so a reader can tell an empty cloud from a
        // censored one: the five words of the one-off sentence, and nothing else.
        Assert.Equal(5, question.SuppressedWordCount);

        // Every printed word is above the floor. The invariant, not five examples.
        Assert.All(question.Words, w => Assert.True(SurveyResultsPrivacy.MeetsWordFloor(w.ResponseCount)));
    }
}
