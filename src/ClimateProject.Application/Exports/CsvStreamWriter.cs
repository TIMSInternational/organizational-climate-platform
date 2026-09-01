using System.Text;

namespace ClimateProject.Application.Exports;

/// <summary>
/// The same CSV document <see cref="CsvWriter"/> produces, written straight to a
/// <see cref="Stream"/> instead of accumulated in one.
///
/// <para>
/// <b>Why a second writer.</b> #122 asks that "large exports should stream rather than
/// buffer", and <see cref="CsvWriter"/> structurally cannot: it holds the whole document in a
/// <see cref="StringBuilder"/> and then copies it again into a <c>byte[]</c>, so peak memory
/// is roughly three times the file (the builder's UTF-16 chars, the materialised string, and
/// the UTF-8 array) and every byte of it is alive at once. That is fine for a microclimate
/// export, which is a handful of scalars and a word list. It is the wrong shape for a survey,
/// whose row count grows with the instrument and the org chart, and it is the wrong shape for
/// whatever export comes next.
/// </para>
///
/// <para>
/// <b>What it actually guarantees.</b> Peak memory is one row, not one document: each
/// <see cref="WriteRowAsync"/> encodes its fields, writes them through a small fixed buffer
/// and returns. It never retains a reference to a row it has written, so a caller feeding it
/// from an <c>IAsyncEnumerable</c> holds no more than the database's own page at a time. This
/// is a property of the writer, and it is only worth anything if the *caller* also streams --
/// a caller that materialises every row into a list first has already lost, whatever this
/// class does.
/// </para>
///
/// <para>
/// <b>The escaping and the BOM are not re-implemented.</b> Both come from
/// <see cref="CsvField"/>, which is the whole reason that class exists. A streaming writer
/// with its own copy of the formula guard is a streaming writer that will eventually disagree
/// with the buffered one about what a leading dash means.
/// </para>
///
/// <para>
/// <b>Arity is still enforced.</b> The header fixes the column count and every row is checked
/// against it, exactly as in <see cref="CsvWriter"/>. Streaming makes a ragged document worse,
/// not better: bytes are already on the wire by the time the bad row arrives, so there is no
/// version of this where the caller gets a clean error instead of a truncated file -- which is
/// the argument for catching the ragged row rather than for tolerating it.
/// </para>
/// </summary>
public sealed class CsvStreamWriter : IAsyncDisposable
{
    private readonly StreamWriter _writer;
    private readonly int _columnCount;
    private bool _headerWritten;

    /// <summary>
    /// Wraps <paramref name="destination"/> and fixes the document's shape at
    /// <paramref name="headers"/>.
    /// </summary>
    /// <remarks>
    /// The header row is not written here. <see cref="WriteHeaderAsync"/> is a separate,
    /// awaited step so that nothing in this class does I/O from a constructor -- and so a
    /// caller that decides, after construction, that it must fail the request instead has not
    /// already put bytes on the wire.
    /// </remarks>
    public CsvStreamWriter(Stream destination, params string[] headers)
    {
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(headers);
        if (headers.Length == 0)
        {
            throw new ArgumentException("A CSV document needs at least one column.", nameof(headers));
        }

        Headers = headers;
        _columnCount = headers.Length;

        // encoderShouldEmitUTF8Identifier: false -- the BOM is written explicitly by
        // WriteHeaderAsync so that it is one visible decision rather than a constructor flag,
        // and so this class matches CsvWriter.ToBytes byte for byte.
        //
        // leaveOpen: true -- the destination is an HTTP response body owned by the framework.
        // Disposing it here would close the response mid-pipeline.
        _writer = new StreamWriter(
            destination,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            bufferSize: 4096,
            leaveOpen: true);
    }

    /// <summary>The column names this document was opened with.</summary>
    public IReadOnlyList<string> Headers { get; }

    /// <summary>
    /// Writes the UTF-8 BOM and the header row. Must be called once, before any data row.
    /// </summary>
    /// <remarks>
    /// The BOM is not cosmetic on this product: without it Excel renders every accented
    /// character in a Spanish-language export as mojibake, and the export is the artefact an
    /// admin forwards to people who will never see the app. Same reasoning, same bytes, as
    /// <see cref="CsvWriter.ToBytes"/>.
    /// </remarks>
    public async Task WriteHeaderAsync(CancellationToken cancellationToken = default)
    {
        if (_headerWritten)
        {
            throw new InvalidOperationException("The header row has already been written.");
        }

        _headerWritten = true;

        // U+FEFF written as a char through the UTF-8 encoder is the three-byte preamble,
        // which is what Encoding.UTF8.GetPreamble() returns. Asserted against CsvWriter's
        // bytes in CsvStreamWriterTests rather than assumed.
        await _writer.WriteAsync('﻿').ConfigureAwait(false);
        await WriteFieldsAsync(Headers, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Writes one row. Must have exactly as many fields as the header.</summary>
    public Task WriteRowAsync(CancellationToken cancellationToken, params string?[] fields)
    {
        ArgumentNullException.ThrowIfNull(fields);
        if (!_headerWritten)
        {
            throw new InvalidOperationException("The header row must be written first.");
        }

        if (fields.Length != _columnCount)
        {
            throw new ArgumentException(
                $"Expected {_columnCount} fields to match the header, got {fields.Length}.",
                nameof(fields));
        }

        return WriteFieldsAsync(fields, cancellationToken);
    }

    /// <summary>Flushes whatever is still in the encoder's buffer to the destination.</summary>
    public Task FlushAsync(CancellationToken cancellationToken = default) => _writer.FlushAsync(cancellationToken);

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        // Flushes; does not close the destination (leaveOpen above).
        await _writer.DisposeAsync().ConfigureAwait(false);
    }

    private async Task WriteFieldsAsync(IReadOnlyList<string?> fields, CancellationToken cancellationToken)
    {
        for (var i = 0; i < fields.Count; i++)
        {
            if (i > 0)
            {
                await _writer.WriteAsync(',').ConfigureAwait(false);
            }

            await _writer.WriteAsync(CsvField.Escape(fields[i]).AsMemory(), cancellationToken).ConfigureAwait(false);
        }

        await _writer.WriteAsync(CsvField.RowTerminator.AsMemory(), cancellationToken).ConfigureAwait(false);
    }
}
