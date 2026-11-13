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

/// <summary>Which layout the status workbook's sheets take.</summary>
public enum StatusWorkbookLayout
{
    /// <summary>The roster's own columns, exactly as the screen and the CSV print them.</summary>
    Standard,

    /// <summary>
    /// The layout ESPH received from a script through October 2026 (copied from a Fidelitas 360
    /// status file): name, a progress percentage and a word, the whole row coloured, and the share
    /// finished under it. The name stays ONE cell (ruled 2026-11-08): the script's separate
    /// Apellidos column was a guess at where the surnames start, see the remarks on
    /// <see cref="StatusWorkbook"/>.
    /// </summary>
    Progress,
}

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
///
/// <para>
/// <b>Who is on a sheet (2026-11-02).</b> For a survey that hands out per-survey keys, the people
/// who were SENT one — plus anybody who started or finished without one, so that no response is
/// ever left off. The roster screen lists the whole audience, and for a survey aimed at
/// departments that audience holds people the client never put on the list: ESPH's Clima reached
/// 633 by department while ESPH's list was 619, and the 14 between them never received a Clima
/// key and could not answer. A percentage over 633 told the client a lower number than the one
/// they had been reading. Those people are not hidden — the count of them is printed under the
/// totals — they are just not the denominator. Surveys without per-survey keys are unchanged.
/// </para>
///
/// <para>
/// <b>How it reads.</b> The client received this file from a script for two weeks with each
/// Estado coloured — finished green, in progress orange, not opened left plain — and that is
/// carried over with the same two tints (Office accent 6 and accent 2 at 80 %), so the file
/// TIMS now downloads looks like the one ESPH already knows. The header is filled and filtered,
/// and the name column stays on screen while the rest scrolls.
/// </para>
/// </summary>
public static class StatusWorkbook
{
    /// <summary>Finished. Office accent 6 (green) at 80 % tint, as the client's own sheet used.</summary>
    public const string FinishedFill = "E2EFDA";

    /// <summary>Started but not finished. Office accent 2 (orange) at 80 % tint.</summary>
    public const string InProgressFill = "FBE5D6";

    private const string HeaderFill = "E1E0D9";

    /// <summary>
    /// The rows a sheet counts. Everyone, unless the survey hands out per-survey keys; then the
    /// people sent one, and anybody who got further than "not opened" without one — a response
    /// is never dropped to make a number tidier.
    /// </summary>
    public static IReadOnlyList<SurveyRosterRow> Counted(StatusWorkbookSurvey survey)
    {
        ArgumentNullException.ThrowIfNull(survey);
        return survey.PerSurvey
            ? survey.Roster
                .Where(r => r.CredentialIssuedOn is not null || r.Status != SurveyParticipantStatuses.NotStarted)
                .ToList()
            : survey.Roster;
    }

    /// <summary>Excel's own ceiling on a sheet name, and the characters it refuses in one.</summary>
    private const int MaxSheetNameLength = 31;

    private static readonly char[] ForbiddenInSheetName = [':', '\\', '/', '?', '*', '[', ']'];

    /// <param name="generatedAt">
    /// The day the picture was taken, in the company's zone, printed on every sheet. A status
    /// file with no date on it gets read a week later as if it were today's.
    /// </param>
    /// <param name="layout">
    /// <see cref="StatusWorkbookLayout.Progress"/> applies only to a survey that records where each
    /// person stands; a sheet for one that does not keeps the standard columns, because a
    /// percentage column would be a claim that survey cannot make.
    /// </param>
    public static byte[] Build(
        IReadOnlyList<StatusWorkbookSurvey> surveys,
        DateOnly generatedAt,
        bool spanish,
        StatusWorkbookLayout layout = StatusWorkbookLayout.Standard)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        for (var i = 0; i < surveys.Count; i++)
        {
            var survey = surveys[i];
            var sheet = book.AddWorksheet(SheetName(survey.Title, i, book));
            if (layout == StatusWorkbookLayout.Progress && survey.ShowState)
            {
                WriteProgressSheet(sheet, survey, generatedAt, spanish);
                continue;
            }

            var headers = SurveyRosterCsv.Headers(spanish, survey.PerSurvey, survey.ShowState);

            sheet.Cell(1, 1).Value = survey.Title;
            sheet.Cell(1, 1).Style.Font.Bold = true;
            sheet.Cell(1, 1).Style.Font.FontSize = 14;
            sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

            const int headerRow = 4;
            for (var c = 0; c < headers.Length; c++)
            {
                var cell = sheet.Cell(headerRow, c + 1);
                cell.Value = headers[c];
                cell.Style.Font.Bold = true;
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#" + HeaderFill);
            }

            var counted = Counted(survey);
            // 1-based. `Headers` ends with Estado, Última actividad whenever state is shown.
            var stateColumn = survey.ShowState ? headers.Length - 1 : 0;
            var row = headerRow + 1;
            foreach (var person in counted)
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

                // The Estado cell takes the person's status colour.
                if (stateColumn > 0 && StatusFill(person.Status) is { } fill)
                {
                    sheet.Cell(row, stateColumn).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + fill);
                }

