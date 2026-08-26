using System.Globalization;
using System.Text;

namespace ClimateProject.Application.Exports;

/// <summary>One column of a <see cref="PdfDocument"/> table.</summary>
/// <param name="Header">The heading printed in the header band. May be empty.</param>
/// <param name="Weight">
/// The column's share of the table width, relative to the other columns' weights. Relative
/// rather than absolute so a table does not have to be re-measured when the page size or the
/// margins change.
/// </param>
/// <param name="RightAligned">
/// True for the numeric columns. A count or a percentage read down a left-aligned column is
/// materially harder to compare, and comparison is the only reason those columns are there.
/// </param>
public sealed record PdfTableColumn(string Header, double Weight, bool RightAligned = false);

/// <summary>
/// A paginated, text-and-tables PDF, written by hand, with no third-party dependency.
///
/// ## Why this exists rather than a package
///
/// #122 asks for the PDF approach to be "chosen once for the whole product", and #91 states
/// the constraint the choice has to satisfy: "headless-browser rendering in App Runner is a
/// heavier operational commitment than a native PDF library". #131 declined to make the call
/// and dropped the microclimate PDF route rather than guess, recording that the blocker was a
/// dependency decision "with a licence question attached (QuestPDF is royalty-free only under
/// a revenue threshold)". This class is that decision, made:
///
/// <list type="bullet">
/// <item><b>Not a headless browser.</b> Chromium in the API container is hundreds of megabytes
/// of image, a second process to supervise, a sandbox to configure and a class of crash that
/// only reproduces under memory pressure. For a document that is a heading, a summary and four
/// tables, it is an operational commitment out of all proportion to the artefact.</item>
/// <item><b>Not a third-party library.</b> The candidates are a revenue-conditional licence
/// (QuestPDF) or an unmaintained fork (PdfSharpCore) -- and this product is delivered to a
/// government agency, where "what is in the bill of materials and under what terms" is a
/// question that gets asked. The API today has no third-party rendering dependency at all.</item>
/// <item><b>The document is genuinely simple.</b> Text in two weights, horizontal rules, and
/// tables of wrapped cells. That is a few hundred lines of PDF 1.4 against a specification that
/// has not changed in twenty years, and it is exercised by tests that parse the bytes back.
/// The trade is real and stated: no images, no charts, no font embedding, two faces.</item>
/// </list>
///
/// ## What it costs, stated
///
/// Base-14 fonts mean the document is limited to what WinAnsiEncoding can name -- which
/// covers Spanish completely (see <see cref="PdfStandardFontMetrics"/>) and does not cover, say,
/// Greek. A chart in a report would need a raster image and an <c>/XObject</c>, which is the
/// point at which this decision should be revisited rather than extended.
///
/// ## Memory
///
/// A PDF's cross-reference table is a list of byte offsets, so the file cannot be written
/// without knowing where each object landed: this class buffers. That is a bounded cost by
/// construction here -- the documents it is asked for are bounded by the instrument and the org
/// chart, not by the response count -- and it is why the unbounded export format is CSV, which
/// streams. A PDF of a million rows is not a large PDF, it is the wrong format.
/// </summary>
public sealed class PdfDocument
{
    // A4 at 72 dpi, rounded to whole points. Letter would be the US default; A4 is what a
    // Costa Rican government agency prints on.
    private const double PageWidth = 595;
    private const double PageHeight = 842;
    private const double Margin = 56;

    private const double BodyFontSize = 9.5;
    private const double TableFontSize = 8.5;
    private const double LineGap = 1.35;

    private readonly List<StringBuilder> _pages = [];
    private readonly string _title;
    private StringBuilder _content;
    private double _y;

    /// <summary>Starts a one-page document whose <c>/Info</c> title is <paramref name="title"/>.</summary>
    public PdfDocument(string title)
    {
        _title = title ?? string.Empty;
        _content = NewPage();
    }

