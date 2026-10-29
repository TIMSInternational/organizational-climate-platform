using System.Globalization;
using ClimateProject.Application.Surveys;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One survey's sheet in the status workbook: its roster and how to print it.</summary>
/// <param name="Title">The sheet's name and its heading, already resolved for the company's language.</param>
/// <param name="PerSurvey">Adds the two key columns, exactly as the roster screen and the CSV do.</param>
/// <param name="ShowState">
/// Whether this survey records per-person state at all. False for an anonymous survey that
/// records only completions, where an Estado column would be a claim it cannot make.
/// </param>
public sealed record StatusWorkbookSurvey(
    string Title,
    bool PerSurvey,
    bool ShowState,
    IReadOnlyList<SurveyRosterRow> Roster);

/// <summary>
/// Every survey of one company as one workbook, a sheet per survey: who was invited, how they
/// sign in and where each person stands.
///
/// <para>
/// <b>Why it exists.</b> Through October 2026 this file was produced by downloading three
/// rosters and running a Python script over them, roughly twice a day. The product could
/// already export ONE survey's roster as CSV; what the client is sent is every survey at once,
/// as a workbook, with a count and a percentage under each sheet.
/// </para>
///
/// <para>
/// <b>It defines no columns of its own.</b> The header row and every cell come from
/// <see cref="SurveyRosterCsv.Headers"/> and <see cref="SurveyRosterCsv.Fields"/> — the same
/// two methods the CSV export calls and the same vocabulary the screen draws, so a column
/// added, renamed or relabelled in one place cannot leave this file saying something else.
/// The only things added here are the totals block and the sheet layout.
/// </para>
///
/// <para>
/// <b>What it deliberately does not do: split a name.</b> The script this replaces printed
/// Nombre and Apellidos in separate columns by guessing that the last two words are the
/// surnames — and it reported its own doubts for a human to check, because for
/// "ADRIANA DE LOS ANGELES SANCHO PORRAS" that guess is right and for a name with a particle in
/// the wrong place it is not. A product that prints a guess into a client's deliverable with no
/// doubt column beside it would be shipping a quiet error, so the name is one cell, exactly as
/// stored. A two-column layout stays a reviewed step outside the product.
/// </para>
/// </summary>
public static class StatusWorkbook
{
    /// <summary>Excel's own ceiling on a sheet name, and the characters it refuses in one.</summary>
    private const int MaxSheetNameLength = 31;

    private static readonly char[] ForbiddenInSheetName = [':', '\\', '/', '?', '*', '[', ']'];

    /// <param name="generatedAt">
    /// The day the picture was taken, in the company's zone, printed on every sheet. A status
    /// file with no date on it gets read a week later as if it were today's.
    /// </param>
    public static byte[] Build(IReadOnlyList<StatusWorkbookSurvey> surveys, DateOnly generatedAt, bool spanish)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        for (var i = 0; i < surveys.Count; i++)
        {
            var survey = surveys[i];
            var sheet = book.AddWorksheet(SheetName(survey.Title, i, book));
            var headers = SurveyRosterCsv.Headers(spanish, survey.PerSurvey, survey.ShowState);

            sheet.Cell(1, 1).Value = survey.Title;
            sheet.Cell(1, 1).Style.Font.Bold = true;
            sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            const int headerRow = 4;
            for (var c = 0; c < headers.Length; c++)
            {
                var cell = sheet.Cell(headerRow, c + 1);
                cell.Value = headers[c];
                cell.Style.Font.Bold = true;
            }

            var row = headerRow + 1;
            foreach (var person in survey.Roster)
            {
                var fields = SurveyRosterCsv.Fields(person, spanish, survey.PerSurvey, survey.ShowState);
                for (var c = 0; c < fields.Length; c++)
                {
                    // A null stays an EMPTY cell rather than becoming "", so "no code yet" and
                    // "a code whose value is blank" cannot be read as the same thing.
                    if (fields[c] is { } value)
                    {
                        sheet.Cell(row, c + 1).Value = value;
                    }
                }

                row++;
            }

            WriteTotals(sheet, survey, row + 1, spanish);
            sheet.Columns(1, Math.Max(headers.Length, 1)).AdjustToContents();
            sheet.SheetView.FreezeRows(headerRow);
        }

        // A workbook with no sheet at all is a corrupt file, not an empty one: a company whose
        // surveys are all drafts still gets something openable that says why it is empty.
        if (surveys.Count == 0)
        {
            var empty = book.AddWorksheet(spanish ? "Sin encuestas" : "No surveys");
            empty.Cell(1, 1).Value = spanish
                ? "Esta empresa todavía no tiene encuestas distribuidas."
                : "This company has no distributed surveys yet.";
        }

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    /// <summary>
    /// The count and the percentage under each sheet, over the people ON that sheet.
    ///
    /// <para>
    /// The denominator is the roster's own length, never a stored audience count: the two
    /// answer different questions, and a sheet whose percentage divided by something other
    /// than the rows above it is a number nobody can check by counting.
    /// </para>
    /// </summary>
    private static void WriteTotals(IXLWorksheet sheet, StatusWorkbookSurvey survey, int at, bool spanish)
    {
        var total = survey.Roster.Count;
        sheet.Cell(at, 1).Value = spanish ? "Personas" : "People";
        sheet.Cell(at, 2).Value = total;
        sheet.Cell(at, 1).Style.Font.Bold = true;

        if (!survey.ShowState)
        {
            return;
        }

        var finished = survey.Roster.Count(r => r.Status == SurveyParticipantStatuses.Completed);
        sheet.Cell(at + 1, 1).Value = SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.Completed, spanish);
        sheet.Cell(at + 1, 2).Value = finished;

        var pct = sheet.Cell(at + 2, 1);
        pct.Value = spanish ? "Porcentaje" : "Percentage";
        pct.Style.Font.Bold = true;
        // Written as a VALUE, not a formula: a formula's result is computed when the file is
        // opened, and a reader that shows a cached-value-less cell prints 0 %. The same reason
        // `ResponseWorkbook` writes its totals out.
        var share = total == 0 ? 0d : (double)finished / total;
        var shareCell = sheet.Cell(at + 2, 2);
        shareCell.Value = share;
        shareCell.Style.NumberFormat.Format = "0.0%";
    }

    /// <summary>
    /// A sheet name Excel accepts and a reader recognises: the survey's title, stripped of the
    /// characters Excel refuses and capped at its limit, made unique by a numbered prefix when
    /// two surveys share the first 31 characters of a name — which ESPH's did.
    /// </summary>
    private static string SheetName(string title, int index, XLWorkbook book)
    {
        var cleaned = new string((title ?? string.Empty)
            .Where(c => !ForbiddenInSheetName.Contains(c))
            .ToArray())
            .Trim();
        if (cleaned.Length == 0)
        {
            cleaned = $"{index + 1}";
        }

        var candidate = cleaned.Length <= MaxSheetNameLength ? cleaned : cleaned[..MaxSheetNameLength];
        if (!book.Worksheets.Any(w => string.Equals(w.Name, candidate, StringComparison.OrdinalIgnoreCase)))
        {
            return candidate;
        }

        var prefix = $"{index + 1} ";
        var room = MaxSheetNameLength - prefix.Length;
        return prefix + (cleaned.Length <= room ? cleaned : cleaned[..room]);
    }
}
