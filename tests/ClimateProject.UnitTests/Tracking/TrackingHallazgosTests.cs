using System.Globalization;
using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Application.Tracking;

namespace ClimateProject.UnitTests.Tracking;

/// <summary>
/// #385: /api/internal/hallazgos, the feed behind the Procomer tracking sheet's
/// "Hallazgo (tema de la encuesta)" column.
///
/// **Every aggregate below is built by <see cref="SurveyAggregation.Compute"/>, never by
/// hand.** A hand-written <see cref="SurveyAggregate"/> is a payload no producer writes:
/// it would let a test agree with itself about a segment shape the real aggregation never
/// emits, and the two properties this projection actually owns -- that a sub-floor segment
/// arrives suppressed and empty, and that a dimension is a question <c>Category</c> -- are
/// exactly the ones such a fixture would fake.
/// </summary>
public class TrackingHallazgosTests
{
    private static readonly Guid SurveyId = Guid.Parse("0a0a0a0a-0000-0000-0000-000000000001");
    private static readonly Guid Engineering = Guid.Parse("dddddddd-0000-0000-0000-000000000001");
    private static readonly Guid Sales = Guid.Parse("dddddddd-0000-0000-0000-000000000002");

    private const string Comunicacion = "comunicacion";
    private const string Reconocimiento = "reconocimiento";

    private static Guid QuestionId(int n) => Guid.Parse($"11111111-0000-0000-0000-{n:D12}");