    /// <summary>Page width available to content, in points.</summary>
    public static double ContentWidth => PageWidth - (2 * Margin);

    /// <summary>How many pages the document has so far. One before anything is written.</summary>
    public int PageCount => _pages.Count;

    /// <summary>The document's main title, set once at the top of the first page.</summary>
    public void Title(string? text)
    {
        WriteWrapped(text, PdfStandardFont.Bold, 17, 0);
        _y -= 5;
    }

    /// <summary>A section heading. Starts a new page when too little room is left below it.</summary>
    /// <remarks>
    /// The widow guard is the whole reason this is not just <see cref="Paragraph"/> in bold: a
    /// heading stranded alone at the foot of a page, with its table overleaf, is the single
    /// most common defect in a hand-written paginator, and it is invisible until a real
    /// document is long enough to hit it.
    /// </remarks>
    public void Heading(string? text)
    {
        _y -= 8;
        EnsureRoom(60);
        WriteWrapped(text, PdfStandardFont.Bold, 12.5, 0);
        _y -= 3;
    }

    /// <summary>A sub-heading, one level below <see cref="Heading"/>.</summary>
    public void SubHeading(string? text)
    {
        _y -= 5;
        EnsureRoom(44);
        WriteWrapped(text, PdfStandardFont.Bold, 10, 0);
        _y -= 1;
    }

    /// <summary>A paragraph of body text, wrapped to the content width.</summary>
    public void Paragraph(string? text)
    {
        WriteWrapped(text, PdfStandardFont.Regular, BodyFontSize, 0);
        _y -= 3;
    }

    /// <summary>
    /// A run of label/value pairs, laid out as two columns.
    /// </summary>
    /// <remarks>
    /// A table would be the obvious tool and is the wrong one: a summary is a list of scalars
    /// with no shared column semantics, and rendering it with a header band invites a reader to
    /// compare rows that have nothing to do with each other.
    /// </remarks>
    public void KeyValues(IReadOnlyList<(string Label, string? Value)> pairs)
    {
        ArgumentNullException.ThrowIfNull(pairs);

        const double labelWidth = 190;
        foreach (var (label, value) in pairs)
        {
            var labelLines = WrapText(label, PdfStandardFont.Bold, BodyFontSize, labelWidth - 8);
            var valueLines = WrapText(value, PdfStandardFont.Regular, BodyFontSize, ContentWidth - labelWidth);
            var lineCount = Math.Max(labelLines.Count, valueLines.Count);
            var height = lineCount * BodyFontSize * LineGap;

            EnsureRoom(height);
            var top = _y;

            DrawLines(labelLines, Margin, top, PdfStandardFont.Bold, BodyFontSize);
            DrawLines(valueLines, Margin + labelWidth, top, PdfStandardFont.Regular, BodyFontSize);

            _y = top - height;
        }

        _y -= 4;
    }

    /// <summary>
    /// A table with a header band and wrapped cells.
    /// </summary>
    /// <remarks>
    /// Cells wrap rather than truncate. A survey question is a sentence, and a table that
    /// clipped it would produce a document in which two different questions can read
    /// identically -- a silent corruption, where a wrapped row is merely a tall one. The header
    /// band is repeated on every page the table spills onto, for the same reason: a continuation
    /// page whose columns are unlabelled is a page of unattributed numbers.
    /// </remarks>
    public void Table(IReadOnlyList<PdfTableColumn> columns, IReadOnlyList<IReadOnlyList<string?>> rows)
    {
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentNullException.ThrowIfNull(rows);
        if (columns.Count == 0)
        {
            throw new ArgumentException("A table needs at least one column.", nameof(columns));
        }

        var widths = ColumnWidths(columns);
        EnsureRoom(46);
        DrawTableHeader(columns, widths);

        foreach (var row in rows)
        {
            if (row.Count != columns.Count)
            {
                throw new ArgumentException(
                    $"Expected {columns.Count} cells to match the columns, got {row.Count}.",
                    nameof(rows));
            }

            var wrapped = new List<IReadOnlyList<string>>(row.Count);
            var lineCount = 1;
            for (var i = 0; i < row.Count; i++)
            {
                var lines = WrapText(row[i], PdfStandardFont.Regular, TableFontSize, widths[i] - 8);
                wrapped.Add(lines);
                lineCount = Math.Max(lineCount, lines.Count);
            }

            var height = (lineCount * TableFontSize * LineGap) + 4;
            if (_y - height < Margin)
            {
                StartPage();
                DrawTableHeader(columns, widths);
            }

            var top = _y - 2;
            var x = Margin;
            for (var i = 0; i < wrapped.Count; i++)
            {
                DrawLines(
                    wrapped[i],
                    x + 4,
                    top,
                    PdfStandardFont.Regular,
                    TableFontSize,
                    columns[i].RightAligned ? widths[i] - 8 : null);
                x += widths[i];
            }

            _y -= height;
            HorizontalRule(0.88);
        }

        _y -= 6;
    }

