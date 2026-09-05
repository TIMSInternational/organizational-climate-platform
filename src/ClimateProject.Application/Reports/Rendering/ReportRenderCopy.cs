using System.Globalization;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Reports.Rendering;

/// <summary>
/// The chrome of a rendered report, in each locale the product publishes.
/// </summary>
/// <remarks>
/// <para>
/// The same shape as <c>SurveyExportCopy</c>, deliberately: a dictionary of records keyed by
/// <see cref="ContentLanguages.Locales"/>, which is the pattern
/// <c>NotificationEmailComposer.Copy</c> established for server-rendered text. A pair of
/// En/Es properties would put a language into a shape (#195); a resource file would put the
/// product's only Spanish prose somewhere no reviewer of this file reads.
/// </para>
/// <para>
/// <b>Numbers are formatted here, not by a culture.</b> Spanish writes a decimal comma, and
/// <c>CultureInfo.GetCultureInfo("es-CR")</c> would produce one -- on a host with ICU, in the
/// version of ICU that host happens to carry. Replacing the separator explicitly is
/// deterministic, testable, and survives a container built with invariant globalization, which
/// would otherwise silently give a Spanish report English decimal points. Copied from
/// <c>SurveyExportCopy</c> rather than shared with it because the two documents' label sets
/// barely overlap; what is shared is the rule, which is written down in both.
/// </para>
/// <para>
/// This class is <c>internal</c> and reached only through <see cref="ReportRenderer"/>, so the
/// renderer stays the one place that decides which locale a section prints in.
/// </para>
/// </remarks>
internal sealed record ReportRenderCopy(
    string UntitledReport,
    string UntitledSurvey,
    string Type,
    string FormatLabel,
    string GeneratedAt,
    string Scope,
    string Surveys,
    string NoSurveys,
    string Status,
    string PrintedIn,
    string Participation,
    string Invited,
    string Responses,
    string Completed,
    string Partial,
    string ParticipationRate,
    string CompletionRate,
    string FirstResponse,
    string LastResponse,
    string NotAvailable,
    string Withheld,
    string ResultsWithheld,
    string Dimensions,
    string Dimension,
    string QuestionCount,
    string AnsweredCount,
    string AverageScore,
    string QuestionResults,
    string Ordinal,
    string Question,
    string QuestionType,
    string Average,
    string Median,
    string Departments,
    string Department,
    string Respondents,
    string AiInsights,
    string NoAiInsights,
    string Category,
    string Priority,
    string Confidence,
    string RecommendedActions,
    string Acknowledged,
    string Yes,
    string No,
    string Benchmarks,
    string NoBenchmarks,
    string Comparison,
    string NoComparison,
    string IncludedSections,
    string ExcludedSections,
    string SurveysSelected,
    string AllSurveysIncluded,
    string ComparisonWithheld,
    string EarlierSurvey,
    string LaterSurvey,
    string Metric,
    string Value,
    string Unit,
    string Percentile,
    string SampleSize,
    string PriorPeriod,
    string PriorValue,
    string Change,
    string ChangeRatio,
    string PriorPeriodStatus,
    bool DecimalComma)
{
    private static readonly Dictionary<string, ReportRenderCopy> ByLocale = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = new ReportRenderCopy(
            UntitledReport: "Untitled report",
            UntitledSurvey: "Untitled survey",
            Type: "Type",
            FormatLabel: "Format",
            GeneratedAt: "Generated",
            Scope: "Scope of this document",
            Surveys: "Surveys",
            NoSurveys: "This company has no surveys past the draft stage, so the document carries no survey section.",
            Status: "Status",
            PrintedIn: "Printed in",
            Participation: "Participation",
            Invited: "Invited",
            Responses: "Responses",
            Completed: "Completed",
            Partial: "In progress",
            ParticipationRate: "Participation rate",
            CompletionRate: "Completion rate",
            FirstResponse: "First response",
            LastResponse: "Last response",
            NotAvailable: "Not available",
            Withheld: "Withheld",
            ResultsWithheld: "Results withheld",
            Dimensions: "Dimensions",
            Dimension: "Dimension",
            QuestionCount: "Questions",
            AnsweredCount: "Answers",
            AverageScore: "Average",
            QuestionResults: "Results by question",
            Ordinal: "No.",
            Question: "Question",
            QuestionType: "Type",
            Average: "Average",
            Median: "Median",
            Departments: "Participation by department",
            Department: "Department",
            Respondents: "Respondents",
            AiInsights: "Insights",
            NoAiInsights: "No insights are recorded for this company as of the generation time.",
            Category: "Category",
            Priority: "Priority",
            Confidence: "Confidence",
            RecommendedActions: "Recommended actions",
            Acknowledged: "Acknowledged",
            Yes: "Yes",
            No: "No",
            Benchmarks: "Benchmarks",
            NoBenchmarks: "No benchmark is readable for this company.",
            Comparison: "Period-over-period",
            NoComparison: "This company has closed fewer than two surveys, so there is no period to compare against.",
            IncludedSections: "Included",
            ExcludedSections: "Excluded at the author's request",
            SurveysSelected: "Selected surveys only",
            AllSurveysIncluded: "Every survey past the draft stage",
            ComparisonWithheld: "One of the two surveys is below the anonymity floor, so no movement is reported between them.",
            EarlierSurvey: "Earlier survey",
            LaterSurvey: "Later survey",
            Metric: "Metric",
            Value: "Value",
            Unit: "Unit",
            Percentile: "Percentile",
            SampleSize: "Sample",
            PriorPeriod: "Prior period",
            PriorValue: "Prior value",
            Change: "Change",
            ChangeRatio: "Change (%)",
            PriorPeriodStatus: "Prior period",
            DecimalComma: false),

        [ContentLanguages.Spanish] = new ReportRenderCopy(
            UntitledReport: "Informe sin título",
            UntitledSurvey: "Encuesta sin título",
            Type: "Tipo",
            FormatLabel: "Formato",
            GeneratedAt: "Generado",
            Scope: "Alcance de este documento",
            Surveys: "Encuestas",
            NoSurveys: "Esta empresa no tiene encuestas más allá del borrador, por lo que el documento no lleva ninguna sección de encuesta.",
            Status: "Estado",
            PrintedIn: "Impreso en",
            Participation: "Participación",
            Invited: "Convocados",
            Responses: "Respuestas",
            Completed: "Completadas",
            Partial: "En curso",
            ParticipationRate: "Tasa de participación",
            CompletionRate: "Tasa de finalización",
            FirstResponse: "Primera respuesta",
            LastResponse: "Última respuesta",
            NotAvailable: "No disponible",
            Withheld: "Reservado",
            ResultsWithheld: "Resultados reservados",
            Dimensions: "Dimensiones",
            Dimension: "Dimensión",
            QuestionCount: "Preguntas",
            AnsweredCount: "Respuestas",
            AverageScore: "Promedio",
            QuestionResults: "Resultados por pregunta",
            Ordinal: "N.º",
            Question: "Pregunta",
            QuestionType: "Tipo",
            Average: "Promedio",
            Median: "Mediana",
            Departments: "Participación por departamento",
            Department: "Departamento",
            Respondents: "Respondieron",
            AiInsights: "Hallazgos",
            NoAiInsights: "No hay hallazgos registrados para esta empresa al momento de la generación.",
            Category: "Categoría",
            Priority: "Prioridad",
            Confidence: "Confianza",
            RecommendedActions: "Acciones recomendadas",
            Acknowledged: "Atendido",
            Yes: "Sí",
            No: "No",
            Benchmarks: "Referencias",
            NoBenchmarks: "Esta empresa no tiene ninguna referencia visible.",
            Comparison: "Comparación entre periodos",
            NoComparison: "Esta empresa ha cerrado menos de dos encuestas, así que no hay un periodo con el que comparar.",
            IncludedSections: "Incluido",
            ExcludedSections: "Excluido por decisión de quien creó el informe",
            SurveysSelected: "Solo las encuestas seleccionadas",
            AllSurveysIncluded: "Todas las encuestas fuera de borrador",
            ComparisonWithheld: "Una de las dos encuestas está por debajo del umbral de anonimato, así que no se informa ninguna variación entre ellas.",
            EarlierSurvey: "Encuesta anterior",
            LaterSurvey: "Encuesta posterior",
            Metric: "Métrica",
            Value: "Valor",
            Unit: "Unidad",
            Percentile: "Percentil",
            SampleSize: "Muestra",
            PriorPeriod: "Periodo anterior",
            PriorValue: "Valor anterior",
            Change: "Variación",
            ChangeRatio: "Variación (%)",
            PriorPeriodStatus: "Periodo anterior",
            DecimalComma: true),
    };

    public static ReportRenderCopy For(string? locale)
    {
        var normalised = ContentLanguages.NormaliseLocale(locale) ?? ContentLanguages.FallbackLocale;
        return ByLocale.TryGetValue(normalised, out var copy) ? copy : ByLocale[ContentLanguages.FallbackLocale];
    }

    public string Count(int value) => Localise(CsvField.Number(value));

    public string Count(int? value) => value is null ? NotAvailable : Count(value.Value);

    public string Decimal(double? value)
        => value is null
            ? NotAvailable
            : Localise(Math.Round(value.Value, 2).ToString("0.##", CultureInfo.InvariantCulture));

    public string Percent(double? value) => value is null ? NotAvailable : $"{Decimal(value)} %";

    public string Day(DateTimeOffset? value)
        => value is null ? NotAvailable : value.Value.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

    public string Boolean(bool value) => value ? Yes : No;

    /// <summary>
    /// Why a whole survey section carries no results, with the aggregation's own reason code
    /// printed verbatim.
    /// </summary>
    /// <remarks>
    /// The code (<c>below_minimum_respondents</c>) is printed as well as the sentence, and not
    /// instead of it: the sentence is what a director reads, and the code is what lets a
    /// support conversation about "why is this section empty" reach the same conclusion as the
    /// screen without anybody translating back. It is also the one string in this document that
    /// a test can pin to the aggregation's own constant rather than to prose.
    /// </remarks>
    public string SectionWithheld(string? reason, int floor, int completedCount)
        => DecimalComma
            ? $"Esta encuesta tiene {Count(completedCount)} respuestas completas. Por debajo de {floor} no se calcula ningún resultado por pregunta, por dimensión ni por departamento, porque con tan pocas respuestas el resultado equivale a leer lo que contestó cada persona. Motivo registrado: {reason ?? "-"}. Las cifras de participación de arriba sí se muestran, porque un conteo no identifica a nadie."
            : $"This survey has {Count(completedCount)} complete responses. Below {floor} no per-question, per-dimension or per-department result is computed, because with that few responses the result amounts to reading what each person answered. Recorded reason: {reason ?? "-"}. The participation counters above are still shown, because a count identifies nobody.";

    /// <summary>The floor a suppressed department row was withheld under.</summary>
    public string DepartmentWithheldNotice(int floor)
        => DecimalComma
            ? $"Los departamentos marcados «{Withheld}» tienen menos de {floor} personas que respondieron, así que no se muestra ninguna cifra propia. La celda dice «{Withheld}» y no «0»: cero sería una afirmación sobre esas personas que este informe no puede hacer."
            : $"Departments marked \"{Withheld}\" have fewer than {floor} respondents, so no figure of their own is shown. The cell reads \"{Withheld}\" and not \"0\": zero would be a claim about those people this report cannot make.";

    /// <summary>The counters that let a reader balance the department table without naming a withheld group.</summary>
    public string DepartmentsWithheldCounts(int departments, int respondents, int unsegmented, int floor)
        => DecimalComma
            ? $"Departamentos reservados: {Count(departments)} (con {Count(respondents)} personas en total) por tener menos de {floor} personas que respondieron. Respuestas sin departamento: {Count(unsegmented)}."
            : $"Withheld departments: {Count(departments)} (covering {Count(respondents)} people) for having fewer than {floor} respondents. Responses carrying no department: {Count(unsegmented)}.";

    /// <summary>
    /// The same counters for a demographic breakdown, which is NOT a department table.
    /// </summary>
    /// <remarks>
    /// A separate string rather than the department one reused with a different number. Reusing
    /// it printed "Withheld departments: 1 (covering 2 people)" under the heading
    /// "Dimension: nationality" -- a sentence naming the wrong kind of group entirely, which is
    /// worse than an untranslated one because it reads as correct. The word for the group comes
    /// from the aggregation's own dimension key, so it is the reader's own vocabulary rather
    /// than a catalogue's.
    /// </remarks>
    public string SegmentsWithheldCounts(string dimension, int segments, int respondents, int unsegmented, int floor)
        => DecimalComma
            ? $"Grupos reservados en «{dimension}»: {Count(segments)} (con {Count(respondents)} personas en total) por tener menos de {floor} personas que respondieron. Respuestas sin este dato: {Count(unsegmented)}."
            : $"Withheld groups in \"{dimension}\": {Count(segments)} (covering {Count(respondents)} people) for having fewer than {floor} respondents. Responses carrying no value for this: {Count(unsegmented)}.";

    /// <summary>Said once, at the top, so a reader of the file knows what floors produced it.</summary>
    public string PrivacyNotice(int surveyFloor)
        => DecimalComma
            ? $"Confidencialidad: no se calcula ningún resultado por pregunta con menos de {surveyFloor} respuestas completas, y ningún grupo por debajo del mínimo se muestra por separado. Este archivo no contiene respuestas individuales ni texto libre textual."
            : $"Confidentiality: no per-question result is computed below {surveyFloor} complete responses, and no group below the minimum is shown separately. This file contains no individual responses and no verbatim free text.";

    private string Localise(string invariant) => DecimalComma ? invariant.Replace('.', ',') : invariant;
}
