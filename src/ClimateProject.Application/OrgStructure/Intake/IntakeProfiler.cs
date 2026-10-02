using System.Globalization;
using System.Text.RegularExpressions;

namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// <b>Everything the model is shown about a file, and nothing else.</b> This record is the
/// privacy boundary of the AI intake: it is serialised whole into the model request, so a field
/// added here is a field sent to a third party.
///
/// <para>What crosses: sheet names, header text, the distinct values of <i>category</i> columns
/// (job titles, areas, sites — facts about the organisation, not about a person) with counts, and
/// for every other column its kind plus three <i>masked</i> samples ("Ma*** Ji***",
/// "m***@meridiano.cr"). Data rows in the preview are masked the same way, column by column.
/// What never crosses: a full name, a full email, a birth date, an identity number.</para>
///
/// <para>The mapping that comes back is applied to every row by <see cref="IntakeMappingApplier"/>,
/// on this server. So one model call covers a file of any length, and its cost does not grow
/// with the workforce.</para>
/// </summary>
public sealed record IntakeProfile(IReadOnlyList<SheetProfile> Sheets);

public sealed record SheetProfile(
    string Name,
    int RowCount,
    int ColumnCount,
    int SuggestedHeaderRow,
    IReadOnlyList<PreviewRow> Preview,
    IReadOnlyList<ColumnProfile> Columns);

public sealed record PreviewRow(int Row, IReadOnlyList<string> Cells);

/// <param name="Kind">
/// <c>category</c>, <c>email</c>, <c>number</c>, <c>date</c>, <c>text</c> or <c>empty</c>.
/// </param>
/// <param name="Values">The distinct values with counts — only for category and number columns.</param>
/// <param name="MaskedSamples">Up to three masked examples — only for columns whose values are personal.</param>
public sealed record ColumnProfile(
    int Column,
    string Header,
    int NonEmpty,
    int Distinct,
    string Kind,
    IReadOnlyList<ValueCount>? Values,
    IReadOnlyList<string>? MaskedSamples);

public sealed record ValueCount(string Value, int Count);

public static partial class IntakeProfiler
{
    /// <summary>More distinct values than this and a column is about people, not the organisation.</summary>
    public const int MaxCategoryValues = 60;

    /// <summary>Numbers (an age, years of service) are shown as values up to this many distinct.</summary>
    public const int MaxNumberValues = 80;

    private const int HeaderScanRows = 25;
    private const int PreviewDataRows = 6;

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex IsoDatePattern();

    public static IntakeProfile Build(IReadOnlyList<SheetGrid> sheets)
    {
        ArgumentNullException.ThrowIfNull(sheets);
        return new IntakeProfile(sheets.Where(s => s.Rows.Count > 0).Select(ProfileSheet).ToList());
    }

    private static SheetProfile ProfileSheet(SheetGrid sheet)
    {
        var header = GuessHeaderRow(sheet);
        var columnCount = sheet.ColumnCount;
        var dataRows = Enumerable.Range(header + 1, Math.Max(0, sheet.Rows.Count - header))
            .Where(r => Enumerable.Range(1, columnCount).Any(c => sheet.Cell(r, c).Length > 0))
            .ToList();

        var columns = new List<ColumnProfile>();
        for (var c = 1; c <= columnCount; c++)
        {
            var values = dataRows.Select(r => sheet.Cell(r, c)).Where(v => v.Length > 0).ToList();
            columns.Add(ProfileColumn(c, sheet.Cell(header, c), values));
        }

        // The preview is the model's view of the layout: everything above the data (titles, the
        // header) as written, and the first data rows masked by their column's kind.
        var preview = new List<PreviewRow>();
        for (var r = 1; r <= Math.Min(header, HeaderScanRows); r++)
        {
            preview.Add(new PreviewRow(r, Enumerable.Range(1, columnCount).Select(c => sheet.Cell(r, c)).ToList()));
        }

        foreach (var r in dataRows.Take(PreviewDataRows))
        {
            preview.Add(new PreviewRow(
                r,
                Enumerable.Range(1, columnCount).Select(c => MaskForKind(sheet.Cell(r, c), columns[c - 1].Kind)).ToList()));
        }

        return new SheetProfile(sheet.Name, dataRows.Count, columnCount, header, preview, columns);
    }

