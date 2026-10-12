using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The pure halves of the 2026-10-12 rulings: how a self-declared área becomes a department in
/// the aggregation (floored at read time), and how a participant identity is validated.
/// </summary>
public class SelfDeclaredAreaAndParticipantTests
{
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Operaciones = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid Ventas = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Finanzas = Guid.Parse("55555555-5555-5555-5555-555555555555");

    private static readonly IReadOnlyList<AggregationDepartment> Departments =
    [
        new(Operaciones, "Operaciones", 0),
        new(Ventas, "Ventas", 0),
        new(Finanzas, "Finanzas", 0),
    ];

    private static AggregationResponse Declared(int n, string? area, Guid? stored = null)
        => new(
            Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}"),
            "es",
            stored,
            true,
            new DateTimeOffset(2026, 10, 12, 9, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 10, 12, 9, 5, 0, TimeSpan.Zero),
            300,
            area is null
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    [SelfDeclaredDepartment.FieldKey] = JsonSerializer.Serialize(area),
                });

    private static SurveyAggregate Aggregate(IReadOnlyList<AggregationResponse> responses)
        => SurveyAggregation.Compute(
            [new AggregationQuestion(QuestionId, 0, QuestionTypes.Likert, "Q", "liderazgo", 1, 5, null, null, [])],
            responses,
            [.. responses.Select(r => new AggregationAnswer(r.ResponseId, QuestionId, JsonSerializer.Serialize("4"), null))],
            Departments,
            targetAudienceCount: null);

    private static List<AggregationResponse> Cohort(params (Guid Area, int Count)[] groups)
    {
        var responses = new List<AggregationResponse>();
        var n = 0;
        foreach (var (area, count) in groups)
        {
            for (var i = 0; i < count; i++)
            {
                responses.Add(Declared(++n, area.ToString()));
            }
        }

        return responses;
    }

    [Fact]
    public void A_declared_area_counts_under_its_department_and_never_as_a_second_dimension()
    {
        var aggregate = Aggregate(Cohort((Operaciones, 5), (Ventas, 4), (Finanzas, 1)));

        var departments = Assert.Single(aggregate.Breakdowns);
        Assert.Equal("department", departments.Dimension);
        var operaciones = Assert.Single(departments.Segments, s => s.Key == Operaciones.ToString());
        Assert.False(operaciones.IsSuppressed);
        Assert.Equal(5, operaciones.RespondentCount);
        Assert.Equal(0, departments.UnsegmentedRespondentCount);
    }

    /// <summary>
    /// The floor is the department floor, at read time. Four declared Ventas are withheld --
    /// no count, no rate, no questions -- exactly as four stored ones would be.
    /// </summary>
    [Fact]
    public void Four_declared_respondents_are_withheld_like_any_department_under_the_floor()
    {
        var aggregate = Aggregate(Cohort((Operaciones, 5), (Ventas, 4), (Finanzas, 1)));

        var ventas = Assert.Single(Assert.Single(aggregate.Breakdowns).Segments, s => s.Key == Ventas.ToString());
        Assert.True(ventas.IsSuppressed);
        Assert.Equal(0, ventas.RespondentCount);
        Assert.Null(ventas.ParticipationRate);
        Assert.Empty(ventas.Questions);
    }

    [Fact]
    public void A_stored_department_always_wins_over_a_declared_one()
    {
        Assert.Equal(Ventas, SelfDeclaredDepartment.Effective(Ventas, Operaciones.ToString(), Departments.Select(d => d.DepartmentId).ToHashSet()));
    }

    [Theory]
    [InlineData("66666666-6666-6666-6666-666666666666")]
    [InlineData("operaciones")]
    [InlineData("")]
    [InlineData(null)]
    public void A_declared_value_that_is_not_one_of_the_tenants_departments_places_nobody(string? declared)
    {
        Assert.Null(SelfDeclaredDepartment.Effective(null, declared, Departments.Select(d => d.DepartmentId).ToHashSet()));
    }

    /// <summary>
    /// A company that configured its own "department" field before the key was reserved keeps
    /// it as the demographic it always was: a label is not lifted, and not stripped.
    /// </summary>
    [Fact]
    public void A_legacy_department_label_stays_a_demographic()
    {
        var responses = Enumerable.Range(1, 5).Select(n => Declared(n, "sales")).ToList();

        var aggregate = Aggregate(responses);

        Assert.Contains(aggregate.Breakdowns, b => b.Dimension == "department" && b.UnsegmentedRespondentCount == 5);
        Assert.Equal(2, aggregate.Breakdowns.Count);
    }

    [Theory]
    [InlineData("department", true)]
    [InlineData(" Department ", true)]
    [InlineData("DEPARTMENT", true)]
    [InlineData("departamento", false)]
    [InlineData("area", false)]
    [InlineData(null, false)]
    public void The_reserved_key_is_matched_however_it_is_typed(string? key, bool reserved)
        => Assert.Equal(reserved, SelfDeclaredDepartment.IsReservedKey(key));

    // ------------------------------------------------------------------
    // Participant identity
    // ------------------------------------------------------------------

    [Fact]
    public void A_name_is_trimmed_and_an_email_lower_cased()
    {
        var (participant, error) = ParticipantIdentity.Validate(new SurveyParticipantInput("  Ana \t  Pérez ", " Ana@Planta.TEST "));

        Assert.Null(error);
        Assert.Equal("Ana Pérez", participant!.Name);
        Assert.Equal("ana@planta.test", participant.Email);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_name_is_required(string? name)
    {
        var (participant, error) = ParticipantIdentity.Validate(new SurveyParticipantInput(name, "ana@planta.test"));

        Assert.Null(participant);
        Assert.NotNull(error);
    }

    [Fact]
    public void No_identity_at_all_is_refused()
        => Assert.NotNull(ParticipantIdentity.Validate(null).Error);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_email_is_optional(string? email)
    {
        var (participant, error) = ParticipantIdentity.Validate(new SurveyParticipantInput("José Mora", email));

        Assert.Null(error);
        Assert.Null(participant!.Email);
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("ana@@planta.test")]
    [InlineData("@planta.test")]
    [InlineData("ana@planta")]
    [InlineData("ana@planta.")]
    [InlineData("ana maria@planta.test")]
    public void A_malformed_email_is_refused_and_the_error_never_quotes_it(string email)
    {
        var (participant, error) = ParticipantIdentity.Validate(new SurveyParticipantInput("Ana", email));

        Assert.Null(participant);
        Assert.NotNull(error);
        Assert.DoesNotContain(email, error, StringComparison.Ordinal);
    }

    [Fact]
    public void Over_long_values_are_refused()
    {
        Assert.NotNull(ParticipantIdentity.Validate(new SurveyParticipantInput(new string('a', ParticipantIdentity.NameMaxLength + 1))).Error);
        Assert.NotNull(ParticipantIdentity.Validate(new SurveyParticipantInput("Ana", new string('a', ParticipantIdentity.EmailMaxLength) + "@x.co")).Error);
    }
}
