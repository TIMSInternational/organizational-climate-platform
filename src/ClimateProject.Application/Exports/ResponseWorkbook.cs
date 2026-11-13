using System.Globalization;
using ClimateProject.Application.Questions;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One question, as a column of the export.</summary>
/// <param name="Code">The short column header, <c>P01</c>…, so a 40-question sheet stays analysable.</param>
/// <param name="ScaleMin">
/// The scale's own ends, when it has them. They decide how an answer is coloured: a 4 is the
/// favourable end of a 1–5 scale and the middle of a 1–7 one, so a colour taken from the value
/// alone would say something the scale does not.
/// </param>
public sealed record ResponseExportQuestion(
    Guid Id, int Order, string Code, string? Category, string Type, string Text,
    int? ScaleMin = null, int? ScaleMax = null);

/// <summary>
/// One demographic column: the stored field key, and the header a reader sees.
/// </summary>
/// <param name="Header">
/// The company's own label for the field in the survey's language ("Antigüedad"), never the key
/// (<c>antiguedad</c>) unless the field has no label at all.
/// </param>
public sealed record ResponseExportDemographicColumn(string Field, string Header);

/// <param name="Value">
/// The stored <c>response_value</c>, already decoded out of its JSON envelope by the caller.
/// </param>
/// <param name="Text">The free-text answer or the comment beside a scale answer.</param>
public sealed record ResponseExportAnswer(Guid QuestionId, string? Value, string? Text);

/// <param name="PersonName">
/// Null on an anonymous survey, and not because it was omitted: <c>responses.user_id</c> is
/// never written for one, so there is no row to read a name from. The sheet then carries no
/// identity columns at all rather than a column of blanks, which would read as missing data.
/// </param>
public sealed record ResponseExportRow(
    Guid ResponseId,
    string? PersonName,
    string? PersonEmail,
    string? Username,
    string? Department,
    IReadOnlyDictionary<string, string> Demographics,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    bool IsComplete,
    int? TotalSeconds,
    IReadOnlyList<ResponseExportAnswer> Answers);

/// <summary>
/// One invited person who has not finished, as the PENDIENTES sheet prints them.
/// </summary>
/// <param name="Status">
/// The roster's own vocabulary — <c>started</c>, <c>not_started</c>, <c>not_completed</c> —
/// not a second one invented here. The distinction is the point: somebody who never opened it
/// needs their sign-in details again, somebody who stopped half way already has them.
/// </param>
public sealed record ResponseExportPending(
    string Name, string Email, string? Username, string Status, DateOnly? LastActivityOn);

public sealed record ResponseExportSurvey(
    Guid Id,
    string CompanyName,
    string Title,
    string Status,
    bool Anonymous,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    IReadOnlyList<ResponseExportQuestion> Questions,
    IReadOnlyList<ResponseExportRow> Rows,
    IReadOnlyList<ResponseExportPending> Pending,
    IReadOnlyList<ResponseExportDemographicColumn>? DemographicColumns = null);

