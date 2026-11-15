using System.Globalization;
using ClimateProject.Application.Reports.Rendering;
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
    /// <summary>
    /// The question families, each a quiet tint of its own. Deliberately not green, amber or red:
    /// those mean a result area everywhere else in the product, and a question type is not a result.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, (string Fill, string Ink)> TypeTones = new Dictionary<string, (string, string)>(StringComparer.Ordinal)
    {
        ["likert"] = ("#E8F0FE", "#1A4FB5"),
        ["rating"] = ("#E8F0FE", "#1A4FB5"),
        ["emoji_rating"] = ("#E8F0FE", "#1A4FB5"),
        ["multiple_choice"] = ("#F3E8FF", "#6B21A8"),
        ["yes_no"] = ("#F3E8FF", "#6B21A8"),
        ["ranking"] = ("#F3E8FF", "#6B21A8"),
        ["open_ended"] = ("#E0F2F1", "#0F6B62"),
    };

    /// <summary>The workbook as bytes.</summary>
    public static byte[] Build(IReadOnlyList<QuestionnaireSurvey> surveys, bool spanish, WorkbookBrand? brand = null)
    {
        ArgumentNullException.ThrowIfNull(surveys);
        brand ??= WorkbookBrand.Product();
        var locale = spanish ? "es" : "en";
        var contents = new List<WorkbookCoverSheet>();
        var missing = 0;

        using var book = new XLWorkbook();
        var headers = spanish
            ? new[] { "N.º", "Dimensión", "Tipo", "Obligatoria", "Pregunta (español)", "Pregunta (inglés)", "Escala", "Extremo bajo (español)", "Extremo bajo (inglés)", "Extremo alto (español)", "Extremo alto (inglés)", "Opciones (español)", "Opciones (inglés)" }
            : new[] { "No.", "Dimension", "Type", "Required", "Question (Spanish)", "Question (English)", "Scale", "Low end (Spanish)", "Low end (English)", "High end (Spanish)", "High end (English)", "Options (Spanish)", "Options (English)" };

        for (var s = 0; s < surveys.Count; s++)
        {
            var survey = surveys[s];
            var sheet = book.AddWorksheet(StatusWorkbook.SheetName(survey.Title, s, book));
            sheet.Cell(1, 1).Value = survey.Title;
            sheet.Cell(2, 1).Value = Subtitle(survey, spanish);
            WorkbookStyle.Title(sheet.Cell(1, 1), sheet.Cell(2, 1));

            const int headerRow = 4;
            for (var c = 0; c < headers.Length; c++)
            {
                sheet.Cell(headerRow, c + 1).Value = headers[c];
            }

            WorkbookStyle.Header(sheet.Range(headerRow, 1, headerRow, headers.Length), brand);
            var dimensionBlock = -1;
            string? previousDimension = null;

            var row = headerRow + 1;
            var width = survey.Questions.Count >= 100 ? 3 : 2;
            foreach (var (question, index) in survey.Questions.OrderBy(q => q.Order).Select((q, i) => (q, i)))
            {
                var options = question.Options.OrderBy(o => o.Order).ToList();
                var values = new string?[]
                {
                    "P" + (index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(width, '0'),
                    string.IsNullOrWhiteSpace(question.Category) ? null : DimensionNames.Resolve(question.Category, locale) ?? question.Category,
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

                // Contiguous questions of one dimension share a quiet band on their number and
                // dimension, so the instrument's blocks read without a separate column.
                if (dimensionBlock < 0 || !string.Equals(question.Category, previousDimension, StringComparison.Ordinal))
                {
                    dimensionBlock++;
                    previousDimension = question.Category;
                }

                if (dimensionBlock % 2 == 1)
                {
                    sheet.Range(row, 1, row, 2).Style.Fill.BackgroundColor = XLColor.FromHtml(WorkbookPalette.Quiet);
                }

                if (TypeTones.TryGetValue(question.Type, out var tone))
                {
                    WorkbookStyle.Tone(sheet.Cell(row, 3), tone.Fill, tone.Ink);
                }

                // A text present in one language and missing in the other is a translation that
                // was never written: painted, and still empty.
                foreach (var (spanishColumn, englishColumn) in new[] { (5, 6), (8, 9), (10, 11), (12, 13) })
                {
                    var hasSpanish = !sheet.Cell(row, spanishColumn).IsEmpty();
                    var hasEnglish = !sheet.Cell(row, englishColumn).IsEmpty();
                    if (hasSpanish != hasEnglish)
                    {
                        var gap = sheet.Cell(row, hasSpanish ? englishColumn : spanishColumn);
                        gap.Style.Fill.BackgroundColor = XLColor.FromHtml(WorkbookPalette.OpportunityFill);
                        missing++;
                    }
                }

                // Options print as "value =" when only that label is missing, so the cell is not
                // empty; a label-by-label gap is still a gap.
                if (options.Count > 0 && options.Any(o => string.IsNullOrWhiteSpace(o.LabelEs)) != options.Any(o => string.IsNullOrWhiteSpace(o.LabelEn)))
                {
                    var gap = sheet.Cell(row, options.Any(o => string.IsNullOrWhiteSpace(o.LabelEn)) ? 13 : 12);
                    gap.Style.Fill.BackgroundColor = XLColor.FromHtml(WorkbookPalette.OpportunityFill);
                    missing++;
                }

                row++;
            }

            if (row > headerRow + 1)
            {
                sheet.Range(headerRow, 1, row - 1, headers.Length).SetAutoFilter();
                var body = sheet.Range(headerRow + 1, 1, row - 1, headers.Length);
                WorkbookStyle.Body(body);
                body.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                body.Style.Alignment.WrapText = true;
                sheet.Range(headerRow + 1, 1, row - 1, 1).Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
                sheet.Range(headerRow + 1, 4, row - 1, 4).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                sheet.Range(headerRow + 1, 7, row - 1, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            }

            sheet.Column(1).Width = 7;
            sheet.Column(2).Width = 24;
            sheet.Column(3).Width = 17;
            sheet.Column(4).Width = 12;
            sheet.Columns(5, 6).Width = 58;
            sheet.Column(7).Width = 8;
            sheet.Columns(8, 11).Width = 22;
            sheet.Columns(12, 13).Width = 36;
            WorkbookStyle.Rows(sheet, headerRow, headerRow, 1, headers.Length, WorkbookStyle.HeaderRowHeight);
            WorkbookStyle.Rows(sheet, headerRow + 1, Math.Max(headerRow + 1, row - 1), 1, headers.Length);
            sheet.SheetView.Freeze(headerRow, 1);
            WorkbookStyle.Print(sheet, brand, spanish, headerRow);
            contents.Add(new WorkbookCoverSheet(sheet.Name, Subtitle(survey, spanish) + " · " + WorkbookWords.SurveyStatus(survey.Status, spanish).ToLowerInvariant()));
        }

        if (surveys.Count == 0)
        {
            var empty = book.AddWorksheet(spanish ? "Sin encuestas" : "No surveys");
            empty.Cell(1, 1).Value = spanish ? "No se eligió ninguna encuesta." : "No survey was chosen.";
            contents.Add(new WorkbookCoverSheet(empty.Name, spanish ? "No se eligió ninguna encuesta." : "No survey was chosen."));
        }

        var count = surveys.Count.ToString(CultureInfo.InvariantCulture);
        var questions = surveys.Sum(s => s.Questions.Count).ToString(CultureInfo.InvariantCulture);
        var company = string.IsNullOrWhiteSpace(brand.CompanyName) ? string.Empty : brand.CompanyName + " · ";
        WorkbookCover.Insert(book, brand, new WorkbookCoverContent(
            spanish ? "Cuestionario" : "Questionnaire",
            company + (spanish ? $"{count} encuesta{(surveys.Count == 1 ? string.Empty : "s")} · {questions} preguntas" : $"{count} survey{(surveys.Count == 1 ? string.Empty : "s")} · {questions} questions"),
            spanish ? "Cada pregunta en español y en inglés, con su escala y sus opciones." : "Every question in Spanish and in English, with its scale and options.",
            contents,
            [
                new(TypeTones["likert"].Fill, TypeTones["likert"].Ink, TypeName("likert", spanish),
                    spanish ? "Escalas: de acuerdo, valoración o caritas. Su rango está en «Escala»." : "Scales: agreement, rating or emoji. Their range is in «Scale»."),
                new(TypeTones["multiple_choice"].Fill, TypeTones["multiple_choice"].Ink, TypeName("multiple_choice", spanish),
                    spanish ? "Opciones fijas: opción múltiple, sí o no, ordenar. Las opciones van como «valor = texto»." : "Fixed options: multiple choice, yes or no, ranking. Options read «value = text»."),
                new(TypeTones["open_ended"].Fill, TypeTones["open_ended"].Ink, TypeName("open_ended", spanish),
                    spanish ? "Texto libre." : "Free text."),
                new(WorkbookPalette.OpportunityFill, WorkbookPalette.OpportunityInk, spanish ? "Falta la traducción" : "Translation missing",
                    missing == 0
                        ? (spanish ? "Una celda vacía en un idioma cuando el otro sí tiene texto. Este archivo no tiene ninguna." : "An empty cell in one language where the other has text. This file has none.")
                        : (spanish ? $"Una celda vacía en un idioma cuando el otro sí tiene texto. Este archivo tiene {missing.ToString(CultureInfo.InvariantCulture)}." : $"An empty cell in one language where the other has text. This file has {missing.ToString(CultureInfo.InvariantCulture)}.")),
            ],
            spanish
                ?
                [
                    "Una traducción que falta queda como celda vacía, nunca copiada del otro idioma.",
                    "Las preguntas siguen el orden del instrumento. Las preguntas seguidas de una misma dimensión comparten un tono en su número y su dimensión.",
                ]
                :
                [
                    "A missing translation stays an empty cell, never copied from the other language.",
                    "Questions follow the instrument's order. Consecutive questions of one dimension share a tint on their number and dimension.",
                ]), spanish);

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