    /// <summary>Vertical space, in points.</summary>
    public void Spacer(double points) => _y -= points;

    /// <summary>Starts a new page. The current one is kept exactly as it is.</summary>
    public void StartPage()
    {
        _content = NewPage();
    }

    /// <summary>
    /// The document as PDF bytes.
    /// </summary>
    /// <remarks>
    /// Callable more than once and free of side effects on the layout, so a caller can hash or
    /// measure the output and still serve it.
    /// </remarks>
    public byte[] ToBytes()
    {
        // Object numbering: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then two
        // objects per page (the page dictionary and its content stream). Fixed rather than
        // allocated on demand, so the /Kids array can be written before the pages are.
        var pageCount = _pages.Count;
        var offsets = new long[5 + (2 * pageCount)];

        using var buffer = new MemoryStream();
        void Write(string ascii) => buffer.Write(Encoding.ASCII.GetBytes(ascii));

        void BeginObject(int number)
        {
            offsets[number] = buffer.Position;
            Write($"{number} 0 obj\n");
        }

        Write("%PDF-1.4\n");

        // A comment line of high bytes, as the specification recommends: it is what tells a
        // transfer that treats the file as text -- an FTP in ASCII mode, a mail gateway -- that
        // it is binary and must not be line-ending-translated.
        buffer.Write([(byte)'%', 0xE2, 0xE3, 0xCF, 0xD3, (byte)'\n']);

        BeginObject(1);
        Write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

        BeginObject(2);
        var kids = string.Join(" ", Enumerable.Range(0, pageCount).Select(i => $"{5 + (2 * i)} 0 R"));
        Write($"<< /Type /Pages /Kids [{kids}] /Count {pageCount.ToString(CultureInfo.InvariantCulture)} >>\nendobj\n");

        BeginObject(3);
        Write($"<< /Type /Font /Subtype /Type1 /BaseFont /{PdfStandardFontMetrics.BaseFontName(PdfStandardFont.Regular)} /Encoding /WinAnsiEncoding >>\nendobj\n");

        BeginObject(4);
        Write($"<< /Type /Font /Subtype /Type1 /BaseFont /{PdfStandardFontMetrics.BaseFontName(PdfStandardFont.Bold)} /Encoding /WinAnsiEncoding >>\nendobj\n");

        for (var i = 0; i < pageCount; i++)
        {
            var pageNumber = 5 + (2 * i);
            var contentNumber = pageNumber + 1;

            BeginObject(pageNumber);
            Write(
                "<< /Type /Page /Parent 2 0 R "
                + $"/MediaBox [0 0 {Num(PageWidth)} {Num(PageHeight)}] "
                + "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                + $"/Contents {contentNumber.ToString(CultureInfo.InvariantCulture)} 0 R >>\nendobj\n");

            var stream = Encoding.ASCII.GetBytes(_pages[i].ToString());
            BeginObject(contentNumber);
            Write($"<< /Length {stream.Length.ToString(CultureInfo.InvariantCulture)} >>\nstream\n");
            buffer.Write(stream);
            Write("\nendstream\nendobj\n");
        }

        var xrefOffset = buffer.Position;
        Write($"xref\n0 {offsets.Length.ToString(CultureInfo.InvariantCulture)}\n");
        Write("0000000000 65535 f \n");
        for (var i = 1; i < offsets.Length; i++)
        {
            Write($"{offsets[i].ToString("D10", CultureInfo.InvariantCulture)} 00000 n \n");
        }

        Write($"trailer\n<< /Size {offsets.Length.ToString(CultureInfo.InvariantCulture)} /Root 1 0 R /Info << /Title {LiteralString(_title)} >> >>\n");
        Write($"startxref\n{xrefOffset.ToString(CultureInfo.InvariantCulture)}\n%%EOF\n");

        return buffer.ToArray();
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    private StringBuilder NewPage()
    {
        var page = new StringBuilder();
        _pages.Add(page);
        _y = PageHeight - Margin;
        return page;
    }

    private void EnsureRoom(double height)
    {
        if (_y - height < Margin)
        {
            StartPage();
        }
    }

    private void WriteWrapped(string? text, PdfStandardFont font, double size, double indent)
    {
        var lines = WrapText(text, font, size, ContentWidth - indent);
        foreach (var line in lines)
        {
            EnsureRoom(size * LineGap);
            DrawText(line, Margin + indent, _y - size, font, size);
            _y -= size * LineGap;
        }
    }

    private void DrawLines(
        IReadOnlyList<string> lines,
        double x,
        double top,
        PdfStandardFont font,
        double size,
        double? rightAlignWidth = null)
    {
        for (var i = 0; i < lines.Count; i++)
        {
            var drawX = rightAlignWidth is double width
                ? x + width - PdfStandardFontMetrics.MeasureText(lines[i], font, size)
                : x;
            DrawText(lines[i], drawX, top - size - (i * size * LineGap), font, size);
        }
    }

    private double[] ColumnWidths(IReadOnlyList<PdfTableColumn> columns)
    {
        var total = columns.Sum(c => c.Weight);
        if (total <= 0)
        {
            throw new ArgumentException("Column weights must sum to more than zero.", nameof(columns));
        }

        return [.. columns.Select(c => ContentWidth * c.Weight / total)];
    }

    private void DrawTableHeader(IReadOnlyList<PdfTableColumn> columns, double[] widths)
    {
        var wrapped = new List<IReadOnlyList<string>>(columns.Count);
        var lineCount = 1;
        for (var i = 0; i < columns.Count; i++)
        {
            var lines = WrapText(columns[i].Header, PdfStandardFont.Bold, TableFontSize, widths[i] - 8);
            wrapped.Add(lines);
            lineCount = Math.Max(lineCount, lines.Count);
        }

        var height = (lineCount * TableFontSize * LineGap) + 5;
        FilledRectangle(Margin, _y - height, ContentWidth, height, 0.92);

        var top = _y - 2;
        var x = Margin;
        for (var i = 0; i < wrapped.Count; i++)
        {
            DrawLines(
                wrapped[i],
                x + 4,
                top,
                PdfStandardFont.Bold,
                TableFontSize,
                columns[i].RightAligned ? widths[i] - 8 : null);
            x += widths[i];
        }

        _y -= height;
        HorizontalRule(0.6);
    }

    private void HorizontalRule(double gray)
    {
        _content.Append(CultureInfo.InvariantCulture, $"q 0.4 w {Num(gray)} G {Num(Margin)} {Num(_y)} m {Num(PageWidth - Margin)} {Num(_y)} l S Q\n");
    }

    private void FilledRectangle(double x, double y, double width, double height, double gray)
    {
        _content.Append(CultureInfo.InvariantCulture, $"q {Num(gray)} g {Num(x)} {Num(y)} {Num(width)} {Num(height)} re f Q\n");
    }

    private void DrawText(string text, double x, double y, PdfStandardFont font, double size)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"BT /{PdfStandardFontMetrics.ResourceName(font)} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(y)} Tm {LiteralString(text)} Tj ET\n");
    }