/// <summary>
/// The whole-platform response export: one row per response, one column per question, as the
/// workbook TIMS analyses rather than the aggregate the product reports.
///
/// ## What each sheet may contain is decided by the survey, not by this writer
///
/// An identified survey carries name, email and usuario. An anonymous one carries none of
/// them — <c>SurveyResponseEndpoints.StoredUserId</c> returns null the moment
/// <c>Settings.Anonymous</c> is true, so the link was never written and cannot be recovered
/// here or anywhere else. The two shapes are deliberately different: a sheet with an empty
/// "nombre" column invites someone to go looking for the missing data, and there is none.
///
/// The same asymmetry applies to the department and to demographics. On an anonymous survey
/// <c>SurveyResponsePrivacy</c> strips any value whose cohort is under the floor at WRITE
/// time, so those cells are blank in the database for good. <c>RESUMEN</c> says so per survey
/// rather than leaving a reader to infer it from gaps.
///
/// ## Why short column codes and a separate question sheet
///
/// Forty questions of full Spanish text make a sheet nobody can pivot. The data sheets use
/// <c>P01</c>…<c>Pnn</c> in <c>Order</c>, and <c>PREGUNTAS</c> maps every code back to its
/// dimension and wording for the survey it belongs to. A scale answer is written as a NUMBER,
/// so AVERAGE and a pivot work without the reader re-typing the column first.
///
/// ## Readable without a key (2026-11-02)
///
/// The first version printed what the database stores: <c>de_1_ano_a_3_anos</c>, a department's
/// GUID, a field key as the header. Every workbook TIMS delivered from it went through a script
/// on a developer's machine to become readable, which defeats a button. The caller now passes
/// the company's own labels (<see cref="ResponseExportSurvey.DemographicColumns"/> and labelled
/// values); this writer prints whatever it is given and never invents a label.
///
/// The formatting carries the same reading the Eagle delivery did, as styles rather than as a
/// second layout, so row 1 is still the one header row a pivot needs:
/// <list type="bullet">
/// <item>each question header is banded by dimension — ONE hue in two alternating steps, since
/// ten hues is a rainbow and the band only has to separate neighbours — and carries the
/// dimension and the full wording as a note;</item>
/// <item>a scale answer is coloured by where it sits on ITS scale, as conditional formats over
/// the column rather than a style per cell, which would not survive 50,000 rows inside App
/// Runner's 120 seconds. Diverging, because the middle of an agreement scale is neutral: two
/// poles, a grey midpoint, blue for the favourable end and red for the other — never red/green,
/// the colour-blindness failure;</item>
/// <item>identity, demographics and timing are frozen beside the answers, and the header row
/// carries a filter.</item>
/// </list>
///
/// <c>includeAnswers: false</c> writes the same rows with no answer column and no PREGUNTAS sheet:
/// the list a client asks for to check the demographics before anyone analyses anything.
/// </summary>
public static class ResponseWorkbook
{
    /// <summary>Excel's own limit on a sheet name, and the characters it refuses in one.</summary>
    private const int MaxSheetNameLength = 31;

    private static readonly char[] ForbiddenInSheetName = [':', '\\', '/', '?', '*', '[', ']'];

    /// <summary>
    /// The five steps of a diverging scale, unfavourable to favourable. The two arms are
    /// luminance-matched (the red tints were solved to the blue steps' luminance) so neither side
    /// shouts louder, and every fill clears 11:1 against black digits. Carried over unchanged from
    /// the workbook Eagle received on 26 Oct, so a TIMS analyst sees the same colours twice.
    /// </summary>
    public static readonly string[] ScaleFills = ["EDB4B4", "F6D9D9", "F0EFEC", "CDE2FB", "9EC5F4"];

    /// <summary>One hue in two steps, alternating between neighbouring dimensions.</summary>
    public static readonly string[] DimensionBands = ["1C5CAB", "0D366B"];

    /// <summary>The header fill for every column that is not a question.</summary>
    public const string NeutralHeaderFill = "E1E0D9";

    /// <param name="truncation">
    /// Said out loud when a ceiling was reached, because a workbook that is quietly missing the
    /// older half of the platform is one somebody will analyse as if it were complete.
    /// </param>
    /// <param name="includeAnswers">
    /// False for the demographics-only list: every row and every demographic, no answer at all.
    /// </param>
    public static byte[] Build(
        IReadOnlyList<ResponseExportSurvey> surveys,
        DateTimeOffset generatedAt,
        string? truncation = null,
        bool includeAnswers = true)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        var summary = book.AddWorksheet("RESUMEN");
        // No question sheet in a file that carries no answers: a code index for columns that
        // are not there would only send the reader looking for them.
        var questions = includeAnswers ? book.AddWorksheet("PREGUNTAS") : null;

