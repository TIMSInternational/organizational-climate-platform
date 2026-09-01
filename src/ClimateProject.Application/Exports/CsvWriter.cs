using System.Text;

namespace ClimateProject.Application.Exports;

/// <summary>
/// One CSV document, built row by row, quoted per RFC 4180 and made inert against
/// spreadsheet formula injection.
///
/// <para>
/// <b>Provenance.</b> The <em>escaping rule</em> -- <see cref="CsvField.Escape"/> and
/// <see cref="CsvField.FormulaLeadingCharacters"/> -- is lifted verbatim, reasoning included, from the
/// private <c>Csv</c> helper in <c>AuditEndpoints</c>, the only place in this solution that
/// had got it right. It is promoted to the Application layer rather than copied a second time
/// so that the next export does not have to rediscover the two separate jobs below. The same
/// rule, with the same character set, is independently maintained in the tracking service's
/// <c>TrackingSheetExport</c>; that service is a separate solution and cannot reference this
/// assembly, so the duplication there is structural rather than accidental.
/// </para>
///
/// <para>
/// <b>This is not a drop-in replacement for the audit export.</b> <c>AuditEndpoints</c> still
/// carries its own copy, and swapping it onto this class would NOT be behaviour-preserving:
/// that endpoint writes bare <c>\n</c> line endings and no BOM, where this class writes
/// RFC 4180 <c>\r\n</c> and a UTF-8 preamble. Retiring it is a deliberate change to the bytes
/// of an existing download, on a surface outside #131's slice, and is left to whoever owns
/// it -- not to be done as a tidy-up on the assumption that the two are already identical.
/// </para>
///
/// <para>
/// <b>Two separate jobs, and quoting only does the first.</b> Both are
/// <see cref="CsvField"/>'s, since #122 gave the same rule a second, streaming serialisation.
/// </para>
///
/// <para>
/// <b>Delimiters.</b> Every field is quoted unconditionally, with embedded quotes doubled,
/// rather than quoted-when-needed. These values are user-controlled -- a microclimate's
/// title, or a word a respondent typed -- and can contain a comma, a quote or a newline.
/// </para>
///
/// <para>
/// <b>Formulas.</b> Quoting a field does <em>not</em> stop Excel or LibreOffice evaluating
/// it: a cell whose text begins with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c> is a formula
/// however it was quoted in the file. On a microclimate export the free-text words come from
/// unauthenticated respondents and the person who opens the file is by definition a
/// CompanyAdmin or a SuperAdmin, so the payload would run with the reader's authority on the
/// reader's machine. A leading apostrophe is the standard neutraliser: spreadsheets treat
/// the rest of the cell as literal text and do not display the apostrophe itself. Applied to
/// every field rather than only the known-hostile ones, because the point of a rule with no
/// exceptions is that it survives someone adding a column that is not.
/// </para>
/// </summary>
public sealed class CsvWriter
{
    // The escaping rule itself -- unconditional quoting, doubled quotes, the leading
    // apostrophe -- lives in CsvField, shared with CsvStreamWriter. See that class for the
    // reasoning and for why the two writers must not each carry a copy.

    private readonly StringBuilder _builder = new();
    private readonly int _columnCount;

    /// <summary>Starts a document whose first row is <paramref name="headers"/>.</summary>
    /// <remarks>
    /// The header fixes the column count for the whole document, and
    /// <see cref="AppendRow"/> throws on any row that disagrees. A ragged CSV is not a
    /// rendering defect -- it silently shifts values into the wrong columns, which reads as
    /// plausible data.
    /// </remarks>
    public CsvWriter(params string[] headers)
    {
        ArgumentNullException.ThrowIfNull(headers);
        if (headers.Length == 0)
        {
            throw new ArgumentException("A CSV document needs at least one column.", nameof(headers));
        }

        _columnCount = headers.Length;
        AppendFields(headers);
    }

    /// <summary>Appends one row. Must have exactly as many fields as the header.</summary>
    public void AppendRow(params string?[] fields)
    {
        ArgumentNullException.ThrowIfNull(fields);
        if (fields.Length != _columnCount)
        {
            throw new ArgumentException(
                $"Expected {_columnCount} fields to match the header, got {fields.Length}.",
                nameof(fields));
        }

        AppendFields(fields);
    }

    /// <summary>
    /// Appends one row whose numeric field is formatted invariantly.
    /// </summary>
    /// <remarks>
    /// Culture matters here in a way it does not for the strings: a server running under a
    /// Spanish culture would render <c>0.5</c> as <c>0,5</c>, which inside a comma-delimited
    /// file is a value that has to be quoted to survive at all and reads as text once it
    /// does. Every numeric field in an export goes through here.
    /// </remarks>
    public static string Number(double value) => CsvField.Number(value);

    /// <inheritdoc cref="Number(double)"/>
    public static string Number(int value) => CsvField.Number(value);

    /// <summary>The document as UTF-8 bytes, BOM first. The only supported serialisation.</summary>
    /// <remarks>
    /// <para>
    /// The BOM is not cosmetic on this product: without it Excel renders every accented
    /// character in a Spanish-language export as mojibake, and the export is the artefact an
    /// admin forwards to people who will never see the app. This is the only supported way to
    /// serialise a document, so it cannot be forgotten at a call site.
    /// </para>
    /// <para>
    /// <c>Encoding.UTF8.GetPreamble()</c> rather than a literal U+FEFF prepended to the
    /// string, matching the choice <c>TrackingSheetExport</c> documents: the BOM is a
    /// byte-level artefact of the file, not a character in the document. A literal would put
    /// an invisible character in this source file that an editor, a re-encode or a lint
    /// autofix can silently eat, and the failure would show up only as mojibake in a
    /// customer's spreadsheet.
    /// </para>
    /// </remarks>
    public byte[] ToBytes() => [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(_builder.ToString())];

    private void AppendFields(IReadOnlyList<string?> fields)
    {
        for (var i = 0; i < fields.Count; i++)
        {
            if (i > 0)
            {
                _builder.Append(',');
            }

            _builder.Append(CsvField.Escape(fields[i]));
        }

        // CRLF rather than LF: RFC 4180 specifies it, and it is what Excel expects on the
        // platform most of these files are opened on.
        _builder.Append(CsvField.RowTerminator);
    }
}