    /// <summary>
    /// The first row, within the first 25, that looks like a header: at least two cells, all of
    /// them short text, and as wide as the widest such row. Files from HR carry a title, a logo
    /// row or a blank spacer above the table; the model may still correct this guess.
    /// </summary>
    public static int GuessHeaderRow(SheetGrid sheet)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        var scan = Math.Min(HeaderScanRows, sheet.Rows.Count);
        var widths = new int[scan + 1];
        for (var r = 1; r <= scan; r++)
        {
            var cells = sheet.Rows[r - 1].Where(v => v.Length > 0).ToList();
            var allLabels = cells.All(v => v.Length <= 60 && !double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out _) && !EmailPattern().IsMatch(v));
            widths[r] = cells.Count >= 2 && allLabels ? cells.Count : 0;
        }

        var widest = widths.Max();
        if (widest == 0)
        {
            return 1;
        }

        for (var r = 1; r <= scan; r++)
        {
            if (widths[r] >= Math.Max(2, widest * 0.6))
            {
                return r;
            }
        }

        return 1;
    }

    private static ColumnProfile ProfileColumn(int column, string header, IReadOnlyList<string> values)
    {
        var headerText = header.Length > 0 ? header : $"(columna {column})";
        if (values.Count == 0)
        {
            return new ColumnProfile(column, headerText, 0, 0, "empty", null, null);
        }

        var distinct = values.GroupBy(v => v, StringComparer.OrdinalIgnoreCase)
            .Select(g => new ValueCount(g.First(), g.Count()))
            .OrderByDescending(v => v.Count)
            .ThenBy(v => v.Value, StringComparer.Ordinal)
            .ToList();

        double Share(Func<string, bool> test) => values.Count(test) / (double)values.Count;

        // A header that names a person's own data is masked whatever its values look like: in a
        // file of three people, three names are three distinct values and would otherwise pass
        // as a "category" and be sent whole.
        //
        // Whole words, and a category word wins: "Nombre del puesto" is a job title, not a name,
        // and "Control" is not "rol".
        var normalisedHeader = IntakeWorkbook.NormaliseHeader(headerText);
        var namedCategory = HasWord(normalisedHeader, CategoryHeaderWords);
        if (!namedCategory && HasWord(normalisedHeader, PersonalHeaderWords))
        {
            return new ColumnProfile(column, headerText, values.Count, distinct.Count, KindOfPersonal(values), null, Samples(values, KindOfPersonal(values)));
        }

        if (Share(v => EmailPattern().IsMatch(v)) >= 0.6)
        {
            return new ColumnProfile(column, headerText, values.Count, distinct.Count, "email", null, Samples(values, "email"));
        }

        if (Share(v => IsoDatePattern().IsMatch(v)) >= 0.8)
        {
            return new ColumnProfile(column, headerText, values.Count, distinct.Count, "date", null, Samples(values, "date"));
        }

        if (Share(v => double.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out _)) >= 0.8)
        {
            // An identity or phone number is long, and nearly unique; an age or years of service
            // is short and repeats.
            var longDigits = values.Average(v => v.Count(char.IsDigit)) >= 7;
            var isIdentifier = longDigits || distinct.Count > MaxNumberValues || distinct.Count > values.Count * 0.9 && values.Count > 10;
            return isIdentifier
                ? new ColumnProfile(column, headerText, values.Count, distinct.Count, "text", null, Samples(values, "text"))
                : new ColumnProfile(column, headerText, values.Count, distinct.Count, "number", distinct, null);
        }

        // A category repeats: most of an organisation's people share a handful of areas. A
        // column where nearly every value is unique is about individuals — unless its header
        // says it is an organisational category, which a small file cannot show by repetition.
        var repeats = values.Count >= 4 && distinct.Count <= values.Count * 0.6;
        if (distinct.Count <= MaxCategoryValues && (repeats || namedCategory))
        {
            return new ColumnProfile(column, headerText, values.Count, distinct.Count, "category", distinct, null);
        }

        return new ColumnProfile(column, headerText, values.Count, distinct.Count, "text", null, Samples(values, "text"));
    }

    /// <summary>Header words (normalised: lower case, no accents) that mark a column as personal.</summary>
    private static readonly string[] PersonalHeaderWords =
    [
        "nombre", "name", "apellido", "surname", "correo", "email", "e mail", "mail", "cedula", "identificacion",
        "dni", "pasaporte", "telefono", "celular", "phone", "movil", "domicilio", "address", "nacimiento", "birth",
        "salario", "salary", "cuenta", "iban",
    ];

    /// <summary>Header words that mark a column as an organisational category.</summary>
    private static readonly string[] CategoryHeaderWords =
    [
        "area", "departamento", "department", "unidad", "gerencia", "direccion", "cargo", "puesto", "rol",
        "role", "position", "title", "sede", "oficina", "site", "location", "genero", "sexo", "gender",
        "antiguedad", "tenure", "tipo", "nivel", "level", "jornada", "contrato", "pais", "country", "provincia",
    ];

    /// <summary>How a personal column is masked: an email keeps its domain, a date its year, the rest their shape.</summary>
    private static string KindOfPersonal(IReadOnlyList<string> values)
    {
        if (values.Count(v => EmailPattern().IsMatch(v)) >= values.Count * 0.6)
        {
            return "email";
        }

        return values.Count(v => IsoDatePattern().IsMatch(v)) >= values.Count * 0.8 ? "date" : "text";
    }

    private static bool HasWord(string normalisedHeader, IEnumerable<string> words)
    {
        var padded = $" {normalisedHeader} ";
        return words.Any(word => padded.Contains($" {word} ", StringComparison.Ordinal));
    }

    private static List<string> Samples(IReadOnlyList<string> values, string kind) =>
        values.Distinct(StringComparer.Ordinal).Take(3).Select(v => MaskForKind(v, kind)).ToList();

    /// <summary>
    /// What a personal value looks like with the person taken out: enough shape for the model
    /// to tell "Apellidos, Nombre" from "Nombre Apellido", or an email from an identity number.
    /// </summary>
    public static string MaskForKind(string value, string kind)
    {
        if (value.Length == 0)
        {
            return value;
        }

        switch (kind)
        {
            case "category":
            case "number":
            case "empty":
                return value;
            case "date":
                return value.Length >= 4 ? value[..4] + "-**-**" : "****";
            case "email":
                var at = value.IndexOf('@');
                return at > 0 ? value[0] + "***" + value[at..] : Mask(value);
            default:
                return Mask(value);
        }
    }

    private static string Mask(string value) =>
        string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(word =>
        {
            var trailing = word.EndsWith(',') ? "," : string.Empty;
            var core = word.TrimEnd(',');
            if (core.Length == 0)
            {
                return word;
            }

            if (core.All(char.IsDigit))
            {
                return new string('#', core.Length) + trailing;
            }

            return (core.Length <= 2 ? core[..1] : core[..2]) + "***" + trailing;
        }));
}