        // The sheet the morning and afternoon status mail is written from: everybody who was
        // invited and has not finished, across every climate in the file, in one list rather
        // than one per tab. It is the roster's own derivation, not a second guess at it.
        var pending = book.AddWorksheet("PENDIENTES");
        Header(pending, ["Hoja", "Empresa", "Clima", "Nombre", "Correo", "Usuario", "Estado", "Última actividad"]);
        var pendingRow = 2;

        // "Abre"/"Cierra" are the climate's own window and "Última respuesta" is the latest row
        // in the sheet: together they say whether a workbook downloaded today is a picture of a
        // finished measurement or of one still being answered. A file with no dates on it gets
        // analysed a week later as if it were complete.
        Header(summary, [
            "Hoja", "Empresa", "Clima", "Estado", "Modo", "Abre", "Cierra",
            "Respuestas", "Completas", "Pendientes", "Última respuesta", "Preguntas", "Identidad",
        ]);
        if (questions is not null)
        {
            Header(questions, ["Hoja", "Código", "Dimensión", "Tipo", "Pregunta"]);
        }

        var summaryRow = 2;
        var questionRow = 2;
        var surveySheets = new List<(IXLWorksheet Sheet, SurveySheetLayout Layout)>(surveys.Count);

        for (var i = 0; i < surveys.Count; i++)
        {
            var survey = surveys[i];
            var sheetCode = "R" + (i + 1).ToString("00", CultureInfo.InvariantCulture);
            var sheet = book.AddWorksheet(SheetName(sheetCode, survey.Title, book));

            summary.Cell(summaryRow, 1).Value = sheetCode;
            summary.Cell(summaryRow, 2).Value = survey.CompanyName;
            summary.Cell(summaryRow, 3).Value = survey.Title;
            summary.Cell(summaryRow, 4).Value = survey.Status;
            summary.Cell(summaryRow, 5).Value = survey.Anonymous ? "Anónima" : "Identificada";
            summary.Cell(summaryRow, 6).Value = survey.StartDate.UtcDateTime;
            summary.Cell(summaryRow, 7).Value = survey.EndDate.UtcDateTime;
            summary.Cell(summaryRow, 8).Value = survey.Rows.Count;
            summary.Cell(summaryRow, 9).Value = survey.Rows.Count(r => r.IsComplete);
            summary.Cell(summaryRow, 10).Value = survey.Pending.Count;
            var latest = survey.Rows
                .Select(r => r.CompletedAt ?? r.StartedAt)
                .DefaultIfEmpty()
                .Max();
            if (latest != default)
            {
                summary.Cell(summaryRow, 11).Value = latest.UtcDateTime;
            }

            summary.Cell(summaryRow, 12).Value = survey.Questions.Count;
            summary.Cell(summaryRow, 13).Value = survey.Anonymous
                ? "Sin identidad: esta encuesta se respondió de forma anónima y no se guardó quién respondió cada fila."
                : "Nombre, correo y usuario por fila.";
            summaryRow++;

            foreach (var question in questions is null ? [] : survey.Questions)
            {
                questions!.Cell(questionRow, 1).Value = sheetCode;
                questions.Cell(questionRow, 2).Value = question.Code;
                questions.Cell(questionRow, 3).Value = question.Category ?? "";
                questions.Cell(questionRow, 4).Value = question.Type;
                questions.Cell(questionRow, 5).Value = question.Text;
                questionRow++;
            }

            foreach (var person in survey.Pending)
            {
                pending.Cell(pendingRow, 1).SetValue(sheetCode);
                pending.Cell(pendingRow, 2).SetValue(survey.CompanyName);
                pending.Cell(pendingRow, 3).SetValue(survey.Title);
                pending.Cell(pendingRow, 4).SetValue(person.Name);
                pending.Cell(pendingRow, 5).SetValue(person.Email);
                pending.Cell(pendingRow, 6).SetValue(person.Username ?? "");
                pending.Cell(pendingRow, 7).SetValue(person.Status);
                if (person.LastActivityOn is { } day)
                {
                    pending.Cell(pendingRow, 8).Value = day.ToDateTime(TimeOnly.MinValue);
                }

                pendingRow++;
            }

            surveySheets.Add((sheet, WriteSurveySheet(sheet, survey, includeAnswers)));
        }

