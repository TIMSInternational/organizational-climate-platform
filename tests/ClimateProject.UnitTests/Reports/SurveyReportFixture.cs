using ClimateProject.Application.Exports;
using ClimateProject.Application.Reports.SurveyReports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// A small survey for the report tests, built as the aggregation's own inputs: Likert answers
/// stored as JSON numbers and demographics as JSON strings, exactly as the respond endpoint
/// writes them, so <see cref="SurveyAggregation.Compute"/> decodes them as it does in production.
/// </summary>
internal sealed class SurveyReportFixture
{
    public static readonly Guid Operaciones = Guid.Parse("11111111-0000-0000-0000-000000000001");
    public static readonly Guid Legal = Guid.Parse("11111111-0000-0000-0000-000000000002");
    public static readonly Guid Finanzas = Guid.Parse("11111111-0000-0000-0000-000000000003");

    private readonly List<AggregationQuestion> _questions = [];
    private readonly List<AggregationResponse> _responses = [];
    private readonly List<AggregationAnswer> _answers = [];

    public SurveyReportFixture()
    {
        // Two dimensions, asked in the order Liderazgo then Carga -- deliberately not
        // alphabetical, so a test can tell instrument order from key order.
        AddLikert("Mi jefatura me trata con respeto.", "liderazgo");
        AddLikert("Mi jefatura reconoce mi trabajo.", "liderazgo");
        AddLikert("Mi carga de trabajo me permite descansar.", "carga");
        _questions.Add(new AggregationQuestion(Guid.NewGuid(), _questions.Count, "open_ended", "¿Qué cambiaría?", null, null, null, null, null, []));
    }

    public IReadOnlyList<AggregationDepartment> Departments { get; } =
    [
        new(Operaciones, "Operaciones", 40),
        new(Legal, "Legal", 10),
        new(Finanzas, "Finanzas", 20),
    ];

    public IReadOnlyList<AggregationQuestion> Questions => _questions;

    /// <summary>Adds <paramref name="count"/> complete responses with the same department, gender and score on every scale question.</summary>
    public SurveyReportFixture Add(int count, Guid? department, string? gender, int score, string? tenure = null, string? comment = null)
    {
        for (var i = 0; i < count; i++)
        {
            var id = Guid.NewGuid();
            var demographics = new Dictionary<string, string>(StringComparer.Ordinal);
            if (gender is not null)
            {
                demographics["gender"] = $"\"{gender}\"";
            }

            if (tenure is not null)
            {
                demographics["tenure"] = $"\"{tenure}\"";
            }

            _responses.Add(new AggregationResponse(id, "es", department, true, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, 120, demographics));
            foreach (var question in _questions)
            {
                if (question.Type == "likert")
                {
                    _answers.Add(new AggregationAnswer(id, question.QuestionId, score.ToString(System.Globalization.CultureInfo.InvariantCulture), null));
                }
                else if (comment is not null)
                {
                    _answers.Add(new AggregationAnswer(id, question.QuestionId, $"\"{comment}\"", comment));
                }
            }
        }

        return this;
    }

    public SurveyAggregationInputs Inputs(int? invited = 100) => new(_questions, _responses, _answers, Departments, invited);

    public static SurveyExportLabels Labels { get; } = new(
        new Dictionary<string, string>(StringComparer.Ordinal) { ["gender"] = "Género", ["tenure"] = "Antigüedad" },
        new Dictionary<(string Field, string Value), string>
        {
            [("gender", "mujer")] = "Mujer",
            [("gender", "hombre")] = "Hombre",
            [("gender", "otra")] = "Otra",
        });

    public static SurveyReportBands Bands { get; } = new(3.00m, 4.00m, "Crítica", "Oportunidad", "Fortaleza");

    public SurveyReportSource Source(SurveyReportOptions options, SurveyAggregate? compare = null, string locale = "es")
    {
        var inputs = Inputs();
        return new SurveyReportSource(
            locale,
            "Meridiano",
            "Clima Organizacional 2026",
            "closed",
            new DateTimeOffset(2026, 11, 14, 9, 0, 0, TimeSpan.FromHours(-6)),
            ScoreScale.Mean,
            Bands,
            inputs,
            inputs.Compute(),
            Labels,
            options,
            compare is null ? null : "Clima Organizacional 2025",
            compare);
    }

    public static SurveyReportOptions Options(string? sections = null, string[]? departments = null, string[]? crosses = null, string? compare = null)
    {
        Assert.True(SurveyReportOptions.TryParse(sections, departments, crosses, compare, out var options, out var error), error);
        return options;
    }

    private void AddLikert(string text, string category)
        => _questions.Add(new AggregationQuestion(
            Guid.NewGuid(),
            _questions.Count,
            "likert",
            text,
            category,
            1,
            5,
            "Totalmente en desacuerdo",
            "Totalmente de acuerdo",
            [.. Enumerable.Range(1, 5).Select(p => new AggregationOption(p - 1, p.ToString(System.Globalization.CultureInfo.InvariantCulture), null))]));
}
