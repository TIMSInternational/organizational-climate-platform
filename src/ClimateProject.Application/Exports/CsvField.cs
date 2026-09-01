using System.Globalization;

namespace ClimateProject.Application.Exports;

/// <summary>
/// One CSV field, quoted per RFC 4180 and made inert against spreadsheet formula injection.
///
/// <para>
/// <b>Why this is its own class.</b> There are now two writers over the same rule --
/// <see cref="CsvWriter"/>, which builds a whole document in memory, and
/// <see cref="CsvStreamWriter"/>, which writes rows straight to a response body and never
/// holds more than one of them. They differ only in where the bytes go. Leaving the escaping
/// inside <see cref="CsvWriter"/> and copying it into the streaming one would put the product's
/// only defence against a respondent's word being executed as a formula in two places, which
/// is precisely how the rule came to exist in three copies before #131 promoted it out of
/// <c>AuditEndpoints</c>. One rule, two serialisations.
/// </para>
///
/// <para>
/// <b>Two separate jobs, and quoting only does the first.</b> Every field is quoted
/// unconditionally with embedded quotes doubled, because these values are user-controlled --
/// a survey's title, a department's name -- and can contain a comma, a quote or a newline.
/// Quoting does <em>not</em> stop Excel or LibreOffice evaluating a cell whose text begins
/// with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c>; a leading apostrophe is the standard
/// neutraliser, and it is applied to every field rather than only the known-hostile ones,
/// because the point of a rule with no exceptions is that it survives someone adding a column
/// that is not.
/// </para>
///
/// <para>
/// <b>The cost, stated because a Spanish-language product pays it.</b> A respondent or an
/// admin who starts a line with a dash as a bullet -- <c>- Capacitar al personal</c>, which is
/// ordinary Spanish prose, not an edge case -- gets an apostrophe they can see in the cell.
/// That is accepted here: a visible apostrophe is a cosmetic defect, and a formula that runs
/// with the reader's authority on the reader's machine is not. The escape hatch is the one
/// <c>services/tracking-api</c>'s <c>TrackingSheetExport</c> documents: an xlsx cell typed as
/// a string is never parsed as a formula, so it needs no guard at all. This product does not
/// write xlsx, so CSV pays the apostrophe.
/// </para>
/// </summary>
public static class CsvField
{
    /// <summary>
    /// The leading characters a spreadsheet reads as the start of a formula rather than as
    /// text.
    /// </summary>
    /// <remarks>
    /// <c>=</c> and <c>+</c> begin a formula in Excel, LibreOffice Calc and Sheets; <c>-</c>
    /// does too (it is parsed as unary minus applied to an expression); <c>@</c> is Excel's
    /// legacy intersection/function prefix. Tab and carriage return are included because a
    /// leading whitespace character can be dropped on import, which would promote the
    /// character after it into the leading position this rule is about.
    /// </remarks>
    public static readonly char[] FormulaLeadingCharacters = ['=', '+', '-', '@', '\t', '\r'];

    /// <summary>The line ending every row gets. RFC 4180 specifies CRLF and Excel expects it.</summary>
    public const string RowTerminator = "\r\n";

    /// <summary>One field, quoted and made inert. See the class remarks.</summary>
    public static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        var escaped = value.Replace("\"", "\"\"", StringComparison.Ordinal);
        var inert = FormulaLeadingCharacters.Contains(value[0]) ? "'" + escaped : escaped;

        return $"\"{inert}\"";
    }

    /// <summary>
    /// A number formatted invariantly.
    /// </summary>
    /// <remarks>
    /// Culture matters here in a way it does not for the strings: a server running under a
    /// Spanish culture would render <c>0.5</c> as <c>0,5</c>, which inside a comma-delimited
    /// file is a value that has to be quoted to survive at all and reads as text once it does.
    /// Every numeric field in an export goes through here.
    /// </remarks>
    public static string Number(double value) => value.ToString(CultureInfo.InvariantCulture);

    /// <inheritdoc cref="Number(double)"/>
    public static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);
}