    private static Guid ResponseId(int n) => Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}");

    private static readonly IReadOnlyDictionary<Guid, string> Nodos = new Dictionary<Guid, string>
    {
        [Engineering] = "ND-ENG",
        [Sales] = "ND-SAL",
    };

    private static AggregationQuestion Scale(
        int n,
        string category,
        int? scaleMin = null,
        int? scaleMax = null,
        string type = QuestionTypes.Likert)
        => new(QuestionId(n), n, type, "How is it?", category, scaleMin, scaleMax, null, null, []);

    private static AggregationResponse Response(int n, Guid departmentId)
        => new(
            ResponseId(n),
            "es",
            departmentId,
            IsComplete: true,
            new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero),
            300,
            new Dictionary<string, string>(StringComparer.Ordinal));

    private static readonly IReadOnlyList<AggregationDepartment> Departments =
    [
        new(Engineering, "Engineering", 20),
        new(Sales, "Sales", 20),
    ];

    /// <param name="perDepartment">Department -> how many complete responses it submits.</param>
    /// <param name="answerValue">The scale point every respondent of a department picks.</param>
    private static SurveyAggregate Aggregate(
        IReadOnlyList<AggregationQuestion> questions,
        IReadOnlyDictionary<Guid, int> perDepartment,
        IReadOnlyDictionary<Guid, int> answerValue)
    {
        var responses = new List<AggregationResponse>();
        var answers = new List<AggregationAnswer>();
        var next = 1;

        foreach (var (departmentId, count) in perDepartment)
        {
            for (var i = 0; i < count; i++)
            {
                var responseNumber = next++;
                responses.Add(Response(responseNumber, departmentId));
                foreach (var question in questions)
                {
                    answers.Add(new AggregationAnswer(
                        ResponseId(responseNumber),
                        question.QuestionId,
                        JsonSerializer.Serialize(answerValue[departmentId].ToString(CultureInfo.InvariantCulture)),
                        null));
                }
            }
        }

        return SurveyAggregation.Compute(questions, responses, answers, Departments, targetAudienceCount: 40);
    }

    // ==================================================================
    // THE FLOOR RULING (settled 2026-08-27): emit the finding, withhold
    // the number.
    // ==================================================================

    /// <summary>
    /// THE headline guarantee. Sales submits four responses -- one below
    /// <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/> -- and must still appear
    /// in the feed, with a categoria and with no score. Dropping it would make a small team
    /// invisible in the tracking module, which reads as "nothing to work on"; publishing the
    /// score would defeat the floor.
    ///
    /// The attack this survives: were the ruling implemented as "skip suppressed segments",
    /// or as "call SegmentDimensionScores and take what comes back" (which returns an empty
    /// dictionary for a suppressed segment, so every dimension would silently vanish), the
    /// nodo would be absent and this test would fail on the first assertion.
    /// </summary>
    [Fact]
    public void A_department_below_the_floor_still_gets_its_hallazgos_with_a_null_score()
    {
        var questions = new[] { Scale(1, Comunicacion), Scale(2, Reconocimiento) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6, [Sales] = 4 },
            new Dictionary<Guid, int> { [Engineering] = 4, [Sales] = 2 });

        var hallazgos = TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos);

        var sales = hallazgos.Where(h => h.NodoId == "ND-SAL").ToList();

        Assert.Equal(2, sales.Count);
        Assert.Equal(
            new[] { Comunicacion, Reconocimiento },
            sales.Select(h => h.Categoria).OrderBy(c => c, StringComparer.Ordinal).ToArray());
        Assert.All(sales, h => Assert.Null(h.ResultadoPct));
        Assert.All(sales, h => Assert.False(string.IsNullOrWhiteSpace(h.Categoria)));
    }

    /// <summary>
    /// The other half of the ruling: a department that clears the floor DOES publish a
    /// number. Without this, "return null always" would pass the test above.
    /// </summary>
    [Fact]
    public void A_department_above_the_floor_publishes_its_score_as_a_fraction_of_the_scale()
    {
        var questions = new[] { Scale(1, Comunicacion) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 4 });

        var hallazgo = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos));

        // Six respondents all answered 4 on the default 1-5 scale: (4 - 1) / (5 - 1).
        Assert.Equal(0.75m, hallazgo.ResultadoPct);
        Assert.Equal(Comunicacion, hallazgo.Categoria);
        Assert.Equal("ND-ENG", hallazgo.NodoId);
        Assert.Equal(SurveyId.ToString(), hallazgo.CicloId);
    }

    /// <summary>
    /// A whole survey below its own floor has no dimension list at all, so there is nothing
    /// to withhold a score FOR. Empty, not a page of null-scored findings naming dimensions
    /// the aggregation itself refused to publish.
    /// </summary>
    [Fact]
    public void A_survey_below_its_own_floor_yields_no_hallazgos_at_all()
    {
        var questions = new[] { Scale(1, Comunicacion) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 3 },
            new Dictionary<Guid, int> { [Engineering] = 4 });

        Assert.True(aggregate.IsSuppressed);
        Assert.Empty(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos));
    }

    // ==================================================================
    // Identifier stability -- see TrackingIdentifiers.ExternalHallazgoId.
    // ==================================================================

    /// <summary>
    /// Two independent computations of the same feed produce the same ids. This is what
    /// stops an action plan the client has already written from silently orphaning between
    /// two cache syncs: <c>PlanDeAccion.HallazgoExternalId</c> is a cross-service reference
    /// with no FK behind it, so a changed id shape raises no error anywhere.
    /// </summary>
    [Fact]
    public void The_same_finding_gets_the_same_id_on_two_separate_computations()
    {
        var questions = new[] { Scale(1, Comunicacion), Scale(2, Reconocimiento) };
        var counts = new Dictionary<Guid, int> { [Engineering] = 6, [Sales] = 7 };
        var values = new Dictionary<Guid, int> { [Engineering] = 4, [Sales] = 3 };

        var first = TrackingHallazgos.ForSurvey(SurveyId, Aggregate(questions, counts, values), Nodos);
        var second = TrackingHallazgos.ForSurvey(SurveyId, Aggregate(questions, counts, values), Nodos);

        Assert.NotEmpty(first);
        Assert.Equal(
            first.Select(h => h.HallazgoId).ToList(),
            second.Select(h => h.HallazgoId).ToList());
    }

    /// <summary>
    /// Every (department x dimension) cell is a DIFFERENT finding. A derivation that dropped
    /// one of its three inputs would still be perfectly stable and would collapse the whole
    /// feed onto one id -- which is why stability alone is not the property to test.
    /// </summary>
    [Fact]
    public void Each_department_dimension_cell_gets_its_own_id()
    {
        var questions = new[] { Scale(1, Comunicacion), Scale(2, Reconocimiento) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6, [Sales] = 7 },
            new Dictionary<Guid, int> { [Engineering] = 4, [Sales] = 3 });

        var hallazgos = TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos);

        Assert.Equal(4, hallazgos.Count);
        Assert.Equal(4, hallazgos.Select(h => h.HallazgoId).Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// The id must fit <c>planes_de_accion.hallazgo_external_id</c>, which
    /// <c>PlanDeAccionConfiguration</c> declares as <c>varchar(64)</c>. A dimension name is
    /// free text of any length, so a readable composite id would truncate on write -- and a
    /// truncated foreign reference is one that stops matching without saying so.
    /// </summary>
    [Fact]
    public void The_id_fits_the_consumers_column_however_long_the_dimension_name_is()
    {
        var dimension = new string('d', 500);
        var id = TrackingIdentifiers.ExternalHallazgoId(SurveyId, Engineering, dimension);

        Assert.StartsWith("hal-", id, StringComparison.Ordinal);
        Assert.Equal(36, id.Length);
        Assert.True(id.Length <= 64);
    }

    /// <summary>
    /// Dimension names built to collide with the encoding's own punctuation still get
    /// distinct ids. A dimension is free text an author typed, so it can contain the
    /// separator and the length prefix; the encoding is length-prefixed rather than merely
    /// delimited so that no pair of them can be re-cut into one another's bytes.
    /// </summary>
    [Fact]
    public void Dimension_names_that_collide_with_the_encodings_punctuation_get_distinct_ids()
    {
        string[] adversarial = ["a", "a|b", "1:a", "3:a|b", "|", "", "a|", "|a"];

        var ids = adversarial
            .Select(d => TrackingIdentifiers.ExternalHallazgoId(SurveyId, Engineering, d))
            .ToList();

        Assert.Equal(adversarial.Length, ids.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// Two surveys, same department, same dimension: different findings. The survey id is a
    /// fixed-width GUID in the encoding, so this is the cheap half of injectivity -- but it
    /// is the half that a derivation reading only (department, dimension) would fail, and
    /// such a derivation would make this year's plan resolve against last year's finding.
    /// </summary>
    [Fact]
    public void The_same_department_and_dimension_in_two_surveys_are_two_findings()
    {
        Assert.NotEqual(
            TrackingIdentifiers.ExternalHallazgoId(SurveyId, Engineering, Comunicacion),
            TrackingIdentifiers.ExternalHallazgoId(Guid.NewGuid(), Engineering, Comunicacion));
    }

    /// <summary>
    /// The nodo_id is NOT an input to the id. A department's <c>LegacyExternalId</c> is
    /// nullable and back-fillable; had the hash been taken over the derived nodo_id, an
    /// admin filling that column in would have re-shaped every hallazgo id in the company
    /// at once and orphaned every plan pointing at them.
    /// </summary>
    [Fact]
    public void Changing_the_departments_nodo_id_does_not_change_the_hallazgo_id()
    {
        var questions = new[] { Scale(1, Comunicacion) };
        var counts = new Dictionary<Guid, int> { [Engineering] = 6 };
        var values = new Dictionary<Guid, int> { [Engineering] = 4 };

        var before = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, Aggregate(questions, counts, values), Nodos));

        var renamed = new Dictionary<Guid, string> { [Engineering] = Engineering.ToString() };
        var after = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, Aggregate(questions, counts, values), renamed));

        Assert.NotEqual(before.NodoId, after.NodoId);
        Assert.Equal(before.HallazgoId, after.HallazgoId);
    }

    // ==================================================================
    // The unit of resultado_pct.
    // ==================================================================

    /// <summary>
    /// Explicit scale bounds are honoured, not the 1-5 default. A 7 on a 0-10 scale is 0.7,
    /// and the same answer read against the default bounds would be clamped to 1.0 -- a team
    /// reported as perfect.
    /// </summary>
    [Fact]
    public void An_explicit_scale_is_normalised_against_its_own_bounds()
    {
        var questions = new[] { Scale(1, Comunicacion, scaleMin: 0, scaleMax: 10) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 7 });

        Assert.Equal(0.7m, Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos)).ResultadoPct);
    }

    /// <summary>
    /// Two questions in one dimension configured with different scales: the pooled mean is
    /// already a mixture of two units, and there is no honest single normalisation. Null,
    /// like the two benchmark fields, rather than a plausible-looking guess.
    /// </summary>
    [Fact]
    public void A_dimension_whose_questions_use_two_different_scales_reports_no_score()
    {
        var questions = new[]
        {
            Scale(1, Comunicacion, scaleMin: 1, scaleMax: 5),
            Scale(2, Comunicacion, scaleMin: 0, scaleMax: 10),
        };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 4 });

        var hallazgo = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos));

        Assert.Equal(Comunicacion, hallazgo.Categoria);
        Assert.Null(hallazgo.ResultadoPct);
    }

    /// <summary>
    /// A dimension made only of multiple-choice questions is a real dimension the instrument
    /// asked about, and it has no score. It is still published -- naming it costs nothing and
    /// the client's plan can hang off it -- with a null number rather than a zero.
    /// </summary>
    [Fact]
    public void A_dimension_with_no_numeric_question_is_published_with_no_score()
    {
        var question = new AggregationQuestion(
            QuestionId(1), 0, QuestionTypes.MultipleChoice, "Where?", Comunicacion, null, null, null, null,
            [new AggregationOption(0, "remote", "Remoto"), new AggregationOption(1, "office", "Oficina")]);

        var responses = Enumerable.Range(1, 6).Select(n => Response(n, Engineering)).ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId(1), JsonSerializer.Serialize("remote"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute(new[] { question }, responses, answers, Departments, 40);

        var hallazgo = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos));

        Assert.Equal(Comunicacion, hallazgo.Categoria);
        Assert.Null(hallazgo.ResultadoPct);
    }

    // ==================================================================
    // v1 declines the two benchmark fields.
    // ==================================================================

    [Fact]
    public void The_two_benchmark_fields_are_null_in_v1()
    {
        var questions = new[] { Scale(1, Comunicacion) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 4 });

        var hallazgo = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos));

        Assert.Null(hallazgo.BenchmarkSectorPct);
        Assert.Null(hallazgo.ResultadoAnioAnteriorPct);
    }

    /// <summary>
    /// A segment whose department is not in the company's department map cannot be given a
    /// nodo_id, and a hallazgo whose nodo_id is absent from /api/internal/nodos is an
    /// unattachable finding. Dropped rather than emitted with an invented nodo.
    /// </summary>
    [Fact]
    public void A_segment_with_no_matching_nodo_is_dropped_rather_than_given_an_invented_one()
    {
        var questions = new[] { Scale(1, Comunicacion) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6, [Sales] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 4, [Sales] = 3 });

        var onlyEngineering = new Dictionary<Guid, string> { [Engineering] = "ND-ENG" };

        var hallazgo = Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, onlyEngineering));

        Assert.Equal("ND-ENG", hallazgo.NodoId);
    }

    /// <summary>
    /// The score is the one <see cref="SurveyAggregation.SegmentDimensionScores"/> produces,
    /// normalised -- not a second aggregation. The leader dashboard and the climate-over-time
    /// matrix read that same function, and a client comparing its tracking sheet against the
    /// dashboard must not find two numbers for the same team, dimension and survey.
    /// </summary>
    [Fact]
    public void The_score_is_the_shared_segment_rollup_and_not_a_second_derivation()
    {
        var questions = new[] { Scale(1, Comunicacion), Scale(2, Comunicacion) };

        var aggregate = Aggregate(
            questions,
            new Dictionary<Guid, int> { [Engineering] = 6 },
            new Dictionary<Guid, int> { [Engineering] = 3 });

        var segment = aggregate.Breakdowns
            .Single(b => b.Dimension == SurveyClimateTrends.DepartmentGroup)
            .Segments
            .Single(s => s.Key == Engineering.ToString());

        var pooled = SurveyAggregation.SegmentDimensionScores(aggregate.Questions, segment)[Comunicacion];
        var expected = Math.Round((decimal)((pooled!.Value - 1) / 4), 4, MidpointRounding.AwayFromZero);

        Assert.Equal(expected, Assert.Single(TrackingHallazgos.ForSurvey(SurveyId, aggregate, Nodos)).ResultadoPct);
    }
}
