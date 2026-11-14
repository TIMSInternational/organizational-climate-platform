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

/// <summary>A colour in DeviceRGB, each channel from 0 to 1.</summary>
/// <remarks>
/// DeviceRGB rather than a calibrated space: the document is read on screens and printed on
/// office printers, and a calibrated space would be one more dictionary per page for a
/// difference nobody holding the paper can see.
/// </remarks>
public readonly record struct PdfColor(double R, double G, double B)
{
    /// <summary>Black, the colour every operator falls back to.</summary>
    public static readonly PdfColor Black = new(0, 0, 0);

    /// <summary>White.</summary>
    public static readonly PdfColor White = new(1, 1, 1);

    /// <summary>A neutral grey, 0 black to 1 white.</summary>
    public static PdfColor Gray(double level) => new(level, level, level);

    /// <summary>
    /// A colour from <c>#RRGGBB</c>, the notation the web's tokens and the canvas design use,
    /// so a PDF colour can be checked against the screen colour it stands for by reading both.
    /// </summary>
    public static PdfColor FromHex(string hex)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(hex);
        var digits = hex.TrimStart('#');
        if (digits.Length != 6
            || !int.TryParse(digits, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
        {
            throw new ArgumentException($"'{hex}' is not a #RRGGBB colour.", nameof(hex));
        }

        return new PdfColor(((value >> 16) & 0xFF) / 255d, ((value >> 8) & 0xFF) / 255d, (value & 0xFF) / 255d);
    }
}

/// <summary>Where a positioned run of text sits relative to the x it is drawn at.</summary>
public enum PdfTextAlign
{
    /// <summary>The text starts at x.</summary>
    Left,

    /// <summary>The text is centred on x.</summary>
    Center,

    /// <summary>The text ends at x.</summary>
    Right,
}

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
/// The trade is real and stated: no images, no font embedding, three base-14 faces.</item>
/// </list>
///
/// ## Charts are vector paths, not images (14 Nov 2026)
///
/// The survey report draws its charts -- the climate bar, the climate map, the answer
/// distributions -- with the four path operators every PDF reader has had since 1993:
/// rectangles, straight lines, Bezier curves (for circles and rounded corners) and fills in
/// DeviceRGB. That is what the decision record anticipated a chart would need and found it does
/// not: no raster image, no <c>/XObject</c>, no new dependency, and a chart that stays sharp at
/// any zoom and costs a few hundred bytes. See <c>docs/decisions/pdf-rendering.md</c>.
///
/// ## What it costs, stated
///
/// Base-14 fonts mean the document is limited to what WinAnsiEncoding can name -- which
/// covers Spanish completely (see <see cref="PdfStandardFontMetrics"/>) and does not cover, say,
/// Greek. A raster image -- a logo, a photograph -- would still need an <c>/XObject</c> and an
/// image decoder, and that remains the point at which this decision should be revisited.
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

    // Set the first time anything is drawn in Times-Bold. The font dictionary is written only
    // then, so a document that never uses the face -- every PDF this product made before the
    // survey report -- keeps exactly the objects, numbering and bytes it always had.
    private bool _usesSerif;

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

    /// <summary>
    /// One line at the foot of every page -- "Desarrollado por Nexadev" / "Powered by Nexadev",
    /// ruled 2026-10-21 with the same credit on every screen and every email. Null draws nothing.
    /// </summary>
    /// <remarks>
    /// Text only: this writer draws no images, by design (see the class summary). It is added
    /// as each page is written out rather than into the page while laying it out, so it sits in
    /// the bottom margin of every page however the content broke, and <see cref="ToBytes"/>
    /// stays free of side effects.
    /// </remarks>
    public string? Credit { get; set; }

    /// <summary>
    /// A running header drawn in the top margin of every page: <see cref="RunningHeaderBrand"/>
    /// in bold red, then this text in grey, on the left; the page number on the right. Null
    /// draws no header -- every document before the survey report.
    /// </summary>
    public string? RunningHeader { get; set; }

    /// <summary>The word the running header starts with, set in the brand colour ("OCC").</summary>
    public string? RunningHeaderBrand { get; set; }

    /// <summary>
    /// The page label at the right of the running header, as a composite format with the page
    /// number as <c>{0}</c> and the page count as <c>{1}</c> -- "Página {0} de {1}". Only
    /// <see cref="ToBytes"/> knows the count, which is why the header is written there, like
    /// <see cref="Credit"/>, and never laid out with the page.
    /// </summary>
    public string? PageLabelFormat { get; set; }

    /// <summary>The left edge of the content area, in points from the page's left.</summary>
    public static double ContentLeft => Margin;

    /// <summary>The right edge of the content area, in points from the page's left.</summary>
    public static double ContentRight => PageWidth - Margin;

    /// <summary>
    /// Where the next flowed element starts, in points from the page's BOTTOM (PDF space).
    /// Chart code reads it, draws below it with the positioned primitives, and then moves it
    /// with <see cref="Spacer"/> -- the flowed and positioned halves share one cursor.
    /// </summary>
    public double CursorY => _y;

    /// <summary>
    /// Makes sure <paramref name="height"/> points fit below the cursor, starting a new page
    /// when they do not, and returns the cursor. A chart reserves its whole height first so it
    /// is never split across a page break.
    /// </summary>
    public double Reserve(double height)
    {
        EnsureRoom(height);
        return _y;
    }

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

    /// <summary>A paragraph in a given face, size and colour, wrapped to the content width.</summary>
    public void Paragraph(string? text, PdfStandardFont font, double size, PdfColor color)
    {
        WriteWrapped(text, font, size, 0, color);
        _y -= 3;
    }

    /// <summary>The survey report's cover title: Times-Bold, 26pt.</summary>
    public void DisplayTitle(string? text)
    {
        WriteWrapped(text, PdfStandardFont.SerifBold, 26, 0);
        _y -= 4;
    }

    /// <summary>
    /// A report section title in Times-Bold with an optional grey line under it, kept with at
    /// least <paramref name="keepWithNext"/> points of what follows, so a title never ends a page.
    /// </summary>
    public void SectionTitle(string? title, string? subtitle = null, double keepWithNext = 90)
    {
        _y -= 10;
        EnsureRoom(keepWithNext + 24);
        WriteWrapped(title, PdfStandardFont.SerifBold, 17, 0);
        if (!string.IsNullOrWhiteSpace(subtitle))
        {
            _y -= 1;
            WriteWrapped(subtitle, PdfStandardFont.Regular, 8.5, 0, MutedInk);
        }

        _y -= 6;
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
        // objects per page (the page dictionary and its content stream), and last the
        // document information dictionary. Fixed rather than allocated on demand, so the
        // /Kids array can be written before the pages are.
        var pageCount = _pages.Count;

        // Times-Bold, when used, takes the number after the last content stream and pushes the
        // information dictionary one along. Appended rather than inserted, so the numbering of
        // every object a document without it has is unchanged.
        var serifNumber = _usesSerif ? 5 + (2 * pageCount) : 0;
        var infoNumber = 5 + (2 * pageCount) + (_usesSerif ? 1 : 0);
        var offsets = new long[infoNumber + 1];
        var fontResources = _usesSerif
            ? $"/F1 3 0 R /F2 4 0 R /F3 {serifNumber.ToString(CultureInfo.InvariantCulture)} 0 R"
            : "/F1 3 0 R /F2 4 0 R";

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
                + $"/Resources << /Font << {fontResources} >> >> "
                + $"/Contents {contentNumber.ToString(CultureInfo.InvariantCulture)} 0 R >>\nendobj\n");

            var stream = Encoding.ASCII.GetBytes(_pages[i].ToString() + HeaderOperators(i + 1, pageCount) + CreditOperators());
            BeginObject(contentNumber);
            Write($"<< /Length {stream.Length.ToString(CultureInfo.InvariantCulture)} >>\nstream\n");
            buffer.Write(stream);
            Write("\nendstream\nendobj\n");
        }

        if (_usesSerif)
        {
            BeginObject(serifNumber);
            Write($"<< /Type /Font /Subtype /Type1 /BaseFont /{PdfStandardFontMetrics.BaseFontName(PdfStandardFont.SerifBold)} /Encoding /WinAnsiEncoding >>\nendobj\n");
        }

        // ISO 32000-1:2008 Table 15: /Info "shall be an indirect reference". Writing the
        // dictionary inline in the trailer produces a file that most viewers still render --
        // they read /Info only for the title bar -- but that a strict parser and every PDF/A
        // validator rejects. It costs one object to be correct.
        BeginObject(infoNumber);
        Write($"<< /Title {LiteralString(_title)} >>\nendobj\n");

        var xrefOffset = buffer.Position;
        Write($"xref\n0 {offsets.Length.ToString(CultureInfo.InvariantCulture)}\n");
        Write("0000000000 65535 f \n");
        for (var i = 1; i < offsets.Length; i++)
        {
            Write($"{offsets[i].ToString("D10", CultureInfo.InvariantCulture)} 00000 n \n");
        }

        Write(
            $"trailer\n<< /Size {offsets.Length.ToString(CultureInfo.InvariantCulture)} "
            + $"/Root 1 0 R /Info {infoNumber.ToString(CultureInfo.InvariantCulture)} 0 R >>\n");
        Write($"startxref\n{xrefOffset.ToString(CultureInfo.InvariantCulture)}\n%%EOF\n");

        return buffer.ToArray();
    }

    // ------------------------------------------------------------------
    // Positioned drawing (charts)
    //
    // Every coordinate is in PDF space -- points from the page's bottom-left corner -- on the
    // CURRENT page. None of these moves the cursor or breaks a page: a chart reserves its
    // height with Reserve first, draws, then moves the cursor with Spacer.
    // ------------------------------------------------------------------

    /// <summary>The grey of secondary text: captions, axis labels, subtitles.</summary>
    public static readonly PdfColor MutedInk = PdfColor.FromHex("#6E6E73");

    /// <summary>
    /// A filled rectangle with its bottom-left corner at (<paramref name="x"/>,
    /// <paramref name="y"/>), corners rounded by <paramref name="radius"/>.
    /// </summary>
    public void FillRectangle(double x, double y, double width, double height, PdfColor color, double radius = 0)
    {
        if (width <= 0 || height <= 0)
        {
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"q {FillColor(color)} ");
        AppendRectanglePath(x, y, width, height, radius);
        _content.Append("f Q\n");
    }

    /// <summary>The outline of a rectangle, corners rounded by <paramref name="radius"/>.</summary>
    public void StrokeRectangle(double x, double y, double width, double height, PdfColor color, double lineWidth = 0.6, double radius = 0)
    {
        if (width <= 0 || height <= 0)
        {
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"q {Num(lineWidth)} w {StrokeColor(color)} ");
        AppendRectanglePath(x, y, width, height, radius);
        _content.Append("S Q\n");
    }

    /// <summary>A straight line.</summary>
    public void StrokeLine(double x1, double y1, double x2, double y2, PdfColor color, double lineWidth = 0.6)
    {
        _content.Append(CultureInfo.InvariantCulture, $"q {Num(lineWidth)} w {StrokeColor(color)} {Num(x1)} {Num(y1)} m {Num(x2)} {Num(y2)} l S Q\n");
    }

    /// <summary>A filled circle.</summary>
    public void FillCircle(double centerX, double centerY, double radius, PdfColor color)
    {
        if (radius <= 0)
        {
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"q {FillColor(color)} ");
        AppendCirclePath(centerX, centerY, radius);
        _content.Append("f Q\n");
    }

    /// <summary>The outline of a circle.</summary>
    public void StrokeCircle(double centerX, double centerY, double radius, PdfColor color, double lineWidth = 0.6)
    {
        if (radius <= 0)
        {
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"q {Num(lineWidth)} w {StrokeColor(color)} ");
        AppendCirclePath(centerX, centerY, radius);
        _content.Append("S Q\n");
    }

    /// <summary>A filled polygon through <paramref name="points"/>, closed back to the first.</summary>
    public void FillPolygon(IReadOnlyList<(double X, double Y)> points, PdfColor color)
    {
        ArgumentNullException.ThrowIfNull(points);
        if (points.Count < 3)
        {
            throw new ArgumentException("A polygon needs at least three points.", nameof(points));
        }

        _content.Append(CultureInfo.InvariantCulture, $"q {FillColor(color)} {Num(points[0].X)} {Num(points[0].Y)} m ");
        for (var i = 1; i < points.Count; i++)
        {
            _content.Append(CultureInfo.InvariantCulture, $"{Num(points[i].X)} {Num(points[i].Y)} l ");
        }

        _content.Append("h f Q\n");
    }

    /// <summary>
    /// One line of text with its baseline at <paramref name="baselineY"/>, never wrapped.
    /// </summary>
    /// <remarks>
    /// For chart labels, whose width the caller has already decided. Text that may not fit is
    /// the caller's to shorten with <see cref="Fit"/>, because a label that overran its column
    /// would be drawn over the next one.
    /// </remarks>
    public void DrawString(
        string? text,
        double x,
        double baselineY,
        PdfStandardFont font,
        double size,
        PdfColor? color = null,
        PdfTextAlign align = PdfTextAlign.Left)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        var width = PdfStandardFontMetrics.MeasureText(text, font, size);
        var drawX = align switch
        {
            PdfTextAlign.Center => x - (width / 2),
            PdfTextAlign.Right => x - width,
            _ => x,
        };

        DrawText(text, drawX, baselineY, font, size, color);
    }

    /// <summary>
    /// <paramref name="text"/> shortened with an ellipsis until it fits
    /// <paramref name="maxWidth"/>; unchanged when it already does.
    /// </summary>
    public static string Fit(string? text, PdfStandardFont font, double size, double maxWidth)
    {
        if (string.IsNullOrEmpty(text) || PdfStandardFontMetrics.MeasureText(text, font, size) <= maxWidth)
        {
            return text ?? string.Empty;
        }

        const string ellipsis = "\u2026";
        var end = text.Length;
        while (end > 0 && PdfStandardFontMetrics.MeasureText(text[..end].TrimEnd() + ellipsis, font, size) > maxWidth)
        {
            end--;
        }

        return end == 0 ? ellipsis : text[..end].TrimEnd() + ellipsis;
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

    private void WriteWrapped(string? text, PdfStandardFont font, double size, double indent, PdfColor? color = null)
    {
        var lines = WrapText(text, font, size, ContentWidth - indent);
        foreach (var line in lines)
        {
            EnsureRoom(size * LineGap);
            DrawText(line, Margin + indent, _y - size, font, size, color);
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

    private void DrawText(string text, double x, double y, PdfStandardFont font, double size, PdfColor? color = null)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        if (font == PdfStandardFont.SerifBold)
        {
            _usesSerif = true;
        }

        // Uncoloured text is written exactly as it always was -- no q/Q, no colour operator --
        // so every document that existed before colour keeps its bytes.
        if (color is { } fill)
        {
            _content.Append(CultureInfo.InvariantCulture, $"q {FillColor(fill)} BT /{PdfStandardFontMetrics.ResourceName(font)} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(y)} Tm {LiteralString(text)} Tj ET Q\n");
            return;
        }

        _content.Append(CultureInfo.InvariantCulture, $"BT /{PdfStandardFontMetrics.ResourceName(font)} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(y)} Tm {LiteralString(text)} Tj ET\n");
    }

    private static string FillColor(PdfColor color)
        => string.Create(CultureInfo.InvariantCulture, $"{Num(color.R)} {Num(color.G)} {Num(color.B)} rg");

    private static string StrokeColor(PdfColor color)
        => string.Create(CultureInfo.InvariantCulture, $"{Num(color.R)} {Num(color.G)} {Num(color.B)} RG");

    private void AppendRectanglePath(double x, double y, double width, double height, double radius)
    {
        var r = Math.Min(Math.Max(radius, 0), Math.Min(width, height) / 2);
        if (r <= 0)
        {
            _content.Append(CultureInfo.InvariantCulture, $"{Num(x)} {Num(y)} {Num(width)} {Num(height)} re ");
            return;
        }

        // Four lines and four quarter-circle Beziers, anticlockwise from the bottom edge.
        var k = r * BezierCircle;
        var right = x + width;
        var top = y + height;
        _content.Append(CultureInfo.InvariantCulture, $"{Num(x + r)} {Num(y)} m ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(right - r)} {Num(y)} l ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(right - r + k)} {Num(y)} {Num(right)} {Num(y + r - k)} {Num(right)} {Num(y + r)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(right)} {Num(top - r)} l ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(right)} {Num(top - r + k)} {Num(right - r + k)} {Num(top)} {Num(right - r)} {Num(top)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(x + r)} {Num(top)} l ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(x + r - k)} {Num(top)} {Num(x)} {Num(top - r + k)} {Num(x)} {Num(top - r)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(x)} {Num(y + r)} l ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(x)} {Num(y + r - k)} {Num(x + r - k)} {Num(y)} {Num(x + r)} {Num(y)} c h ");
    }

    private void AppendCirclePath(double cx, double cy, double r)
    {
        // The standard four-Bezier circle: control points at r * 0.5523 from each anchor, which
        // stays within 0.03% of a true circle -- invisible at any size a chart uses.
        var k = r * BezierCircle;
        _content.Append(CultureInfo.InvariantCulture, $"{Num(cx + r)} {Num(cy)} m ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(cx + r)} {Num(cy + k)} {Num(cx + k)} {Num(cy + r)} {Num(cx)} {Num(cy + r)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(cx - k)} {Num(cy + r)} {Num(cx - r)} {Num(cy + k)} {Num(cx - r)} {Num(cy)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(cx - r)} {Num(cy - k)} {Num(cx - k)} {Num(cy - r)} {Num(cx)} {Num(cy - r)} c ");
        _content.Append(CultureInfo.InvariantCulture, $"{Num(cx + k)} {Num(cy - r)} {Num(cx + r)} {Num(cy - k)} {Num(cx + r)} {Num(cy)} c h ");
    }

    /// <summary>
    /// The running header as page-content operators: the brand word in bold red and the header
    /// text in grey at the left, the page label at the right, over a hairline. Empty when there
    /// is no header.
    /// </summary>
    private string HeaderOperators(int pageNumber, int pageCount)
    {
        if (string.IsNullOrWhiteSpace(RunningHeader) && string.IsNullOrWhiteSpace(PageLabelFormat))
        {
            return string.Empty;
        }

        const double size = 7.5;
        var baseline = PageHeight - (Margin / 2) - 2;
        var builder = new StringBuilder();
        var regular = PdfStandardFontMetrics.ResourceName(PdfStandardFont.Regular);
        var bold = PdfStandardFontMetrics.ResourceName(PdfStandardFont.Bold);

        var x = Margin;
        if (!string.IsNullOrWhiteSpace(RunningHeaderBrand))
        {
            builder.Append(CultureInfo.InvariantCulture, $"q {FillColor(BrandRed)} BT /{bold} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(baseline)} Tm {LiteralString(RunningHeaderBrand)} Tj ET Q\n");
            x += PdfStandardFontMetrics.MeasureText(RunningHeaderBrand + " ", PdfStandardFont.Bold, size);
        }

        var label = string.IsNullOrWhiteSpace(PageLabelFormat)
            ? string.Empty
            : string.Format(CultureInfo.InvariantCulture, PageLabelFormat, pageNumber, pageCount);
        var labelWidth = PdfStandardFontMetrics.MeasureText(label, PdfStandardFont.Regular, size);

        if (!string.IsNullOrWhiteSpace(RunningHeader))
        {
            var room = PageWidth - Margin - labelWidth - 16 - x;
            var header = Fit(RunningHeader, PdfStandardFont.Regular, size, room);
            builder.Append(CultureInfo.InvariantCulture, $"q {FillColor(MutedInk)} BT /{regular} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(baseline)} Tm {LiteralString(header)} Tj ET Q\n");
        }

        if (label.Length > 0)
        {
            builder.Append(CultureInfo.InvariantCulture, $"q {FillColor(MutedInk)} BT /{regular} {Num(size)} Tf 1 0 0 1 {Num(PageWidth - Margin - labelWidth)} {Num(baseline)} Tm {LiteralString(label)} Tj ET Q\n");
        }

        builder.Append(CultureInfo.InvariantCulture, $"q 0.4 w {StrokeColor(HairlineInk)} {Num(Margin)} {Num(baseline - 6)} m {Num(PageWidth - Margin)} {Num(baseline - 6)} l S Q\n");
        return builder.ToString();
    }

    // The OCC red (web/public/brand, #FB1724) and the separator grey of the canvas design.
    private static readonly PdfColor BrandRed = PdfColor.FromHex("#FB1724");
    private static readonly PdfColor HairlineInk = PdfColor.FromHex("#E5E7EB");

    // 4 * (sqrt(2) - 1) / 3: the Bezier control distance that best approximates a quarter circle.
    private const double BezierCircle = 0.5523;

    /// <summary>
    /// The credit as page-content operators: 7.5pt, centred, mid-grey (0.45), halfway down the
    /// bottom margin. Empty when there is none.
    /// </summary>
    private string CreditOperators()
    {
        if (string.IsNullOrWhiteSpace(Credit))
        {
            return string.Empty;
        }

        const double size = 7.5;
        var x = (PageWidth - PdfStandardFontMetrics.MeasureText(Credit, PdfStandardFont.Regular, size)) / 2;
        var y = Margin / 2;
        return string.Create(
            CultureInfo.InvariantCulture,
            $"q 0.45 g BT /{PdfStandardFontMetrics.ResourceName(PdfStandardFont.Regular)} {Num(size)} Tf 1 0 0 1 {Num(x)} {Num(y)} Tm {LiteralString(Credit)} Tj ET Q\n");
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