        summary.Cell(summaryRow + 1, 1).Value = "Generado";
        summary.Cell(summaryRow + 1, 2).Value = generatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture);
        var noteRow = summaryRow + 2;
        if (!string.IsNullOrWhiteSpace(truncation))
        {
            summary.Cell(noteRow, 1).SetValue("Incompleto");
            summary.Cell(noteRow, 2).SetValue(truncation);
            summary.Cell(noteRow, 1).Style.Font.Bold = true;
            noteRow++;
        }

        if (!includeAnswers)
        {
            // Said in the file: a list that circulates without its answers must not be taken
            // for an export that lost them.
            summary.Cell(noteRow, 1).SetValue("Contenido");
            summary.Cell(noteRow, 2).SetValue(
                "Solo demográficos: una fila por respuesta, sin las respuestas a las preguntas.");
            summary.Cell(noteRow, 1).Style.Font.Bold = true;
        }

        foreach (var sheet in book.Worksheets)
        {
            sheet.SheetView.FreezeRows(1);
            sheet.Columns().AdjustToContents(1, 40, 8d, 60d);
        }

        // After the generic pass, which would otherwise widen every P01 column back to its
        // contents and leave the identity block scrolling away with the answers.
        foreach (var (sheet, layout) in surveySheets)
        {
            Finish(sheet, layout);
        }

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    /// <summary>Where a survey sheet's blocks start and end, for the finishing pass.</summary>
    /// <param name="FixedColumns">Identity, demographics and timing: frozen beside the answers.</param>
    /// <param name="QuestionColumns">Each question's answer column and the question itself.</param>
    private sealed record SurveySheetLayout(
        int FixedColumns,
        int DemographicFirst,
        int DemographicLast,
        int LastColumn,
        int LastRow,
        IReadOnlyList<(int Column, ResponseExportQuestion Question)> QuestionColumns);

    /// <summary>
    /// The demographic columns of one sheet. The caller's labelled list when it gave one; the
    /// stored keys otherwise, so a caller that has no labels still gets every value rather than
    /// none. Either way only fields some row actually carries: an anonymous survey's rows may
    /// legitimately be missing a field the company defines, and an empty column reads as data
    /// that went missing.
    /// </summary>
    private static List<ResponseExportDemographicColumn> DemographicColumnsOf(ResponseExportSurvey survey)
    {
        var carried = survey.Rows.SelectMany(r => r.Demographics.Keys).ToHashSet(StringComparer.Ordinal);
        if (survey.DemographicColumns is { } given)
        {
            var listed = given.Where(c => carried.Contains(c.Field)).ToList();
            // A value under a key the caller did not list is still printed, under its key.
            // Dropping it would make a person's answer vanish because a label was missing.
            var known = listed.Select(c => c.Field).ToHashSet(StringComparer.Ordinal);
            listed.AddRange(carried.Where(f => !known.Contains(f))
                .Order(StringComparer.Ordinal)
                .Select(f => new ResponseExportDemographicColumn(f, f)));
            return listed;
        }

        return carried.Order(StringComparer.Ordinal).Select(f => new ResponseExportDemographicColumn(f, f)).ToList();
    }

    private static SurveySheetLayout WriteSurveySheet(IXLWorksheet sheet, ResponseExportSurvey survey, bool includeAnswers)
    {
        var demographicColumns = DemographicColumnsOf(survey);
        var surveyQuestions = includeAnswers ? survey.Questions : [];

        // A comment column only where a comment exists. Forty empty "_comentario" columns
        // beside forty answers is the sheet nobody scrolls past.
        var withComments = surveyQuestions
            .Where(q => survey.Rows.Any(r => r.Answers.Any(a => a.QuestionId == q.Id && !string.IsNullOrWhiteSpace(a.Text))))
            .Select(q => q.Id)
            .ToHashSet();

        var headers = new List<string> { "#" };
        if (!survey.Anonymous)
        {
            headers.AddRange(["nombre", "correo", "usuario"]);
        }

        headers.Add("departamento");
        var demographicFirst = headers.Count + 1;
        headers.AddRange(demographicColumns.Select(c => c.Header));
        var demographicLast = headers.Count;
        headers.AddRange(["inicio", "fin", "completa", "minutos"]);
        var fixedColumns = headers.Count;
        var questionColumns = new List<(int Column, ResponseExportQuestion Question)>();
        foreach (var question in surveyQuestions)
        {
            headers.Add(question.Code);
            questionColumns.Add((headers.Count, question));
            if (withComments.Contains(question.Id))
            {
                headers.Add(question.Code + "_texto");
            }
        }

        Header(sheet, headers);

        var row = 2;
        foreach (var entry in survey.Rows)
        {
            var column = 1;
            sheet.Cell(row, column++).Value = row - 1;
            if (!survey.Anonymous)
            {
                sheet.Cell(row, column++).Value = entry.PersonName ?? "";
                sheet.Cell(row, column++).Value = entry.PersonEmail ?? "";
                sheet.Cell(row, column++).Value = entry.Username ?? "";
            }

            sheet.Cell(row, column++).Value = entry.Department ?? "";
            foreach (var demographic in demographicColumns)
            {
                sheet.Cell(row, column++).Value = entry.Demographics.GetValueOrDefault(demographic.Field, "");
            }

            sheet.Cell(row, column++).Value = entry.StartedAt.UtcDateTime;
            if (entry.CompletedAt is { } completed)
            {
                sheet.Cell(row, column).Value = completed.UtcDateTime;
            }

            column++;
            sheet.Cell(row, column++).Value = entry.IsComplete ? "sí" : "no";
            if (entry.TotalSeconds is { } seconds)
            {
                sheet.Cell(row, column).Value = Math.Round(seconds / 60d, 1);
            }

            column++;

            var byQuestion = entry.Answers.ToDictionary(a => a.QuestionId);
            foreach (var question in surveyQuestions)
            {
                byQuestion.TryGetValue(question.Id, out var answer);
                WriteAnswer(sheet.Cell(row, column++), answer?.Value ?? answer?.Text);
                if (withComments.Contains(question.Id))
                {
                    sheet.Cell(row, column++).Value = answer?.Text ?? "";
                }
            }

            row++;
        }

        return new SurveySheetLayout(
            fixedColumns, demographicFirst, demographicLast, headers.Count, Math.Max(row - 1, 1), questionColumns);
    }

    /// <summary>
    /// The reading aids: header fills, dimension bands with the question as a note, scale
    /// colours, the freeze and the filter. Styles only — no value is written here.
    /// </summary>
    private static void Finish(IXLWorksheet sheet, SurveySheetLayout layout)
    {
        var header = sheet.Range(1, 1, 1, layout.LastColumn);
        header.Style.Fill.BackgroundColor = XLColor.FromHtml("#" + NeutralHeaderFill);
        header.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

        // Bands run per CONTIGUOUS dimension, so a dimension that returns later in the order gets
        // a band of its own rather than a colour shared with a block it is not beside.
        var band = -1;
        string? previous = null;
        foreach (var (column, question) in layout.QuestionColumns)
        {
            var dimension = question.Category ?? "";
            if (band < 0 || !string.Equals(dimension, previous, StringComparison.Ordinal))
            {
                band++;
                previous = dimension;
            }

            var cell = sheet.Cell(1, column);
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#" + DimensionBands[band % DimensionBands.Length]);
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            cell.CreateComment().AddText(
                string.IsNullOrWhiteSpace(question.Category) ? question.Text : $"{question.Category}\n{question.Text}");
            sheet.Column(column).Width = 6;

            if (layout.LastRow >= 2 && ScaleBuckets(question) is { } buckets)
            {
                var answers = sheet.Range(2, column, layout.LastRow, column);
                for (var i = 0; i < buckets.Count; i++)
                {
                    answers.AddConditionalFormat()
                        .WhenBetween(buckets[i].Low, buckets[i].High)
                        .Fill.SetBackgroundColor(XLColor.FromHtml("#" + ScaleFills[i]));
                }
            }
        }

        if (layout.LastRow >= 2)
        {
            sheet.Range(1, 1, layout.LastRow, layout.LastColumn).SetAutoFilter();
        }

        sheet.SheetView.Freeze(1, layout.FixedColumns);
    }

    /// <summary>
    /// The five value ranges of a numeric scale, unfavourable to favourable, or null for a
    /// question that has no scale to place an answer on (a choice, a yes/no, free text).
    /// </summary>
    /// <remarks>
    /// Each range is the scale's span cut in five, closed at the bottom and open at the top except
    /// the last, so an integer on a boundary belongs to exactly one colour: on 1–5 the cuts fall at
    /// 1.8, 2.6, 3.4 and 4.2 and each answer gets its own step; on 0–10 a 2 is the second step,
    /// not the first and the second at once.
    /// </remarks>
    public static IReadOnlyList<(double Low, double High)>? ScaleBuckets(ResponseExportQuestion question)
    {
        if (!QuestionTypes.NumericScale.Contains(question.Type, StringComparer.Ordinal)
            || question.ScaleMin is not { } min
            || question.ScaleMax is not { } max
            || max <= min)
        {
            return null;
        }

        const double Gap = 1e-6;
        var width = (max - min) / (double)ScaleFills.Length;
        var buckets = new List<(double, double)>(ScaleFills.Length);
        for (var i = 0; i < ScaleFills.Length; i++)
        {
            var low = min + (i * width);
            var high = i == ScaleFills.Length - 1 ? max : min + ((i + 1) * width) - Gap;
            buckets.Add((low, high));
        }

        return buckets;
    }

    /// <summary>
    /// A scale answer goes in as a number so AVERAGE and a pivot work on the column as it
    /// stands. Anything else goes in as text, and a leading <c>=</c>, <c>+</c>, <c>-</c> or
    /// <c>@</c> is left to Excel's own handling of a text cell rather than being evaluated:
    /// the value is written through <see cref="XLCellValue"/> as a string, never as a formula.
    /// </summary>
    private static void WriteAnswer(IXLCell cell, string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        if (double.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var number))
        {
            cell.Value = number;
            return;
        }

        cell.SetValue(value);
    }

    private static void Header(IXLWorksheet sheet, IReadOnlyList<string> headers)
    {
        for (var i = 0; i < headers.Count; i++)
        {
            var cell = sheet.Cell(1, i + 1);
            cell.SetValue(headers[i]);
            cell.Style.Font.Bold = true;
        }
    }

    /// <summary>
    /// <c>R01 Clima ESPH 2026</c>, cut to Excel's 31 characters and stripped of the seven
    /// characters it refuses in a sheet name. The code goes first so the name stays unique
    /// and RESUMEN's first column is the index into the tabs.
    /// </summary>
    private static string SheetName(string code, string title, XLWorkbook book)
    {
        var cleaned = new string(title.Where(c => !ForbiddenInSheetName.Contains(c)).ToArray()).Trim();
        var name = (code + " " + cleaned).Trim();
        if (name.Length > MaxSheetNameLength)
        {
            name = name[..MaxSheetNameLength].Trim();
        }

        // Two climates may share a title across companies; the code makes the name unique
        // already, but a cut can still collide, so fall back to the code alone.
        return book.Worksheets.Contains(name) ? code : name;
    }
}
