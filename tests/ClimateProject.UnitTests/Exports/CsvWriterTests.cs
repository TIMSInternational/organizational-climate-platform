using System.Text;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The structural guarantees of <see cref="CsvWriter"/>: that a document keeps the shape its
/// header declared, and that a row ends where RFC 4180 says it does.
///
/// <para>
/// The escaping half of the class -- unconditional quoting, doubled quotes, the leading
/// apostrophe that stops a respondent's word becoming a formula, the UTF-8 BOM and the
/// invariant number format -- is exercised through <c>MicroclimateExportProjectionTests</c>,
/// against the real export those rules exist for. What that route cannot reach is the arity
/// guard: <c>MicroclimateExportProjection.ToCsv</c> only ever passes four fields, so every one
/// of its tests passes with the guard deleted. These are the tests that hold it.
/// </para>
/// </summary>
public class CsvWriterTests
{
    [Fact]
    public void A_row_with_too_few_fields_is_refused()
    {
        var csv = new CsvWriter("section", "key", "language", "value");

        // A ragged CSV is not a rendering defect. Drop a field and every value after it
        // shifts one column left, so "language" reads as the key and the value column reads
        // as the language -- a file that opens cleanly, reconciles by row count, and is
        // wrong. The reader has no way to notice.
        var ex = Assert.Throws<ArgumentException>(() => csv.AppendRow("summary", "title", "en"));

        Assert.Contains("Expected 4 fields", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_row_with_too_many_fields_is_refused()
    {
        var csv = new CsvWriter("section", "key", "language", "value");

        var ex = Assert.Throws<ArgumentException>(
            () => csv.AppendRow("summary", "title", "en", "Weekly pulse", "extra"));

        Assert.Contains("got 5", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_row_matching_the_header_is_written()
    {
        // The control on the two above: the guard has to refuse the wrong arity without
        // refusing the right one.
        var csv = new CsvWriter("section", "key", "language", "value");
        csv.AppendRow("summary", "title", "en", "Weekly pulse");

        Assert.Contains(
            "\"summary\",\"title\",\"en\",\"Weekly pulse\"",
            Text(csv),
            StringComparison.Ordinal);
    }

    [Fact]
    public void A_null_field_still_counts_towards_the_arity()
    {
        // Null is an empty cell, not an absent column. If it were skipped, the commonest
        // ragged row in this codebase -- a nullable Description or SuppressionReason -- would
        // be the one that slipped through.
        var csv = new CsvWriter("section", "key", "language", "value");
        csv.AppendRow("summary", "description", "en", null);

        Assert.Contains("\"summary\",\"description\",\"en\",\"\"", Text(csv), StringComparison.Ordinal);
        Assert.Throws<ArgumentException>(() => csv.AppendRow("summary", "description", null));
    }

    [Fact]
    public void A_document_needs_at_least_one_column()
    {
        // A zero-column header would fix the column count at 0, at which point the arity
        // guard is satisfied only by rows with no fields -- a document that can never be
        // written to rather than one that throws when you try.
        Assert.Throws<ArgumentException>(() => new CsvWriter());
    }

    [Fact]
    public void Rows_end_with_crlf_because_that_is_what_rfc_4180_and_excel_expect()
    {
        var csv = new CsvWriter("section", "key", "language", "value");
        csv.AppendRow("summary", "title", "en", "Weekly pulse");

        Assert.Equal(
            "\"section\",\"key\",\"language\",\"value\"\r\n\"summary\",\"title\",\"en\",\"Weekly pulse\"\r\n",
            Text(csv));
    }

    /// <summary>The document as text, BOM stripped -- the bytes are the class's own contract.</summary>
    private static string Text(CsvWriter csv)
    {
        var bytes = csv.ToBytes();
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        return Encoding.UTF8.GetString(bytes[3..]);
    }
}
