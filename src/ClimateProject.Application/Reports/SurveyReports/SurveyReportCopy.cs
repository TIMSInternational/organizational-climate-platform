using System.Globalization;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Reports.SurveyReports;

/// <summary>
/// Every word the survey report prints that is not the client's own content, in Spanish and
/// English. Numbers are formatted here too, invariant and then localised, for the reason
/// <c>ReportRenderCopy</c> gives: a culture lookup prints differently on a host with and
/// without ICU, and a report must not change its decimal separator with the container.
/// </summary>
public sealed record SurveyReportCopy(
    bool Spanish,
    string ProductName,
    string PageLabelFormat,
    string UntitledSurvey,
    string UnnamedDepartment,
    string DepartmentVariable,
    string ReportKind,
    string Departments,
    string AllDepartments,
    string Crosses,
    string ComparedWith,
    string OverallMean,
    string Participation,
    string StrengthsKpi,
    string OpportunitiesKpi,
    string CriticalKpi,
    string NoneCritical,
    string Of,
    string ResponsesOf,
    string Responses,
    string NoInvitedCount,
    string Rises,
    string Falls,
    string NoChange,
    string DimensionsTitle,
    string DimensionsSubtitle,
    string DimensionsSubtitleNoDepartments,
    string RangeFromTo,
    string BeforeToNow,
    string BandFrom,
    string BandUnder,
    string Highest,
    string Lowest,
    string MapTitle,
    string MapSubtitle,
    string MapOmitted,
    string MapSingleFloor,
    string NoDepartments,
    string CrossTitleFormat,
    string CrossSubtitle,
    string SingleVariableTitleFormat,
    string SingleVariableSubtitle,
    string Protected,
    string ProtectedExplanation,
    string ProtectedNoNumber,
    string WholeRow,
    string People,
    string Person,
    string NoCrossValues,
    string QuestionsTitle,
    string QuestionsSubtitle,
    string AnsweredBy,
    string NoDimension,
    string AverageRank,
    string HighlightsTitle,
    string HighlightsSubtitle,
    string TopFive,
    string BottomFive,
    string ComparisonTitle,
    string ComparisonSubtitle,
    string ComparisonNoMatch,
    string ComparisonSuppressed,
    string ComparisonUnmatched,
    string ComparisonNotAsked,
    string CommentsTitle,
    string CommentsSubtitle,
    string CommentsPeopleWrote,
    string CommentsNoWords,
    string CommentsSuppressedWords,
    string CommentsNeverText,
    string NoOpenQuestions,
    string SuppressedTitle,
    string SuppressedBody,
    string PrivacyNote,
    string GeneratedOn,
    string ScaleMean,
    string ScalePercent,
    IReadOnlyList<string> Months)
{
    /// <summary>The Spanish report.</summary>
    public static readonly SurveyReportCopy Es = new(
        Spanish: true,
        ProductName: "Clima",
        PageLabelFormat: "Página {0} de {1}",
        UntitledSurvey: "Encuesta sin título",
        UnnamedDepartment: "Departamento sin nombre",
        DepartmentVariable: "Departamento",
        ReportKind: "Informe de resultados",
        Departments: "departamentos",
        AllDepartments: "todos los departamentos",
        Crosses: "cruces",
        ComparedWith: "comparado con",
        OverallMean: "Media general",
        Participation: "Participación",
        StrengthsKpi: "Fortalezas",
        OpportunitiesKpi: "Oportunidades",
        CriticalKpi: "Críticas",
        NoneCritical: "Ninguna dimensión crítica",
        Of: "de",
        ResponsesOf: "{0} de {1} personas",
        Responses: "{0} respuestas",
        NoInvitedCount: "sin total de invitados",
        Rises: "sube",
        Falls: "baja",
        NoChange: "igual",
        DimensionsTitle: "Clima por dimensión",
        DimensionsSubtitle: "La barra va del departamento más bajo al más alto; el punto es la media de la organización.",
        DimensionsSubtitleNoDepartments: "El punto es la media de la organización en cada dimensión.",
        RangeFromTo: "de {0} a {1}",
        BeforeToNow: "de {0} a {1}",
        BandFrom: "desde {0}",
        BandUnder: "menos de {0}",
        Highest: "Lo más alto",
        Lowest: "Lo más bajo",
        MapTitle: "Mapa de clima",
        MapSubtitle: "Media de cada departamento en cada dimensión. El número junto al nombre es cuántas personas respondieron.",
        MapOmitted: "{0} departamentos con respuestas no están en este informe: se dejaron fuera al generarlo.",
        MapSingleFloor: "Un departamento se muestra a la administración desde 1 respuesta (decisión del cliente, 15 oct 2026).",
        NoDepartments: "Ninguna respuesta tiene departamento, así que no hay mapa que dibujar.",
        CrossTitleFormat: "{0} × {1}",
        CrossSubtitle: "Media general de cada grupo. Cada celda necesita 3 personas; las que no llegan, o que dejarían deducir otra restando, se imprimen protegidas.",
        SingleVariableTitleFormat: "{0}",
        SingleVariableSubtitle: "Media general de cada grupo y cuántas personas respondieron. Una sola variable se muestra a la administración desde 1 respuesta.",
        Protected: "Protegida",
        ProtectedExplanation: "Protegida quiere decir una de tres cosas, y el informe no dice cuál: el grupo tiene menos de 3 personas; o tiene 3 o más, pero con los totales y las otras celdas se podría despejar un grupo de menos de 3; o nadie de ese grupo respondió.",
        ProtectedNoNumber: "No se imprime su media ni cuántas personas son.",
        WholeRow: "Total",
        People: "personas",
        Person: "persona",
        NoCrossValues: "Esta variable no tiene valores en las respuestas de la encuesta.",
        QuestionsTitle: "Resultados por pregunta",
        QuestionsSubtitle: "Cómo se repartieron las respuestas. A la derecha, la media de la pregunta. Los tramos de menos del nueve por ciento no llevan su porcentaje escrito.",
        AnsweredBy: "{0} respuestas",
        NoDimension: "Sin dimensión",
        AverageRank: "posición media {0}",
        HighlightsTitle: "Fortalezas y oportunidades",
        HighlightsSubtitle: "Las preguntas de escala con la media más alta y la más baja.",
        TopFive: "Las 5 más altas",
        BottomFive: "Las 5 más bajas",
        ComparisonTitle: "Comparación con {0}",
        ComparisonSubtitle: "Diferencia de la media por dimensión. Azul: subió; gris: bajó. La línea central es el mismo valor que antes.",
        ComparisonNoMatch: "Las dos encuestas no comparten ninguna dimensión, así que no hay nada que comparar.",
        ComparisonSuppressed: "La encuesta anterior tiene menos de 3 respuestas completas: no tiene resultados con los que comparar.",
        ComparisonUnmatched: "{0} dimensiones están en una sola de las dos encuestas y no entran en la comparación.",
        ComparisonNotAsked: "No se eligió una encuesta con la que comparar.",
        CommentsTitle: "Comentarios: palabras más frecuentes",
        CommentsSubtitle: "Cuántas personas usaron cada palabra. Una palabra que usó una sola persona no aparece.",
        CommentsPeopleWrote: "{0} personas escribieron algo",
        CommentsNoWords: "Ninguna palabra la usaron 2 personas o más.",
        CommentsSuppressedWords: "{0} palabras que usó una sola persona no se muestran.",
        CommentsNeverText: "El texto de los comentarios nunca sale en este informe. Se cuentan las palabras, no las frases.",
        NoOpenQuestions: "La encuesta no tiene preguntas abiertas.",
        SuppressedTitle: "Todavía no hay resultados que mostrar",
        SuppressedBody: "La encuesta tiene menos de 3 respuestas completas. Hasta llegar a 3, el informe solo muestra la participación: con menos, una media sería la respuesta de una o dos personas.",
        PrivacyNote: "Ningún grupo de menos de 3 personas en un cruce muestra un número, y ninguno se puede despejar restando. Este archivo no contiene respuestas individuales ni comentarios textuales.",
        GeneratedOn: "Generado el {0}",
        ScaleMean: "Media de 1 a 5",
        ScalePercent: "Porcentaje de 0 a 100",
        Months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]);

    /// <summary>The English report.</summary>
    public static readonly SurveyReportCopy En = new(
        Spanish: false,
        ProductName: "Clima",
        PageLabelFormat: "Page {0} of {1}",
        UntitledSurvey: "Untitled survey",
        UnnamedDepartment: "Unnamed department",
        DepartmentVariable: "Department",
        ReportKind: "Results report",
        Departments: "departments",
        AllDepartments: "every department",
        Crosses: "crosses",
        ComparedWith: "compared with",
        OverallMean: "Overall mean",
        Participation: "Participation",
        StrengthsKpi: "Strengths",
        OpportunitiesKpi: "Opportunities",
        CriticalKpi: "Critical",
        NoneCritical: "No critical dimension",
        Of: "of",
        ResponsesOf: "{0} of {1} people",
        Responses: "{0} responses",
        NoInvitedCount: "no invited total",
        Rises: "up",
        Falls: "down",
        NoChange: "unchanged",
        DimensionsTitle: "Climate by dimension",
        DimensionsSubtitle: "The bar runs from the lowest department to the highest; the dot is the organisation's mean.",
        DimensionsSubtitleNoDepartments: "The dot is the organisation's mean in each dimension.",
        RangeFromTo: "from {0} to {1}",
        BeforeToNow: "from {0} to {1}",
        BandFrom: "from {0}",
        BandUnder: "under {0}",
        Highest: "Highest",
        Lowest: "Lowest",
        MapTitle: "Climate map",
        MapSubtitle: "Each department's mean in each dimension. The number beside the name is how many people answered.",
        MapOmitted: "{0} departments with responses are not in this report: they were left out when it was generated.",
        MapSingleFloor: "A department is shown to administrators from 1 response (client ruling, 15 Oct 2026).",
        NoDepartments: "No response carries a department, so there is no map to draw.",
        CrossTitleFormat: "{0} × {1}",
        CrossSubtitle: "Each group's overall mean. Every cell needs 3 people; cells that do not reach it, or that would let another be worked out by subtraction, print as protected.",
        SingleVariableTitleFormat: "{0}",
        SingleVariableSubtitle: "Each group's overall mean and how many people answered. A single variable is shown to administrators from 1 response.",
        Protected: "Protected",
        ProtectedExplanation: "Protected means one of three things, and the report does not say which: the group has fewer than 3 people; or it has 3 or more, but the totals and the other cells would let a group of fewer than 3 be worked out; or nobody in that group answered.",
        ProtectedNoNumber: "Neither its mean nor its size is printed.",
        WholeRow: "Total",
        People: "people",
        Person: "person",
        NoCrossValues: "This variable has no values in the survey's responses.",
        QuestionsTitle: "Results by question",
        QuestionsSubtitle: "How the answers were spread. On the right, the question's mean. Segments under nine per cent carry no percentage.",
        AnsweredBy: "{0} responses",
        NoDimension: "No dimension",
        AverageRank: "average position {0}",
        HighlightsTitle: "Strengths and opportunities",
        HighlightsSubtitle: "The scale questions with the highest and the lowest mean.",
        TopFive: "The 5 highest",
        BottomFive: "The 5 lowest",
        ComparisonTitle: "Comparison with {0}",
        ComparisonSubtitle: "The change in each dimension's mean. Blue: up; grey: down. The centre line is the same value as before.",
        ComparisonNoMatch: "The two surveys share no dimension, so there is nothing to compare.",
        ComparisonSuppressed: "The earlier survey has fewer than 3 complete responses: it has no results to compare with.",
        ComparisonUnmatched: "{0} dimensions are in only one of the two surveys and are left out of the comparison.",
        ComparisonNotAsked: "No survey was chosen to compare with.",
        CommentsTitle: "Comments: most frequent words",
        CommentsSubtitle: "How many people used each word. A word only one person used is not shown.",
        CommentsPeopleWrote: "{0} people wrote something",
        CommentsNoWords: "No word was used by 2 people or more.",
        CommentsSuppressedWords: "{0} words only one person used are not shown.",
        CommentsNeverText: "The text of the comments is never in this report. Words are counted, not sentences.",
        NoOpenQuestions: "The survey has no open questions.",
        SuppressedTitle: "No results to show yet",
        SuppressedBody: "The survey has fewer than 3 complete responses. Until it reaches 3, the report shows participation only: with fewer, a mean would be one or two people's answers.",
        PrivacyNote: "No group of fewer than 3 people in a cross shows a number, and none can be worked out by subtraction. This file contains no individual answers and no comment text.",
        GeneratedOn: "Generated on {0}",
        ScaleMean: "Mean from 1 to 5",
        ScalePercent: "Percentage from 0 to 100",
        Months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

    /// <summary>The copy for a locale; anything not Spanish reads English.</summary>
    public static SurveyReportCopy For(string? locale)
        => ContentLanguages.NormaliseLocale(locale) == "es" ? Es : En;

    /// <summary>The product's own names for the three areas, used where the company kept the defaults.</summary>
    public (string Critical, string Opportunity, string Strength) DefaultBandNames
        => Spanish ? ("Crítica", "Oportunidad", "Fortaleza") : ("Critical", "Opportunity", "Strength");

    /// <summary>A reading, in the company's scale: «3,70» on the mean, «74» on 0-100.</summary>
    public string Score(double mean, ScoreScale scale)
        => Localise(scale == ScoreScale.Percent
            ? scale.Display(mean)
            : Math.Round(mean, 2, MidpointRounding.AwayFromZero).ToString("0.00", CultureInfo.InvariantCulture));

    /// <summary>A signed change between two readings, in the company's scale: «+0,09», «−0,05».</summary>
    public string Delta(double delta, ScoreScale scale)
    {
        var magnitude = Math.Abs(delta);
        var text = scale == ScoreScale.Percent
            ? Math.Round(magnitude * (double)ScoreScales.PercentFactor, 1, MidpointRounding.AwayFromZero).ToString("0.#", CultureInfo.InvariantCulture)
            : Math.Round(magnitude, 2, MidpointRounding.AwayFromZero).ToString("0.00", CultureInfo.InvariantCulture);
        // An en dash for the minus: U+2212 has no WinAnsi code and would print as '?', while
        // the en dash (0x96) is the sign Spanish typesetting uses for it anyway.
        var sign = Math.Round(magnitude, 2) == 0 ? string.Empty : delta > 0 ? "+" : "–";
        return sign + Localise(text);
    }

    /// <summary>A percentage with one decimal: «84,8 %».</summary>
    public string Percent(double value)
        => $"{Localise(Math.Round(value, 1, MidpointRounding.AwayFromZero).ToString("0.#", CultureInfo.InvariantCulture))} %";

    /// <summary>A count with the thousands separator the locale uses: «1.204» or «1,204».</summary>
    public string Count(int value)
    {
        var text = value.ToString("#,0", CultureInfo.InvariantCulture);
        return Spanish ? text.Replace(',', '.') : text;
    }

    /// <summary>«14 nov 2026» / «14 Nov 2026».</summary>
    public string Date(DateTimeOffset value)
        => $"{value.Day.ToString(CultureInfo.InvariantCulture)} {Months[value.Month - 1]} {value.Year.ToString(CultureInfo.InvariantCulture)}";

    /// <summary>«1 persona» / «12 personas».</summary>
    public string PeopleCount(int value) => $"{Count(value)} {(value == 1 ? Person : People)}";

    private string Localise(string invariant) => Spanish ? invariant.Replace('.', ',') : invariant;
}
