using System.Text;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// What the streaming writer has to keep true that the buffered one already does -- and the
/// one thing only it can promise.
/// </summary>
public class CsvStreamWriterTests
{
    [Fact]
    public async Task It_writes_byte_for_byte_what_the_buffered_writer_writes()
    {
        // The whole reason CsvField exists. Two writers over one escaping rule are only worth
        // having if they cannot disagree, and "cannot disagree" is a claim about bytes: the
        // BOM, the unconditional quotes, the doubled quote, the formula apostrophe, the CRLF.
        // Asserting the two outputs are equal pins all five at once, and it is the assertion
        // that fails the moment somebody re-implements one of them here.
        var buffered = new CsvWriter("section", "key", "language", "value");
        buffered.AppendRow("summary", "title", "es", "Clima Q3, \"pulso\"");
        buffered.AppendRow("summary", "note", "es", "- Capacitar al personal");
        buffered.AppendRow("summary", "empty", null, null);

        await using var stream = new MemoryStream();
        await using (var streamed = new CsvStreamWriter(stream, "section", "key", "language", "value"))
        {
            await streamed.WriteHeaderAsync();
            await streamed.WriteRowAsync(default, "summary", "title", "es", "Clima Q3, \"pulso\"");
            await streamed.WriteRowAsync(default, "summary", "note", "es", "- Capacitar al personal");
            await streamed.WriteRowAsync(default, "summary", "empty", null, null);
        }

        Assert.Equal(buffered.ToBytes(), stream.ToArray());
    }

    [Fact]
    public async Task A_leading_dash_is_still_neutralised()
    {
        // Stated separately from the equality above even though that test covers it, because
        // this is the one rule whose absence is invisible: a file without the apostrophe opens
        // cleanly, looks right, and executes a respondent's text as a formula on the reader's
        // machine. A test that only compared two writers would go green if BOTH lost the guard.
        await using var stream = new MemoryStream();
        await using (var csv = new CsvStreamWriter(stream, "value"))
        {
            await csv.WriteHeaderAsync();
            await csv.WriteRowAsync(default, "=SUM(A1:A9)");
            await csv.WriteRowAsync(default, "- Capacitar al personal");
        }

        var text = Text(stream);
        Assert.Contains("\"'=SUM(A1:A9)\"", text, StringComparison.Ordinal);
        Assert.Contains("\"'- Capacitar al personal\"", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Accented_text_survives_the_round_trip()
    {
        // The BOM plus UTF-8, on the characters this product is actually made of. Without the
        // preamble Excel renders every one of these as mojibake, and the export is the artefact
        // an admin forwards to people who will never open the app.
        await using var stream = new MemoryStream();
        await using (var csv = new CsvStreamWriter(stream, "value"))
        {
            await csv.WriteHeaderAsync();
            await csv.WriteRowAsync(default, "Dirección de Operaciones — Ñandú, ¿sí?");
        }

        var bytes = stream.ToArray();
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        Assert.Contains("Dirección de Operaciones — Ñandú, ¿sí?", Text(stream), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rows_reach_the_destination_before_the_document_is_finished()
    {
        // THE property this class exists for, and the only one CsvWriter structurally cannot
        // have. #122 asks that a large export not exhaust memory; the way to prove that is not
        // to measure a heap, it is to show that bytes have left the writer while rows are still
        // being produced. If WriteRowAsync accumulated -- a list, a StringBuilder, anything --
        // the destination would still be empty here and the assertion below would fail.
        //
        // 4096 is StreamWriter's buffer, so this asserts the writer flushes through a bounded
        // buffer rather than never: enough rows to fill it, far fewer than a real export.
        await using var stream = new MemoryStream();
        await using var csv = new CsvStreamWriter(stream, "section", "value");
        await csv.WriteHeaderAsync();

        for (var i = 0; i < 400; i++)
        {
            await csv.WriteRowAsync(default, "option", $"row {i} with enough text to fill a buffer");
        }

        var writtenSoFar = stream.Length;
        Assert.True(writtenSoFar > 0, "nothing had reached the destination while rows were still being written");

        // And the tail is still to come, which is what makes the number above a flush rather
        // than the whole document arriving at once.
        await csv.FlushAsync();
        Assert.True(stream.Length > writtenSoFar);
    }

    [Fact]
    public async Task A_row_that_disagrees_with_the_header_is_refused()
    {
        // Same guard, same reasoning as CsvWriter's: a ragged CSV shifts every value after the
        // missing field one column left, producing a file that opens cleanly and is wrong.
        // Streaming makes it worse, not better -- the earlier rows are already on the wire.
        await using var stream = new MemoryStream();
        await using var csv = new CsvStreamWriter(stream, "section", "key", "value");
        await csv.WriteHeaderAsync();

        var tooFew = await Assert.ThrowsAsync<ArgumentException>(
            () => csv.WriteRowAsync(default, "summary", "title"));
        Assert.Contains("Expected 3 fields", tooFew.Message, StringComparison.Ordinal);

        var tooMany = await Assert.ThrowsAsync<ArgumentException>(
            () => csv.WriteRowAsync(default, "summary", "title", "es", "extra"));
        Assert.Contains("got 4", tooMany.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_row_written_before_the_header_is_refused()
    {
        // A data row that arrives first produces a file whose first line is read as the header
        // by every CSV reader there is -- silently losing one row and mislabelling every column.
        await using var stream = new MemoryStream();
        await using var csv = new CsvStreamWriter(stream, "section", "value");

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => csv.WriteRowAsync(default, "summary", "title"));
    }

    [Fact]
    public async Task The_header_cannot_be_written_twice()
    {
        await using var stream = new MemoryStream();
        await using var csv = new CsvStreamWriter(stream, "value");
        await csv.WriteHeaderAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => csv.WriteHeaderAsync());
    }

    [Fact]
    public async Task Disposing_the_writer_leaves_the_destination_open()
    {
        // The destination is an HTTP response body owned by Kestrel. Closing it here would
        // truncate the response rather than end it, and the symptom -- a download that is
        // occasionally short -- would be blamed on the network.
        var stream = new MemoryStream();
        await using (var csv = new CsvStreamWriter(stream, "value"))
        {
            await csv.WriteHeaderAsync();
        }

        // Still writable: an ObjectDisposedException here is the defect.
        stream.WriteByte((byte)'x');
        Assert.True(stream.Length > 0);
    }

    [Fact]
    public void A_document_needs_at_least_one_column()
    {
        using var stream = new MemoryStream();
        Assert.Throws<ArgumentException>(() => new CsvStreamWriter(stream));
    }

    /// <summary>The document as text, BOM stripped.</summary>
    private static string Text(MemoryStream stream)
    {
        var bytes = stream.ToArray();
        return Encoding.UTF8.GetString(bytes[3..]);
    }
}
