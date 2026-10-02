using System.Globalization;
using System.Text;
using ClosedXML.Excel;

namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// One sheet as plain strings. <c>Rows[0]</c> is the sheet's row 1, so a row number shown to an
/// admin is always <c>index + 1</c> and matches what they see in their spreadsheet program.
/// </summary>
public sealed record SheetGrid(string Name, IReadOnlyList<IReadOnlyList<string>> Rows)
{
    public string Cell(int row, int column)
    {
        if (row < 1 || row > Rows.Count)
        {
            return string.Empty;
        }

        var cells = Rows[row - 1];
        return column >= 1 && column <= cells.Count ? cells[column - 1] : string.Empty;
    }

    public int ColumnCount => Rows.Count == 0 ? 0 : Rows.Max(r => r.Count);
}

/// <summary>
/// Reads whatever the client sends — their own HR export, not our template — into
/// <see cref="SheetGrid"/>s. Nothing here decides what a column means; that is the mapping's job.
///
/// <para><b>Why a CSV reader lives here again.</b> The wizard used to accept .xlsx only, which
/// meant a client with the CSV their HR system exports had to paste it into our template. The
/// whole point of the AI intake is that they do not have to. Spanish-locale Excel writes CSV as
/// Windows-1252 with <c>;</c> separators, so both the encoding and the delimiter are detected
/// rather than assumed.</para>
/// </summary>
public static class SpreadsheetReader
{
    /// <summary>Beyond this a file is not a roster, and reading it would only cost memory.</summary>
    public const int MaxRows = 20_000;

    public const int MaxColumns = 60;

    public static IReadOnlyList<SheetGrid> Read(Stream stream, string? fileName)
    {
        ArgumentNullException.ThrowIfNull(stream);

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        var bytes = buffer.ToArray();

        // An .xlsx is a zip, and a zip starts "PK". Sniffed rather than trusted from the name:
        // a CSV renamed .xlsx (or the reverse) is common, and the name is the admin's guess.
        var isZip = bytes.Length >= 2 && bytes[0] == (byte)'P' && bytes[1] == (byte)'K';
        if (isZip)
        {
            using var xlsx = new MemoryStream(bytes);
            return ReadWorkbook(xlsx);
        }

        var extension = Path.GetExtension(fileName ?? string.Empty).ToLowerInvariant();
        if (extension is ".csv" or ".txt" or ".tsv" || LooksLikeText(bytes))
        {
            return [ReadDelimited(bytes, Path.GetFileNameWithoutExtension(fileName ?? "Hoja1"))];
        }

        throw new InvalidDataException("The file is neither an Excel workbook nor delimited text.");
    }

    private static IReadOnlyList<SheetGrid> ReadWorkbook(Stream xlsx)
    {
        using var workbook = new XLWorkbook(xlsx);
        var sheets = new List<SheetGrid>();

        foreach (var sheet in workbook.Worksheets)
        {
            // Hidden sheets are lookup lists (our own template has one); a person is never on one.
            if (sheet.Visibility != XLWorksheetVisibility.Visible)
            {
                continue;
            }

            var lastRow = Math.Min(sheet.LastRowUsed()?.RowNumber() ?? 0, MaxRows);
            var lastColumn = Math.Min(sheet.LastColumnUsed()?.ColumnNumber() ?? 0, MaxColumns);
            var rows = new List<IReadOnlyList<string>>(lastRow);

            for (var r = 1; r <= lastRow; r++)
            {
                var cells = new string[lastColumn];
                for (var c = 1; c <= lastColumn; c++)
                {
                    cells[c - 1] = CellText(sheet.Cell(r, c));
                }

                rows.Add(cells);
            }

            sheets.Add(new SheetGrid(sheet.Name, rows));
        }

        return sheets;
    }

    /// <summary>
    /// The cell as its value, not its display: a date is ISO <c>yyyy-MM-dd</c> whatever the
    /// sheet's number format, and a whole number carries no ".0". A formula contributes its
    /// cached result.
    /// </summary>
    private static string CellText(IXLCell cell)
    {
        try
        {
            var value = cell.Value;
            if (value.IsDateTime)
            {
                return value.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }

            if (value.IsNumber)
            {
                var number = value.GetNumber();
                return number == Math.Floor(number) && Math.Abs(number) < 1e15
                    ? ((long)number).ToString(CultureInfo.InvariantCulture)
                    : number.ToString(CultureInfo.InvariantCulture);
            }

            if (value.IsBoolean)
            {
                return value.GetBoolean() ? "TRUE" : "FALSE";
            }

            return value.IsBlank ? string.Empty : value.ToString(CultureInfo.InvariantCulture).Trim();
        }
        catch (Exception)
        {
            // A cell ClosedXML cannot evaluate (a broken external formula) is one empty cell, not
            // a file that cannot be read.
            return string.Empty;
        }
    }

    private static bool LooksLikeText(byte[] bytes)
    {
        var sample = bytes.AsSpan(0, Math.Min(bytes.Length, 4096));
        return sample.Length > 0 && sample.IndexOf((byte)0) < 0;
    }

    private static SheetGrid ReadDelimited(byte[] bytes, string name)
    {
        var text = Decode(bytes);
        var delimiter = SniffDelimiter(text);
        var rows = new List<IReadOnlyList<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < text.Length && rows.Count < MaxRows; i++)
        {
            var ch = text[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    field.Append(ch);
                }

                continue;
            }

            if (ch == '"' && field.Length == 0)
            {
                inQuotes = true;
            }
            else if (ch == delimiter)
            {
                row.Add(field.ToString().Trim());
                field.Clear();
            }
            else if (ch is '\n' or '\r')
            {
                if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
                {
                    i++;
                }

                row.Add(field.ToString().Trim());
                field.Clear();
                rows.Add(row.Take(MaxColumns).ToArray());
                row = [];
            }
            else
            {
                field.Append(ch);
            }
        }

        if (field.Length > 0 || row.Count > 0)
        {
            row.Add(field.ToString().Trim());
            rows.Add(row.Take(MaxColumns).ToArray());
        }

        return new SheetGrid(string.IsNullOrWhiteSpace(name) ? "Hoja1" : name, rows);
    }

    /// <summary>
    /// UTF-8 when the bytes are valid UTF-8 (with or without a BOM), otherwise Windows-1252's
    /// Latin-1 subset — what a Spanish-locale Excel "CSV" actually is. Guessing UTF-8 for those
    /// turns every "Jiménez" into "Jim�nez".
    /// </summary>
    private static string Decode(byte[] bytes)
    {
        try
        {
            var strict = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
            return strict.GetString(bytes).TrimStart('﻿');
        }
        catch (DecoderFallbackException)
        {
            return Encoding.Latin1.GetString(bytes);
        }
    }

    private static char SniffDelimiter(string text)
    {
        var firstLines = string.Join('\n', text.Split('\n').Take(5));
        char[] candidates = [';', ',', '\t', '|'];
        return candidates.OrderByDescending(c => firstLines.Count(ch => ch == c)).First();
    }
}
