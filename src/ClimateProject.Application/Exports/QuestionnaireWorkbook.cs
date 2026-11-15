using System.Globalization;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One answer option of a questionnaire question, in both languages.</summary>
public sealed record QuestionnaireOption(int Order, string Value, string? LabelEs, string? LabelEn);

/// <summary>One question as authored: both languages, never resolved to one.</summary>
public sealed record QuestionnaireQuestion(
    int Order,
    string Type,
    string? Category,
    bool Required,
    string? TextEs,
    string? TextEn,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMinEs,
    string? ScaleLabelMinEn,
    string? ScaleLabelMaxEs,
    string? ScaleLabelMaxEn,
    IReadOnlyList<QuestionnaireOption> Options);

/// <summary>One survey's questionnaire.</summary>
public sealed record QuestionnaireSurvey(
    string Title,
    string Status,
    DateTimeOffset? StartDate,
    DateTimeOffset? EndDate,
    IReadOnlyList<QuestionnaireQuestion> Questions);

/// <summary>
/// The «Cuestionario» workbook of the download wizard: every question of every chosen survey,
/// as authored, one sheet per survey.
///
/// ## Both languages, always
///
/// Unlike every results file, this one never resolves a text into one language: it is the
/// instrument, and the point of downloading it is to see what each person was asked in the
/// language they answered in. A blank English column is itself the finding -- an untranslated
/// question -- so it is left blank, never filled from the Spanish.
///
/// ## Nothing anyone answered
///
/// Questions and their options only. No counts, no responses, no participation: a
/// questionnaire is the same document before the first answer and after the last.
/// </summary>
public static class QuestionnaireWorkbook
{
    private const string HeaderFill = "#E1E0D9";

    /// <summary>The workbook as bytes.</summary>
    public static byte[] Build(IReadOnlyList<QuestionnaireSurvey> surveys, bool spanish)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        var headers = spanish
            ? new[] { "N.º", "Dimensión", "Tipo", "Obligatoria", "Pregunta (español)", "Pregunta (inglés)", "Escala", "Extremo bajo (español)", "Extremo bajo (inglés)", "Extremo alto (español)", "Extremo alto (inglés)", "Opciones (español)", "Opciones (inglés)" }
            : new[] { "No.", "Dimension", "Type", "Required", "Question (Spanish)", "Question (English)", "Scale", "Low end (Spanish)", "Low end (English)", "High end (Spanish)", "High end (English)", "Options (Spanish)", "Options (English)" };

        for (var s = 0; s < surveys.Count; s++)
        {
            var survey = surveys[s];
            var sheet = book.AddWorksheet(StatusWorkbook.SheetName(survey.Title, s, book));
            sheet.Cell(1, 1).Value = survey.Title;
            sheet.Cell(1, 1).Style.Font.Bold = true;
            sheet.Cell(1, 1).Style.Font.FontSize = 14;
            sheet.Cell(2, 1).Value = Subtitle(survey, spanish);
            sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

            const int headerRow = 4;
            for (var c = 0; c < headers.Length; c++)
            {
                var cell = sheet.Cell(headerRow, c + 1);
                cell.Value = headers[c];
                cell.Style.Font.Bold = true;
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml(HeaderFill);
            }

            var row = headerRow + 1;
            var width = survey.Questions.Count >= 100 ? 3 : 2;
            foreach (var (question, index) in survey.Questions.OrderBy(q => q.Order).Select((q, i) => (q, i)))
            {
                var options = question.Options.OrderBy(o => o.Order).ToList();
                var values = new string?[]
                {
                    "P" + (index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(width, '0'),
                    question.Category,
                    TypeName(question.Type, spanish),
                    question.Required ? (spanish ? "Sí" : "Yes") : (spanish ? "No" : "No"),
                    question.TextEs,
                    question.TextEn,
                    question.ScaleMin is { } min && question.ScaleMax is { } max
                        ? $"{min.ToString(CultureInfo.InvariantCulture)}–{max.ToString(CultureInfo.InvariantCulture)}"
                        : null,
                    question.ScaleLabelMinEs,
                    question.ScaleLabelMinEn,
                    question.ScaleLabelMaxEs,
                    question.ScaleLabelMaxEn,
                    options.Count == 0 ? null : string.Join("\n", options.Select(o => OptionLine(o, o.LabelEs))),
                    options.Count == 0 ? null : string.Join("\n", options.Select(o => OptionLine(o, o.LabelEn))),
                };

                for (var c = 0; c < values.Length; c++)
                {
                    // A blank stays an EMPTY cell: "not translated" must not read as a translation
                    // that happens to be empty.
                    if (!string.IsNullOrEmpty(values[c]))
                    {
                        sheet.Cell(row, c + 1).Value = values[c];
                    }
                }

                row++;
            }

            if (row > headerRow + 1)
            {
                sheet.Range(headerRow, 1, row - 1, headers.Length).SetAutoFilter();
                sheet.Range(headerRow + 1, 1, row - 1, headers.Length).Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                sheet.Range(headerRow + 1, 1, row - 1, headers.Length).Style.Alignment.WrapText = true;
            }

            sheet.Column(1).Width = 7;
            sheet.Column(2).Width = 22;
            sheet.Column(3).Width = 18;
            sheet.Column(4).Width = 11;
            sheet.Columns(5, 6).Width = 60;
            sheet.Column(7).Width = 8;
            sheet.Columns(8, 11).Width = 22;
            sheet.Columns(12, 13).Width = 36;
            sheet.SheetView.Freeze(headerRow, 1);
        }

        if (surveys.Count == 0)
        {
            var empty = book.AddWorksheet(spanish ? "Sin encuestas" : "No surveys");
            empty.Cell(1, 1).Value = spanish ? "No se eligió ninguna encuesta." : "No survey was chosen.";
        }

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static string OptionLine(QuestionnaireOption option, string? label)
        => string.IsNullOrWhiteSpace(label) ? $"{option.Value} =" : $"{option.Value} = {label}";

    private static string Subtitle(QuestionnaireSurvey survey, bool spanish)
    {
        var parts = new List<string> { $"{survey.Questions.Count.ToString(CultureInfo.InvariantCulture)} {(spanish ? "preguntas" : "questions")}" };
        if (survey.StartDate is { } start)
        {
            var end = survey.EndDate is { } e ? e.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "…";
            parts.Add($"{start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} – {end}");
        }

        return string.Join(" · ", parts);
    }

    /// <summary>The name the editor's «Tipo de pregunta» uses for a stored type.</summary>
    internal static string TypeName(string type, bool spanish) => type switch
    {
        "likert" or "rating" => spanish ? "Escala" : "Scale",
        "multiple_choice" => spanish ? "Opción múltiple" : "Multiple choice",
        "open_ended" => spanish ? "Respuesta abierta" : "Open answer",
        "yes_no" => spanish ? "Sí / No" : "Yes / No",
        "ranking" => spanish ? "Ordenar" : "Ranking",
        "emoji_rating" => spanish ? "Caritas" : "Emoji scale",
        _ => type,
    };
}
