using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The demographic cross: parsing the selectors, matching responses, and -- the part that
/// matters -- deciding whether a narrowed cohort may be disclosed at all.
///
/// Every property here is provable without Postgres for the same reason the aggregation's are:
/// the filter is a pure function over plain records.
/// </summary>
public class SurveyResultsFilterTests
{
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Finance = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid Sales = Guid.Parse("44444444-4444-4444-4444-444444444444");

    private const int Floor = SurveyResultsPrivacy.MinimumSegmentRespondents;

    /// <summary>
    /// A field every fixture row in the disclosure section carries, so a query can name TWO
    /// selectors and still describe exactly the cohort its first selector describes.
    /// </summary>
    private static readonly (string Field, string Value) Sede = ("sede", "central");

    /// <summary>
    /// A CROSS over one demographic value, which since 2026-10-15 is the only shape
    /// <c>MayDisclose</c> decides anything about.
    /// </summary>
    /// <remarks>
    /// One selector is a single dimension, and the ruling of 2026-10-15 reports a single
    /// dimension at any size -- <c>MayDisclose</c> now answers a one-selector query
    /// unconditionally, so a one-selector fixture proves nothing whatever about the
    /// differencing rule. <see cref="Sede"/> is carried by every row of these fixtures, so the
    /// cohort and the leftover are arithmetically identical to what they were when these tests
    /// were written against a single selector: the counts in them did not have to move, and
    /// deliberately did not.
    /// </remarks>
    private static SurveyResultsFilter Cross(string field, string value)
        => SurveyResultsFilter.For(
            new SurveySegmentSelector(field, value),
            new SurveySegmentSelector(Sede.Field, Sede.Value));

    private static string Stored(string value) => JsonSerializer.Serialize(value);

    private static AggregationQuestion Scale() =>
        new(QuestionId, 0, QuestionTypes.Likert, "I know what is expected of me", "Claridad", 1, 5, null, null, []);