                row++;
            }

            if (row > headerRow + 1)
            {
                sheet.Range(headerRow, 1, row - 1, headers.Length).SetAutoFilter();
            }

            WriteTotals(sheet, survey, counted, row + 1, spanish);
            // Sized over the header and the people only. Sized over the whole sheet, column A
            // took the width of the title and the note under the totals, and every other column
            // was pushed off the first screen; both now run over into the empty cells beside them.
            sheet.Columns(1, Math.Max(headers.Length, 1)).AdjustToContents(headerRow, Math.Max(row - 1, headerRow));
            sheet.SheetView.Freeze(headerRow, 1);
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
    /// <summary>The Estado colour for a status; null leaves the cell plain (not opened).</summary>
    public static string? StatusFill(string status) => status switch
    {
        SurveyParticipantStatuses.Completed => FinishedFill,
        SurveyParticipantStatuses.Started or SurveyParticipantStatuses.NotCompleted => InProgressFill,
        _ => null,
    };

    private static void WriteTotals(
        IXLWorksheet sheet, StatusWorkbookSurvey survey, IReadOnlyList<SurveyRosterRow> counted, int at, bool spanish)
    {
        var total = counted.Count;
        sheet.Cell(at, 1).Value = spanish ? "Personas" : "People";
        sheet.Cell(at, 2).Value = total;
        sheet.Cell(at, 1).Style.Font.Bold = true;

        // The people the screen lists and this sheet does not count, said rather than dropped.
        var notCounted = survey.Roster.Count - counted.Count;
        var noteAt = at + (survey.ShowState ? 5 : 1);
        if (notCounted > 0)
        {
            sheet.Cell(noteAt, 1).Value = (spanish, notCounted == 1) switch
            {
                (true, true) => "1 persona de la audiencia no recibió código para esta encuesta y no se cuenta.",
                (true, false) => $"{notCounted} personas de la audiencia no recibieron código para esta encuesta y no se cuentan.",
                (false, true) => "1 person in the audience was never sent a code for this survey and is not counted.",
                (false, false) => $"{notCounted} people in the audience were never sent a code for this survey and are not counted.",
            };
            sheet.Cell(noteAt, 1).Style.Font.Italic = true;
        }

        if (!survey.ShowState)
        {
            return;
        }

        var finished = counted.Count(r => r.Status == SurveyParticipantStatuses.Completed);
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
        sheet.Cell(at + 1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + FinishedFill);

        // The other two states, each as many as the rows above say. "Empezó" counts a person who
        // stopped half way too, which is what the orange on the sheet already says about them.
        var inProgress = counted.Count(r => StatusFill(r.Status) == InProgressFill);
        var notOpened = total - finished - inProgress;
        sheet.Cell(at + 3, 1).Value = SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.Started, spanish);
        sheet.Cell(at + 3, 2).Value = inProgress;
        sheet.Cell(at + 3, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + InProgressFill);
        sheet.Cell(at + 4, 1).Value = SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.NotStarted, spanish);
        sheet.Cell(at + 4, 2).Value = notOpened;
    }

    /// <summary>The progress column's text for someone who started and has not finished.</summary>
    public static string InProgressText(bool spanish) => spanish ? "En curso" : "In progress";

    /// <summary>
    /// The progress layout's two words for a status: the percentage cell's value (a number, or
    /// <see cref="InProgressText"/> -- the platform never reads answers, so how FAR somebody got is
    /// not known and is not invented) and the Observaciones label.
    /// </summary>
    public static (object Progress, string Note) ProgressOf(string status, bool spanish) => status switch
    {
        SurveyParticipantStatuses.Completed => (1d, spanish ? "Finalizada" : "Finished"),
        SurveyParticipantStatuses.Started or SurveyParticipantStatuses.NotCompleted =>
            (InProgressText(spanish), spanish ? "Pendiente Finalizar" : "Pending completion"),
        _ => (0d, spanish ? "Sin Iniciar" : "Not started"),
    };

    /// <summary>
    /// One survey in the progress layout. Same people as the standard sheet (<see cref="Counted"/>),
    /// same title and date above, same note for those not counted; only the columns and the total
    /// differ. The total is the share FINISHED, written as a value for the reason
    /// <see cref="WriteTotals"/> gives, and labelled so it cannot be read as an average of the
    /// percentages above it.
    /// </summary>
    private static void WriteProgressSheet(IXLWorksheet sheet, StatusWorkbookSurvey survey, DateOnly generatedAt, bool spanish)
    {
        sheet.Cell(1, 1).Value = survey.Title;
        sheet.Cell(1, 1).Style.Font.Bold = true;
        sheet.Cell(1, 1).Style.Font.FontSize = 14;
        sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

        string[] headers = spanish
            ? ["Nombre completo", "Porcentaje de Avance", "Observaciones"]
            : ["Full name", "Progress", "Notes"];
        const int headerRow = 4;
        for (var c = 0; c < headers.Length; c++)
        {
            var cell = sheet.Cell(headerRow, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#" + HeaderFill);
        }

        var counted = Counted(survey);
        var row = headerRow + 1;
        foreach (var person in counted)
        {
            var (progress, note) = ProgressOf(person.Status, spanish);
            sheet.Cell(row, 1).Value = person.Name;
            var pct = sheet.Cell(row, 2);
            if (progress is double share)
            {
                pct.Value = share;
                pct.Style.NumberFormat.Format = "0%";
            }
            else
            {
                pct.Value = (string)progress;
            }

            pct.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            sheet.Cell(row, 3).Value = note;
            // The whole row takes the colour, as the client's file did.
            if (StatusFill(person.Status) is { } fill)
            {
                sheet.Range(row, 1, row, headers.Length).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + fill);
            }

            row++;
        }

        if (row > headerRow + 1)
        {
            sheet.Range(headerRow, 1, row - 1, headers.Length).SetAutoFilter();
        }

        var finished = counted.Count(r => r.Status == SurveyParticipantStatuses.Completed);
        var totalLabel = sheet.Cell(row, 1);
        totalLabel.Value = spanish ? "Total finalizadas" : "Total finished";
        totalLabel.Style.Font.Bold = true;
        var totalShare = sheet.Cell(row, 2);
        totalShare.Value = counted.Count == 0 ? 0d : (double)finished / counted.Count;
        totalShare.Style.NumberFormat.Format = "0%";
        totalShare.Style.Font.Bold = true;
        totalShare.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        sheet.Cell(row, 3).Value = spanish
            ? $"{finished} de {counted.Count} personas"
            : $"{finished} of {counted.Count} people";
        sheet.Range(row, 1, row, headers.Length).Style.Border.TopBorder = XLBorderStyleValues.Thin;

        var notCounted = survey.Roster.Count - counted.Count;
        if (notCounted > 0)
        {
            var noteCell = sheet.Cell(row + 2, 1);
            noteCell.Value = (spanish, notCounted == 1) switch
            {
                (true, true) => "1 persona de la audiencia no recibió código para esta encuesta y no se cuenta.",
                (true, false) => $"{notCounted} personas de la audiencia no recibieron código para esta encuesta y no se cuentan.",
                (false, true) => "1 person in the audience was never sent a code for this survey and is not counted.",
                (false, false) => $"{notCounted} people in the audience were never sent a code for this survey and are not counted.",
            };
            noteCell.Style.Font.Italic = true;
        }

        sheet.Columns(1, headers.Length).AdjustToContents(headerRow, Math.Max(row, headerRow));
        sheet.SheetView.Freeze(headerRow, 1);
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