    // ------------------------------------------------------------------
    // Text measurement
    // ------------------------------------------------------------------

    /// <summary>
    /// Breaks <paramref name="text"/> into lines that fit <paramref name="maxWidth"/>.
    /// </summary>
    /// <remarks>
    /// Greedy, on whitespace, with a character-level fallback for a single token wider than the
    /// column -- a URL, or a 40-character department name. Without the fallback such a token
    /// would produce one line that overruns the margin, which on a table means it overwrites the
    /// next column: an unreadable document rather than an ugly one. Always returns at least one
    /// line so a caller can size a row from <c>Count</c> without special-casing empty.
    /// </remarks>
    public static IReadOnlyList<string> WrapText(string? text, PdfStandardFont font, double size, double maxWidth)
    {
        if (string.IsNullOrWhiteSpace(text) || maxWidth <= 0)
        {
            return [string.Empty];
        }

        var lines = new List<string>();
        var current = new StringBuilder();

        foreach (var word in text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            if (PdfStandardFontMetrics.MeasureText(candidate, font, size) <= maxWidth)
            {
                current.Clear().Append(candidate);
                continue;
            }

            if (current.Length > 0)
            {
                lines.Add(current.ToString());
                current.Clear();
            }

            if (PdfStandardFontMetrics.MeasureText(word, font, size) <= maxWidth)
            {
                current.Append(word);
                continue;
            }

            foreach (var character in word)
            {
                if (PdfStandardFontMetrics.MeasureText($"{current}{character}", font, size) > maxWidth && current.Length > 0)
                {
                    lines.Add(current.ToString());
                    current.Clear();
                }

                current.Append(character);
            }
        }

        if (current.Length > 0)
        {
            lines.Add(current.ToString());
        }

        return lines.Count == 0 ? [string.Empty] : lines;
    }

