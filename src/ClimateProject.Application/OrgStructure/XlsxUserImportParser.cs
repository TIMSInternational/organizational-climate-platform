using ClosedXML.Excel;

namespace ClimateProject.Application.OrgStructure;

/// <summary>A problem with the file itself rather than with one of its rows.</summary>
/// <param name="Code">
/// Stable and machine-readable, so the screen can say it in the reader's language; <c>Message</c>
/// is the English sentence for logs and for any caller that has no catalogue.
/// </param>
/// <param name="Value">What the code is about, when it is about something: the missing column.</param>
public sealed record IntakeParseProblem(string Sheet, string Message, string Code, string? Value = null);

/// <summary>
/// What reading an intake file produced: the rows to review, and anything wrong with the file
/// that no single row can express.
///
/// <para>THIS RECORD IS THE EXTENSION SEAM. The wizard consumes it and knows nothing about
/// where it came from; <see cref="XlsxUserImportParser"/> is one producer, and a Bedrock
/// extraction step reading an arbitrary document the client happened to send is intended to be
/// another. Adding that producer must not require touching the wizard, the review step, or the
/// invitation-creating code, because none of them mention a spreadsheet: they mention this type.
/// Keep it free of ClosedXML types for exactly that reason.</para>
/// </summary>
public sealed record IntakeParseResult(
    IReadOnlyList<ParsedImportRow> Rows,
    IReadOnlyList<IntakeParseProblem> Problems);

/// <summary>
/// Reads the <c>Personas</c> sheet of an intake workbook into <see cref="ParsedImportRow"/>s.
///
/// <para>Deliberately does NO validation beyond "could this cell be read". Whether an email is
/// well formed, a role is permitted, a department exists or a person is already invited is the
/// import endpoint's judgement, and it must stay there: the wizard shows the admin the same
/// verdict the commit will reach, and two validators would eventually disagree. See
/// BulkImportEndpoints.
/// </para>
/// </summary>
public static class XlsxUserImportParser
{
    /// <summary>
    /// How far down the sheet to look for the header row before giving up.
    ///
    /// <para>Not 1. Files that come back from an HR department routinely carry a title, a logo
    /// row or a blank spacer above the table, and refusing those would send the admin back to
    /// their spreadsheet to delete rows, which is precisely the errand this feature removes.</para>
    /// </summary>
    private const int MaxHeaderScanRows = 20;

    public static IntakeParseResult Parse(Stream xlsx)
    {
        ArgumentNullException.ThrowIfNull(xlsx);

        var problems = new List<IntakeParseProblem>();

        using var workbook = new XLWorkbook(xlsx);
        if (!workbook.Worksheets.TryGetWorksheet(IntakeWorkbook.PeopleSheet, out var sheet))
        {
            problems.Add(new IntakeParseProblem(
                IntakeWorkbook.PeopleSheet,
                $"The workbook has no sheet named \"{IntakeWorkbook.PeopleSheet}\".",
                "no_people_sheet",
                IntakeWorkbook.PeopleSheet));
            return new IntakeParseResult([], problems);
        }

        var header = FindHeaderRow(sheet);
        if (header is null)
        {
            problems.Add(new IntakeParseProblem(
                IntakeWorkbook.PeopleSheet,
                "No header row was found. The sheet needs a row with at least the columns \"Nombre\" and \"Correo\".",
                "no_header"));
            return new IntakeParseResult([], problems);
        }

        var (headerRowNumber, columns) = header.Value;

        // Reported once for the file rather than once per row: a missing "Rol" column makes
        // every row fail identically, and 400 copies of the same sentence hides the one fact
        // the admin needs, which is that a column is missing.
        foreach (var required in new[] { "role", "department" })
        {
            if (!columns.ContainsKey(required))
            {
                var label = IntakeWorkbook.PeopleColumns[required][0];
                var column = $"{char.ToUpperInvariant(label[0])}{label[1..]}";
                problems.Add(new IntakeParseProblem(
                    IntakeWorkbook.PeopleSheet,
                    $"No \"{column}\" column was found, so every row will be missing it.",
                    "missing_column",
                    column));
            }
        }

        var rows = new List<ParsedImportRow>();
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? headerRowNumber;

        for (var rowNumber = headerRowNumber + 1; rowNumber <= lastRow; rowNumber++)
        {
            var name = Cell(sheet, rowNumber, columns, "name");
            var email = Cell(sheet, rowNumber, columns, "email");
            var roleCell = Cell(sheet, rowNumber, columns, "role");
            var department = Cell(sheet, rowNumber, columns, "department");

            // A wholly blank row is a spacer, not an error. A row with ANY content is kept even
            // if incomplete, because dropping it would hide it: the admin would approve an
            // import of 39 people from a file that named 40 and nothing would say which one
            // went missing.
            if (name.Length == 0 && email.Length == 0 && roleCell.Length == 0 && department.Length == 0)
            {
                continue;
            }

            rows.Add(new ParsedImportRow(
                RowNumber: rowNumber,
                Name: name,
                Email: email,
                // An unrecognised word is passed through untouched so the endpoint can name it
                // back ("Invalid role: Gerente"). Blanking it here would report "Invalid role: "
                // and leave the admin hunting for what they actually typed.
                Role: IntakeWorkbook.ResolveRole(roleCell) ?? roleCell,
                Department: department.Length == 0 ? null : department));
        }

        if (rows.Count == 0)
        {
            problems.Add(new IntakeParseProblem(
                IntakeWorkbook.PeopleSheet,
                "The sheet has a header but no data rows.",
                "no_data_rows"));
        }

        return new IntakeParseResult(rows, problems);
    }

    /// <summary>
    /// The first row that names at least the name and email columns, with the column index of
    /// every header it recognises. Unrecognised headers are ignored rather than rejected: a
    /// client's file may legitimately carry extra columns this import has no use for.
    /// </summary>
    private static (int RowNumber, Dictionary<string, int> Columns)? FindHeaderRow(IXLWorksheet sheet)
    {
        var lastRow = Math.Min(sheet.LastRowUsed()?.RowNumber() ?? 0, MaxHeaderScanRows);
        var lastColumn = sheet.LastColumnUsed()?.ColumnNumber() ?? 0;

        for (var rowNumber = 1; rowNumber <= lastRow; rowNumber++)
        {
            var found = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var column = 1; column <= lastColumn; column++)
            {
                var normalised = IntakeWorkbook.NormaliseHeader(sheet.Cell(rowNumber, column).GetString());
                if (normalised.Length == 0)
                {
                    continue;
                }

                foreach (var (key, spellings) in IntakeWorkbook.PeopleColumns)
                {
                    // First spelling wins: a file with both "Correo" and "Email" columns takes
                    // the leftmost, which is the one the reader sees first too.
                    if (!found.ContainsKey(key) && spellings.Contains(normalised, StringComparer.Ordinal))
                    {
                        found[key] = column;
                    }
                }
            }

            if (found.ContainsKey("name") && found.ContainsKey("email"))
            {
                return (rowNumber, found);
            }
        }

        return null;
    }

    private static string Cell(IXLWorksheet sheet, int rowNumber, Dictionary<string, int> columns, string key)
        => columns.TryGetValue(key, out var column) ? sheet.Cell(rowNumber, column).GetString().Trim() : string.Empty;
}