    private static AggregationResponse Response(
        int n,
        Guid? departmentId = null,
        IReadOnlyDictionary<string, string>? demographics = null,
        bool isComplete = true)
        => new(
            Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}"),
            "es",
            departmentId,
            isComplete,
            new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero),
            isComplete ? new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero) : null,
            isComplete ? 300 : null,
            demographics ?? new Dictionary<string, string>(StringComparer.Ordinal));

    private static Dictionary<string, string> Demo(params (string Field, string Value)[] pairs)
        => pairs.ToDictionary(p => p.Field, p => p.Value, StringComparer.Ordinal);

    /// <summary>
    /// The same cohort, with its demographics in the shape the LOADER passes: raw jsonb, which
    /// `SurveyAggregation` decodes once on the way in. `Compute` must be given these, because a
    /// bare string is not JSON and `DecodeDemographics` drops it -- a fixture that passes plain
    /// strings produces an aggregate with no demographic breakdown at all, and a filter test
    /// over it then passes because the cohort is EMPTY rather than because it was withheld.
    /// `MayDisclose` and `Matches` are called after that decode, so the plain helper is right
    /// for the direct tests and this one is right for everything that goes through `Compute`.
    /// </summary>
    private static List<AggregationResponse> StoredCohort(
        int start,
        int count,
        Guid? departmentId = null,
        params (string Field, string Value)[] demographics)
        => Enumerable.Range(start, count)
            .Select(n => Response(
                n,
                departmentId,
                demographics.ToDictionary(d => d.Field, d => Stored(d.Value), StringComparer.Ordinal)))
            .ToList();

    /// <summary>A cohort of <paramref name="count"/> complete responses all carrying <paramref name="demographics"/>.</summary>
    private static List<AggregationResponse> Cohort(
        int start,
        int count,
        Guid? departmentId = null,
        params (string Field, string Value)[] demographics)
        => Enumerable.Range(start, count)
            .Select(n => Response(n, departmentId, Demo(demographics)))
            .ToList();

    // ==================================================================
    // Parsing
    // ==================================================================

    [Fact]
    public void No_selectors_is_the_whole_survey()
    {
        Assert.True(SurveyResultsFilter.TryParse(null, out var filter, out var error));
        Assert.Null(error);
        Assert.True(filter.IsEmpty);

        Assert.True(SurveyResultsFilter.TryParse([" ", ""], out var blank, out _));
        Assert.True(blank.IsEmpty);
    }

    [Fact]
    public void A_selector_is_split_on_its_first_colon_so_a_value_may_contain_one()
    {
        Assert.True(SurveyResultsFilter.TryParse(["puesto:Gerencia: Finanzas"], out var filter, out _));
        var selector = Assert.Single(filter.Selectors);
        Assert.Equal("puesto", selector.Field);
        Assert.Equal("Gerencia: Finanzas", selector.Value);
    }

    [Fact]
    public void A_malformed_selector_is_refused_rather_than_ignored()
    {
        // Refused, not dropped: silently ignoring a selector answers a question about a wider
        // cohort than the caller asked about, and the answer looks exactly as authoritative.
        Assert.False(SurveyResultsFilter.TryParse(["puesto"], out _, out var noColon));
        Assert.Contains("field:value", noColon);

        Assert.False(SurveyResultsFilter.TryParse([":Gerencia"], out _, out var noField));
        Assert.Contains("field:value", noField);

        Assert.False(SurveyResultsFilter.TryParse(["puesto:"], out _, out var noValue));
        Assert.Contains("field:value", noValue);
    }

    [Fact]
    public void One_value_per_field_and_at_most_three_fields()
    {
        // Two values for one field is an OR, and an OR over a quasi-identifier assembles a
        // cohort out of parts that were each refused.
        Assert.False(SurveyResultsFilter.TryParse(["pais:cr", "pais:co"], out _, out var repeated));
        Assert.Contains("more than once", repeated);

        Assert.False(
            SurveyResultsFilter.TryParse(["a:1", "b:2", "c:3", "d:4"], out _, out var tooMany));
        Assert.Contains("At most 3", tooMany);

        Assert.True(SurveyResultsFilter.TryParse(["a:1", "b:2", "c:3"], out var three, out _));
        Assert.Equal(3, three.Selectors.Count);
        Assert.Equal(3, SurveyResultsFilter.MaxSelectors);
    }

    [Fact]
    public void The_department_selector_must_name_a_department_by_id()
    {
        Assert.False(SurveyResultsFilter.TryParse(["department:Finanzas"], out _, out var error));
        Assert.Contains("by its id", error);

        Assert.True(SurveyResultsFilter.TryParse([$"department:{Finance}"], out var filter, out _));
        Assert.True(Assert.Single(filter.Selectors).IsDepartment);
    }

    // ==================================================================
    // Matching
    // ==================================================================

    [Fact]
    public void Matching_reads_the_decoded_demographic_and_the_department()
    {
        var filter = SurveyResultsFilter.For(
            new SurveySegmentSelector("puesto", "gerencia"),
            new SurveySegmentSelector(SurveySegmentSelector.DepartmentField, Finance.ToString()));

        Assert.True(filter.Matches(Response(1, Finance, Demo(("puesto", "gerencia")))));

        // Every selector has to hold: this is an AND, which is what a cross is.
        Assert.False(filter.Matches(Response(2, Sales, Demo(("puesto", "gerencia")))));
        Assert.False(filter.Matches(Response(3, Finance, Demo(("puesto", "operativo")))));

        // A response carrying no value for the field is outside the cohort, never inside it.
        Assert.False(filter.Matches(Response(4, Finance, Demo())));
    }

    [Fact]
    public void Matching_is_case_sensitive_on_the_stored_value()
    {
        var filter = SurveyResultsFilter.For(new SurveySegmentSelector("genero", "femenino"));
        Assert.True(filter.Matches(Response(1, demographics: Demo(("genero", "femenino")))));
        // The stored value is a stable code, not display text; folding case here would merge
        // two codes the rest of the aggregation treats as different buckets.
        Assert.False(filter.Matches(Response(2, demographics: Demo(("genero", "Femenino")))));
    }

    // ==================================================================
    // Disclosure -- the property this class exists for
    // ==================================================================

    /// <summary>
    /// The attack the cohort's own size does not stop. A=10, B=7, C=2 over 19 people: A and B
    /// each clear the floor, so a naive rule discloses both -- and then whole minus A minus B
    /// is C, two people, means and all.
    ///
    /// C was 3 until the floor became 3 (ruled 2026-10-13), at which point a C of 3 is
    /// disclosed on its own merits and there is no subtraction to demonstrate. The attack is
    /// unchanged; only the number that is too small to stand alone moved.
    ///
    /// Asked as a CROSS since 2026-10-15, for the reason <see cref="Cross"/> gives. The attack
    /// is unchanged again, and so are the counts.
    /// </summary>
    [Fact]
    public void A_cohort_is_refused_when_what_is_left_over_could_be_subtracted_out()
    {
        List<AggregationResponse> completed =
        [
            .. Cohort(1, 10, null, ("puesto", "a"), Sede),
            .. Cohort(100, 7, null, ("puesto", "b"), Sede),
            .. Cohort(200, 2, null, ("puesto", "c"), Sede),
        ];

        Assert.True(Cross("puesto", "a").MayDisclose(completed, Floor));

        // b is large enough on its own and is still refused: disclosing it would leave a
        // remainder of two, which is c.
        Assert.False(Cross("puesto", "b").MayDisclose(completed, Floor));
        Assert.False(Cross("puesto", "c").MayDisclose(completed, Floor));

        // The mutation that proves the rule has teeth: make the leftover large enough and b
        // becomes disclosable without anything about b itself changing.
        List<AggregationResponse> roomier = [.. completed, .. Cohort(300, 2, null, ("puesto", "c"), Sede)];
        Assert.True(Cross("puesto", "b").MayDisclose(roomier, Floor));
    }

    /// <summary>
    /// The 2026-10-15 ruling, at this level: ONE selector is answered at any size.
    ///
    /// Two people are refused as a cross and disclosed as a single dimension, in the same
    /// fixture, in the same test -- because the breakdown beside it publishes that same
    /// two-person group in full, so refusing the one-selector query would withhold a number
    /// the screen already shows. It is also the only test here that fails if the
    /// <c>Selectors.Count &lt; 2</c> short-circuit is removed.
    /// </summary>
    [Fact]
    public void A_single_selector_is_disclosed_at_any_size_and_the_same_cohort_crossed_is_not()
    {
        List<AggregationResponse> completed =
        [
            .. Cohort(1, 12, null, ("puesto", "operativo"), Sede),
            .. Cohort(100, 2, null, ("puesto", "gerencia"), Sede),
        ];

        Assert.True(
            SurveyResultsFilter.For(new SurveySegmentSelector("puesto", "gerencia"))
                .MayDisclose(completed, Floor));
        Assert.False(Cross("puesto", "gerencia").MayDisclose(completed, Floor));
    }

    [Fact]
    public void A_cohort_under_the_floor_is_always_refused()
    {
        List<AggregationResponse> completed =
        [
            .. Cohort(1, 12, null, ("puesto", "operativo"), Sede),
            .. Cohort(100, 2, null, ("puesto", "gerencia"), Sede),
        ];

        Assert.False(Cross("puesto", "gerencia").MayDisclose(completed, Floor));
    }

    /// <summary>
    /// The call's own example, at the shape it really has: one manager per department. Asking
    /// for "gerencia within finanzas" has to be refused, and it is refused by arithmetic rather
    /// than by a rule about management.
    /// </summary>
    [Fact]
    public void Gerencia_within_finanzas_is_refused_because_it_is_one_person()
    {
        List<AggregationResponse> completed =
        [
            .. Cohort(1, 9, Finance, ("puesto", "operativo")),
            .. Cohort(100, 1, Finance, ("puesto", "gerencia")),
            .. Cohort(200, 8, Sales, ("puesto", "operativo")),
            .. Cohort(300, 1, Sales, ("puesto", "gerencia")),
        ];

        var cross = SurveyResultsFilter.For(
            new SurveySegmentSelector(SurveySegmentSelector.DepartmentField, Finance.ToString()),
            new SurveySegmentSelector("puesto", "gerencia"));
        Assert.False(cross.MayDisclose(completed, Floor));

        // The department on its own is fine. It was the arithmetic that said so -- nine plus
        // one is ten, and the other department leaves nine behind -- and since 2026-10-15 it is
        // the ruling: one selector is one dimension, answered at any size, so this holds now
        // even where the arithmetic would not.
        var department = SurveyResultsFilter.For(
            new SurveySegmentSelector(SurveySegmentSelector.DepartmentField, Finance.ToString()));
        Assert.True(department.MayDisclose(completed, Floor));
    }

    /// <summary>
    /// The tie-break, and the surface that no longer has to agree with it.
    ///
    /// With two equal cohorts and a subtractable remainder a cross has to withhold one, and
    /// WHICH one must be the same every time it is asked: two refusals naming different
    /// cohorts would between them disclose both — the "two rules over the same
    /// quasi-identifiers, differenced against each other" failure `SurveyResultsPrivacy`
    /// warns about. On equal counts the smaller key goes, so "aaa" is refused and "bbb" is not.
    ///
    /// The breakdown beside it used to have to break the same tie the same way, because it
    /// withheld from the same sibling set. Since 2026-10-15 it withholds NEITHER. That is
    /// asserted here rather than deleted, because "the breakdown withholds nothing" is the
    /// premise that makes every remaining refusal in this file coherent: a cross is refused
    /// while the single dimensions it is built from are published.
    /// </summary>
    [Fact]
    public void The_cross_breaks_a_tie_the_same_way_every_time_and_the_breakdown_breaks_none()
    {
        // Decoded, for the direct call; stored, for the one that goes through Compute. Same rows.
        List<AggregationResponse> decoded =
        [
            .. Cohort(1, 5, null, ("grupo", "aaa"), Sede),
            .. Cohort(100, 5, null, ("grupo", "bbb"), Sede),
            .. Cohort(200, 2, null, Sede),
        ];
        List<AggregationResponse> stored =
        [
            .. StoredCohort(1, 5, null, ("grupo", "aaa"), Sede),
            .. StoredCohort(100, 5, null, ("grupo", "bbb"), Sede),
            // Two, not three: at a floor of 3 an unsegmented remainder of three stands on its
            // own and nothing is withheld, so there would be no tie left for the cross to break.
            .. StoredCohort(200, 2, null, Sede),
        ];
        var answers = Answers(stored, "4");

        // The cross: "aaa" is the one refused, because on equal counts the smaller key goes.
        Assert.False(Cross("grupo", "aaa").MayDisclose(decoded, Floor));
        Assert.True(Cross("grupo", "bbb").MayDisclose(decoded, Floor));

        // The breakdown, over the very same rows, withholds neither -- and publishes the full
        // five of the group the cross just refused.
        var aggregate = SurveyAggregation.Compute([Scale()], stored, answers, [], targetAudienceCount: 20);
        var breakdown = Assert.Single(aggregate.Breakdowns, b => b.Dimension == "grupo");
        var aaa = Assert.Single(breakdown.Segments, x => x.Key == "aaa");
        var bbb = Assert.Single(breakdown.Segments, x => x.Key == "bbb");
        Assert.False(aaa.IsSuppressed);
        Assert.False(bbb.IsSuppressed);
        Assert.Equal(5, aaa.RespondentCount);
        Assert.Equal(0, breakdown.SuppressedSegmentCount);
    }

    [Fact]
    public void An_empty_filter_is_always_disclosable_because_the_survey_floor_governs_it()
    {
        Assert.True(SurveyResultsFilter.None.MayDisclose([], Floor));
        Assert.True(SurveyResultsFilter.None.MayDisclose(Cohort(1, 2, null, ("x", "y")), Floor));
    }

    [Fact]
    public void Responses_carrying_no_value_for_the_field_still_count_as_leftover()
    {
        // Ten answered with a value, six carry none. Disclosing the ten of "a" leaves six,
        // which is over the floor, so it is allowed -- the unsegmented people are leftover
        // like anybody else, exactly as UnsegmentedRespondentCount treats them.
        List<AggregationResponse> completed =
        [
            .. Cohort(1, 10, null, ("puesto", "a"), Sede),
            .. Cohort(100, 6, null, Sede),
        ];
        Assert.True(Cross("puesto", "a").MayDisclose(completed, Floor));

        // Drop the unsegmented group under the floor and the same cohort becomes subtractable.
        List<AggregationResponse> tight =
        [
            .. Cohort(1, 10, null, ("puesto", "a"), Sede),
            .. Cohort(100, 2, null, Sede),
        ];
        Assert.False(Cross("puesto", "a").MayDisclose(tight, Floor));
    }

    // ==================================================================
    // What Compute does with a filter
    // ==================================================================

    private static List<AggregationAnswer> Answers(IEnumerable<AggregationResponse> responses, string value)
        => responses.Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored(value), null)).ToList();

    [Fact]
    public void A_disclosable_cross_aggregates_only_its_own_cohort()
    {
        var inside = Cohort(1, 6, Finance, ("puesto", "operativo"));
        var outside = Cohort(100, 7, Sales, ("puesto", "operativo"));
        List<AggregationResponse> completed = [.. inside, .. outside];
        List<AggregationAnswer> answers = [.. Answers(inside, "5"), .. Answers(outside, "1")];

        var filter = SurveyResultsFilter.For(
            new SurveySegmentSelector(SurveySegmentSelector.DepartmentField, Finance.ToString()));

        var aggregate = SurveyAggregation.Compute(
            [Scale()], completed, answers, [], targetAudienceCount: 40, filter);

        Assert.False(aggregate.IsSuppressed);
        Assert.Equal(6, aggregate.Summary.CompletedCount);

        var question = Assert.Single(aggregate.Questions);
        Assert.Equal(5d, question.Average);
        Assert.Equal(6, question.AnsweredCount);

        // The invited headcount belongs to the whole survey, so a cohort reports no rate at
        // all rather than one computed against a denominator that was never its own.
        Assert.Null(aggregate.Summary.ParticipationRate);
    }

    [Fact]
    public void A_single_department_of_one_agrees_with_its_disclosed_breakdown()
    {
        var inside = Cohort(1, 1, Finance);
        var outside = Cohort(100, 4, Sales);
        var aggregate = SurveyAggregation.Compute(
            [Scale()], [.. inside, .. outside], [.. Answers(inside, "5"), .. Answers(outside, "1")], [],
            targetAudienceCount: null, filter: SurveyResultsFilter.For(new SurveySegmentSelector("department", Finance.ToString())));
        Assert.False(aggregate.IsSuppressed);
        Assert.Equal(1, aggregate.Summary.CompletedCount);
        Assert.Equal(5d, Assert.Single(aggregate.Questions).Average);
        Assert.Equal(1, aggregate.MinimumGroupSize);
    }

    [Fact]
    public void A_single_department_cannot_bypass_the_whole_survey_floor()
    {
        var inside = Cohort(1, 1, Finance);
        var aggregate = SurveyAggregation.Compute(
            [Scale()], inside, Answers(inside, "5").ToList(), [],
            targetAudienceCount: null, filter: SurveyResultsFilter.For(new SurveySegmentSelector("department", Finance.ToString())));
        Assert.True(aggregate.IsSuppressed);
        Assert.Empty(aggregate.Questions);
    }

    [Fact]
    public void A_refused_cross_says_nothing_whatever_about_its_cohort()
    {
        var gerencia = StoredCohort(1, 1, Finance, ("puesto", "gerencia"), Sede);
        var rest = StoredCohort(100, 14, Finance, ("puesto", "operativo"), Sede);
        List<AggregationResponse> completed = [.. gerencia, .. rest];
        List<AggregationAnswer> answers = [.. Answers(gerencia, "1"), .. Answers(rest, "4")];

        var aggregate = SurveyAggregation.Compute(
            [Scale()],
            completed,
            answers,
            [],
            targetAudienceCount: 20,
            // A cross, because that is what is refused now: one gerente in finanzas, asked for
            // by the two selectors that single them out.
            Cross("puesto", "gerencia"));

        Assert.True(aggregate.IsSuppressed);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumSegmentRespondents, aggregate.SuppressionReason);
        Assert.Empty(aggregate.Questions);
        Assert.Empty(aggregate.Dimensions);
        Assert.Empty(aggregate.Breakdowns);

        // The SURVEY's participation, never the cohort's. For a cross the count is itself the
        // disclosure: "there is one gerente in finanzas" is the fact being withheld.
        Assert.Equal(15, aggregate.Summary.CompletedCount);
    }

    [Fact]
    public void A_filter_matching_nobody_is_suppressed_by_the_survey_floor()
    {
        var completed = StoredCohort(1, 12, Finance, ("puesto", "operativo"));

        var aggregate = SurveyAggregation.Compute(
            [Scale()],
            completed,
            Answers(completed, "4"),
            [],
            targetAudienceCount: 20,
            SurveyResultsFilter.For(new SurveySegmentSelector("puesto", "no_such_value")));

        Assert.True(aggregate.IsSuppressed);
        Assert.Empty(aggregate.Questions);
    }

    [Fact]
    public void No_filter_leaves_the_aggregation_exactly_as_it_was()
    {
        var completed = Cohort(1, 8, Finance, ("puesto", "operativo"));
        var answers = Answers(completed, "4");

        var withoutArgument = SurveyAggregation.Compute([Scale()], completed, answers, [], 10);
        var withNone = SurveyAggregation.Compute([Scale()], completed, answers, [], 10, SurveyResultsFilter.None);
        var withNull = SurveyAggregation.Compute([Scale()], completed, answers, [], 10, null);

        Assert.Equal(withoutArgument.Summary.CompletedCount, withNone.Summary.CompletedCount);
        Assert.Equal(withoutArgument.Summary.ParticipationRate, withNull.Summary.ParticipationRate);
        Assert.Equal(80d, withoutArgument.Summary.ParticipationRate);
        Assert.False(withNone.IsSuppressed);
    }

    // ==================================================================
    // The rollup the endpoints used to throw away
    // ==================================================================

    [Fact]
    public void The_dimension_rollup_is_computed_per_category_and_survives_a_filter()
    {
        var clarity = new AggregationQuestion(
            QuestionId, 0, QuestionTypes.Likert, "Claridad", "Claridad", 1, 5, null, null, []);
        var second = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var leadership = new AggregationQuestion(
            second, 1, QuestionTypes.Likert, "Liderazgo", "Liderazgo", 1, 5, null, null, []);

        var completed = Cohort(1, 6, Finance, ("puesto", "operativo"));
        List<AggregationAnswer> answers =
        [
            .. completed.Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("5"), null)),
            .. completed.Select(r => new AggregationAnswer(r.ResponseId, second, Stored("3"), null)),
        ];

        var aggregate = SurveyAggregation.Compute([clarity, leadership], completed, answers, [], 10);

        Assert.Equal(2, aggregate.Dimensions.Count);
        var claridad = Assert.Single(aggregate.Dimensions, d => d.Dimension == "Claridad");
        Assert.Equal(5d, claridad.AverageScore);
        Assert.Equal(1, claridad.QuestionCount);
        Assert.Equal(6, claridad.AnsweredCount);
        Assert.Equal(3d, Assert.Single(aggregate.Dimensions, d => d.Dimension == "Liderazgo").AverageScore);

        // And the same rollup is what a cross returns, which is the whole point of the cross:
        // "la categoría Comunicación: el resultado es 4,8 para los gerentes de finanzas".
        var crossed = SurveyAggregation.Compute(
            [clarity, leadership],
            completed,
            answers,
            [],
            10,
            SurveyResultsFilter.For(new SurveySegmentSelector(SurveySegmentSelector.DepartmentField, Finance.ToString())));
        Assert.Equal(2, crossed.Dimensions.Count);
    }
}