    // ------------------------------------------------------------------
    // Serialisation primitives
    // ------------------------------------------------------------------

    /// <summary>A number as PDF real syntax: invariant, no exponent, at most two decimals.</summary>
    /// <remarks>
    /// A PDF real has no exponent form, so <c>1E-05</c> -- which is what a Spanish culture or a
    /// round-trip format would happily produce -- is a syntax error inside a content stream, and
    /// a comma for a decimal point is a second one. Both would corrupt the whole page, not one
    /// coordinate.
    /// </remarks>
    private static string Num(double value) => Math.Round(value, 2).ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>
    /// A PDF literal string: WinAnsi bytes, with the three characters that end one escaped and
    /// everything outside printable ASCII written as an octal escape.
    /// </summary>
    /// <remarks>
    /// Octal rather than raw high bytes so the whole content stream stays ASCII. A raw <c>0xF1</c>
    /// for <c>ñ</c> is legal PDF, but it means the file is no longer pure ASCII and any tool in
    /// the path that decides to re-encode it -- a diff, an editor, a log -- can corrupt exactly
    /// the accented characters a Spanish-language document is made of. The escape is three
    /// bytes instead of one; the file is a few percent larger and cannot be broken this way.
    /// </remarks>
    internal static string LiteralString(string? text)
    {
        var builder = new StringBuilder("(");
        foreach (var character in text ?? string.Empty)
        {
            var b = PdfStandardFontMetrics.Encode(character);
            switch (b)
            {
                case (byte)'(':
                case (byte)')':
                case (byte)'\\':
                    builder.Append('\\').Append((char)b);
                    break;
                default:
                    if (b is < 0x20 or > 0x7E)
                    {
                        builder.Append('\\').Append(Convert.ToString(b, 8).PadLeft(3, '0'));
                    }
                    else
                    {
                        builder.Append((char)b);
                    }

                    break;
            }
        }

        return builder.Append(')').ToString();
    }
}
