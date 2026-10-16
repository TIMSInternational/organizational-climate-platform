using System.Globalization;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One question, as a column of the export.</summary>
/// <param name="Code">The short column header, <c>P01</c>…, so a 40-question sheet stays analysable.</param>
public sealed record ResponseExportQuestion(
    Guid Id, int Order, string Code, string? Category, string Type, string Text);

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
    IReadOnlyList<ResponseExportPending> Pending);

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
/// </summary>
public static class ResponseWorkbook
{
    /// <summary>Excel's own limit on a sheet name, and the characters it refuses in one.</summary>
    private const int MaxSheetNameLength = 31;

    private static readonly char[] ForbiddenInSheetName = [':', '\\', '/', '?', '*', '[', ']'];

    /// <param name="truncation">
    /// Said out loud when a ceiling was reached, because a workbook that is quietly missing the
    /// older half of the platform is one somebody will analyse as if it were complete.
    /// </param>
    public static byte[] Build(
        IReadOnlyList<ResponseExportSurvey> surveys, DateTimeOffset generatedAt, string? truncation = null)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        var summary = book.AddWorksheet("RESUMEN");
        var questions = book.AddWorksheet("PREGUNTAS");

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
        Header(questions, ["Hoja", "Código", "Dimensión", "Tipo", "Pregunta"]);

        var summaryRow = 2;
        var questionRow = 2;

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

            foreach (var question in survey.Questions)
            {
                questions.Cell(questionRow, 1).Value = sheetCode;
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

            WriteSurveySheet(sheet, survey);
        }

        summary.Cell(summaryRow + 1, 1).Value = "Generado";
        summary.Cell(summaryRow + 1, 2).Value = generatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(truncation))
        {
            summary.Cell(summaryRow + 2, 1).SetValue("Incompleto");
            summary.Cell(summaryRow + 2, 2).SetValue(truncation);
            summary.Cell(summaryRow + 2, 1).Style.Font.Bold = true;
        }

        foreach (var sheet in book.Worksheets)
        {
            sheet.SheetView.FreezeRows(1);
            sheet.Columns().AdjustToContents(1, 40, 8d, 60d);
        }

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSurveySheet(IXLWorksheet sheet, ResponseExportSurvey survey)
    {
        // The union of the demographic fields any row actually carries, in a stable order.
        // Built from the rows rather than from the company's field list because an anonymous
        // survey's rows may legitimately be missing a field the company defines.
        var demographicFields = survey.Rows
            .SelectMany(r => r.Demographics.Keys)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        // A comment column only where a comment exists. Forty empty "_comentario" columns
        // beside forty answers is the sheet nobody scrolls past.
        var withComments = survey.Questions
            .Where(q => survey.Rows.Any(r => r.Answers.Any(a => a.QuestionId == q.Id && !string.IsNullOrWhiteSpace(a.Text))))
            .Select(q => q.Id)
            .ToHashSet();

        var headers = new List<string> { "#" };
        if (!survey.Anonymous)
        {
            headers.AddRange(["nombre", "correo", "usuario"]);
        }

        headers.Add("departamento");
        headers.AddRange(demographicFields);
        headers.AddRange(["inicio", "fin", "completa", "minutos"]);
        foreach (var question in survey.Questions)
        {
            headers.Add(question.Code);
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
            foreach (var field in demographicFields)
            {
                sheet.Cell(row, column++).Value = entry.Demographics.GetValueOrDefault(field, "");
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
            foreach (var question in survey.Questions)
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
