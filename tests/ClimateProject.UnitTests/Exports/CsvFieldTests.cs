using System.Globalization;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The escaping rule itself, asserted against <see cref="CsvField"/> directly.
///
/// <para>
/// <b>Why this class has to exist separately.</b> The rule now has two consumers --
/// <see cref="CsvWriter"/>, which builds a document in memory, and
/// <see cref="CsvStreamWriter"/>, which writes rows to a response body -- and the test that
/// compares them, <c>CsvStreamWriterTests.It_writes_byte_for_byte_what_the_buffered_writer_writes</c>,
/// structurally cannot see a defect in the shared half: both sides of the comparison call
/// <see cref="CsvField.Escape"/>, so a change there moves both and the equality still holds.
/// </para>
///
/// <para>
/// Before this class the only thing pinning quote-doubling anywhere in the product was one
/// assertion inside <c>MicroclimateExportProjectionTests</c> -- a test about a different
/// domain's export, which #122 quietly took a dependency on by adding a second consumer without
/// adding a test for the rule. Deleting the doubling from <see cref="CsvField.Escape"/> broke a
/// microclimate test and nothing in surveys. The rule is shared, so its test is too.
/// </para>
/// </summary>
public class CsvFieldTests
{
    [Fact]
    public void An_embedded_quote_is_doubled_so_the_field_does_not_end_early()
    {
        // RFC 4180: inside a quoted field, a literal quote is written twice. Emit it once and
        // the field terminates in the middle of the value -- the parser then reads the rest of
        // the text as extra columns, so a department called Ingeniería "Norte" silently shifts
        // every column after it on that row.
        Assert.Equal("\"Ingeniería \"\"Norte\"\"\"", CsvField.Escape("Ingeniería \"Norte\""));
        Assert.Equal("\"\"\"\"\"\"", CsvField.Escape("\"\""));
    }

    [Fact]
    public void A_delimiter_or_a_newline_survives_because_every_field_is_quoted()
    {
        // Unconditional quoting is what makes a comma inside a value safe, and it is applied
        // even to values that plainly do not need it -- a rule with no exceptions survives
        // someone adding a column that does.
        Assert.Equal("\"Ventas, Mercadeo\"", CsvField.Escape("Ventas, Mercadeo"));
        Assert.Equal("\"linea1\r\nlinea2\"", CsvField.Escape("linea1\r\nlinea2"));
        Assert.Equal("\"plain\"", CsvField.Escape("plain"));
    }

    [Fact]
    public void Every_character_a_spreadsheet_reads_as_a_formula_is_neutralised()
    {
        // Bound to the published set rather than to a list written down here, so a character
        // added to the rule is covered by this test on the same commit.
        foreach (var leading in CsvField.FormulaLeadingCharacters)
        {
            var escaped = CsvField.Escape($"{leading}SUM(A1:A9)");

            Assert.StartsWith($"\"'{leading}", escaped, StringComparison.Ordinal);
        }

        // The apostrophe goes on the leading character only, and only when it is one of them.
        Assert.Equal("\"Capacitar al personal\"", CsvField.Escape("Capacitar al personal"));
        Assert.Equal("\"a=b\"", CsvField.Escape("a=b"));
    }

    [Fact]
    public void A_hostile_value_gets_both_defences_at_once()
    {
        // The two jobs are independent and a value can need both: the apostrophe stops the
        // formula running, the doubling stops the quote ending the field. Neither substitutes
        // for the other.
        Assert.Equal("\"'=cmd|'\"\"/c calc'\"\"!A1\"", CsvField.Escape("=cmd|'\"/c calc'\"!A1"));
    }

    [Fact]
    public void An_empty_or_missing_value_is_an_empty_quoted_field()
    {
        // Not an unquoted empty string: a row of bare commas is legal CSV but reads
        // differently to some parsers, and the writers concatenate these without inspection.
        Assert.Equal("\"\"", CsvField.Escape(null));
        Assert.Equal("\"\"", CsvField.Escape(string.Empty));
    }

    [Fact]
    public void Numbers_are_formatted_invariantly_whatever_the_host_culture_is()
    {
        // A server under a Spanish culture would render 62.5 as "62,5", which inside a
        // comma-delimited file has to be quoted to survive and reads as text once it is.
        // Asserted under that culture rather than trusting the default, because the default on
        // every machine this suite runs on is the one culture that cannot fail.
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("es-CR");

            Assert.Equal("62.5", CsvField.Number(62.5));
            Assert.Equal("250", CsvField.Number(250));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
