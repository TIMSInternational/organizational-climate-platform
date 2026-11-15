using System.Globalization;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClosedXML.Excel;
using ClosedXML.Excel.Drawings;

namespace ClimateProject.Application.Exports;

/// <summary>
/// The company identity a workbook wears: its logo on the cover and its colour on every header.
///
/// <para>
/// <b>The same white-labelling as the emails.</b> <see cref="EmailBrand"/> puts the tenant's logo in
/// the masthead and keeps the product to a credit line; a workbook does the same, so the file a
/// client forwards is theirs and not ours. The colour is the one they chose in «Marca», with black
/// or white text picked by contrast exactly as the email button does, because
/// <see cref="BrandingValidation"/> checks that a colour is six hex digits, not that it is dark.
/// </para>
///
/// <para>
/// <b>Only PNG and JPEG can be drawn.</b> Excel embeds neither WebP nor SVG, and there is no image
/// library here to convert one (no new dependency, <c>docs/decisions/pdf-rendering.md</c>). A logo
/// in another format is not drawn and the cover prints the company's name in its place: a missing
/// picture is a smaller fault than a download that fails because of one.
/// </para>
/// </summary>
/// <param name="CompanyName">The name the cover prints when there is no logo, and the page header's text.</param>
/// <param name="Logo">The logo's bytes, or null. Anything that is not PNG or JPEG is ignored.</param>
/// <param name="PrimaryColor">The company's «Marca» colour, <c>#rrggbb</c>. Null or invalid falls back to the product navy.</param>
public sealed record WorkbookBrand(string? CompanyName, byte[]? Logo, string? PrimaryColor)
{
    /// <summary>The product's own navy, worn by a file that spans companies or has no brand.</summary>
    public const string ProductAccent = "#0F1A33";

    /// <summary>No tenant: a file across several companies, or one built where no company is known.</summary>
    public static WorkbookBrand Product(string? label = null) => new(label, null, null);

    /// <summary>The header colour, falling back to the product navy.</summary>
    public string Accent => WorkbookPalette.IsHex(PrimaryColor) ? PrimaryColor!.Trim().ToUpperInvariant() : ProductAccent;

    /// <summary>Black or white, whichever a reader can see on <see cref="Accent"/>.</summary>
    public string OnAccent => WorkbookPalette.InkOn(Accent);

    /// <summary>The logo's format, or null when there is nothing Excel can draw.</summary>
    public XLPictureFormat? LogoFormat => Logo is null ? null : CompanyLogoValidation.ContentTypeOf(Logo) switch
    {
        "image/png" => XLPictureFormat.Png,
        "image/jpeg" => XLPictureFormat.Jpeg,
        _ => null,
    };
}

/// <summary>
/// The colours every workbook shares. The meaning colours are the PDF report's own
/// (<c>SurveyReportPdf.Palette</c>), so an área de fortaleza is the same green in the report, the
/// results screen and the Excel file -- and they never follow the brand: a client whose colour is
/// red must not turn every header into an área crítica.
/// </summary>
public static class WorkbookPalette
{
    public const string Ink = "#1D1D1F";
    public const string Secondary = "#6E6E73";
    public const string Rule = "#E5E7EB";
    public const string Quiet = "#F5F5F7";
    public const string Protected = "#F2F2F4";

    public const string StrengthFill = "#E6F4EA";
    public const string StrengthInk = "#156B32";
    public const string OpportunityFill = "#FFF3D6";
    public const string OpportunityInk = "#8A5300";
    public const string CriticalFill = "#FDECEA";
    public const string CriticalInk = "#B42318";

    /// <summary>True for <c>#rrggbb</c>.</summary>
    public static bool IsHex(string? value)
    {
        var trimmed = value?.Trim();
        return trimmed is { Length: 7 } && trimmed[0] == '#'
            && trimmed.Skip(1).All(Uri.IsHexDigit);
    }

    /// <summary>
    /// Black or white on <paramref name="background"/>: WCAG relative luminance, with the threshold
    /// where contrast against both is equal (about 0.179), the rule <see cref="EmailBrand"/> uses.
    /// </summary>
    public static string InkOn(string background) => Luminance(background) > 0.179 ? "#0B1524" : "#FFFFFF";

    /// <summary><paramref name="hex"/> mixed toward black by <paramref name="amount"/> (0..1).</summary>
    public static string Darken(string hex, double amount) => Mix(hex, 0, amount);

    /// <summary><paramref name="hex"/> mixed toward white by <paramref name="amount"/> (0..1).</summary>
    public static string Lighten(string hex, double amount) => Mix(hex, 255, amount);

    internal static double Luminance(string hex)
    {
        var (r, g, b) = Channels(hex);
        static double Linear(int channel)
        {
            var c = channel / 255d;
            return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }

        return (0.2126 * Linear(r)) + (0.7152 * Linear(g)) + (0.0722 * Linear(b));
    }

    private static string Mix(string hex, int toward, double amount)
    {
        var (r, g, b) = Channels(hex);
        int Step(int c) => (int)Math.Round(c + ((toward - c) * Math.Clamp(amount, 0, 1)));
        return $"#{Step(r):X2}{Step(g):X2}{Step(b):X2}";
    }

    private static (int R, int G, int B) Channels(string hex)
    {
        var h = hex.Trim().TrimStart('#');
        return (
            int.Parse(h[..2], NumberStyles.HexNumber, CultureInfo.InvariantCulture),
            int.Parse(h[2..4], NumberStyles.HexNumber, CultureInfo.InvariantCulture),
            int.Parse(h[4..6], NumberStyles.HexNumber, CultureInfo.InvariantCulture));
    }
}

/// <summary>
/// The table chrome every data sheet shares: a header band in the brand colour, a hairline under
/// each row, room around the text, and a page that prints.
///
/// <para>
/// <b>Style only, never a value.</b> Nothing here writes a cell's value or merges a range that holds
/// data: a merge keeps the top-left value and blanks the rest, which once cost a client deliverable
/// 69 cells. The cover sheet is the only place cells are merged, and it holds only text written for it.
/// </para>
/// </summary>
public static class WorkbookStyle
{
    /// <summary>The body row height, in points: Excel's 15 leaves no air around 11-point text.</summary>
    public const double BodyRowHeight = 20;

    /// <summary>The header row height, in points, room for a two-line wrapped header.</summary>
    public const double HeaderRowHeight = 32;

    /// <summary>Paints a header row in the brand colour.</summary>
    public static void Header(IXLRange header, WorkbookBrand brand)
    {
        header.Style.Fill.BackgroundColor = XLColor.FromHtml(brand.Accent);
        header.Style.Font.FontColor = XLColor.FromHtml(brand.OnAccent);
        header.Style.Font.Bold = true;
        header.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        header.Style.Alignment.WrapText = true;
        header.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
        header.Style.Border.BottomBorderColor = XLColor.FromHtml(WorkbookPalette.Darken(brand.Accent, 0.25));
    }

    /// <summary>A table body: vertically centred text and a hairline under every row.</summary>
    public static void Body(IXLRange body)
    {
        body.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        body.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
        body.Style.Border.BottomBorderColor = XLColor.FromHtml(WorkbookPalette.Rule);
    }

    /// <summary>
    /// Row heights from the text: <paramref name="minimum"/> points for a one-line row, and enough
    /// for every line of the tallest WRAPPED cell. Set after the column widths, which it reads.
    ///
    /// <para>
    /// A fixed height clips a wrapped question to its first line, and no height at all leaves
    /// Excel's 15 points, which is cramped; Excel does not refit a row it was given a height for,
    /// so the height has to be right when it is written. Characters per line is the column width
    /// times 1.15, because a width counts the digit "0" and prose is narrower on average.
    /// </para>
    /// </summary>
    public static void Rows(IXLWorksheet sheet, int firstRow, int lastRow, int firstColumn, int lastColumn, double minimum = BodyRowHeight)
    {
        for (var row = firstRow; row <= lastRow; row++)
        {
            var lines = 1;
            for (var column = firstColumn; column <= lastColumn; column++)
            {
                var cell = sheet.Cell(row, column);
                if (!cell.Style.Alignment.WrapText || cell.IsEmpty())
                {
                    continue;
                }

                var perLine = Math.Max(4, (int)(sheet.Column(column).Width * 1.15));
                var needed = cell.GetFormattedString()
                    .Split('\n')
                    .Sum(paragraph => Math.Max(1, (int)Math.Ceiling(paragraph.Length / (double)perLine)));
                lines = Math.Max(lines, needed);
            }

            sheet.Row(row).Height = Math.Max(minimum, (lines * 14.5) + 6);
        }
    }

    /// <summary>A sheet title: large, ink, and a quiet line under it.</summary>
    public static void Title(IXLCell title, IXLCell? subtitle = null)
    {
        title.Style.Font.Bold = true;
        title.Style.Font.FontSize = 16;
        title.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Ink);
        title.WorksheetRow().Height = 26;
        if (subtitle is not null)
        {
            subtitle.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
        }
    }

    /// <summary>A section label inside a sheet: bold, with the brand colour as a rule under it.</summary>
    public static void Section(IXLRange label, WorkbookBrand brand)
    {
        label.Style.Font.Bold = true;
        label.Style.Font.FontSize = 12;
        label.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Ink);
        label.Style.Border.BottomBorder = XLBorderStyleValues.Medium;
        label.Style.Border.BottomBorderColor = XLColor.FromHtml(brand.Accent);
        label.Style.Alignment.Vertical = XLAlignmentVerticalValues.Bottom;
        label.Worksheet.Row(label.RangeAddress.FirstAddress.RowNumber).Height = 24;
    }

    /// <summary>A meaning colour on a cell: its fill and the darker ink that reads on it.</summary>
    public static void Tone(IXLCell cell, string fill, string ink)
    {
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml(fill);
        cell.Style.Font.FontColor = XLColor.FromHtml(ink);
    }

    /// <summary>
    /// A sheet that prints: landscape or portrait, one page wide, the header row repeated, the
    /// company in the page header and the product and page number in the footer.
    /// </summary>
    public static void Print(IXLWorksheet sheet, WorkbookBrand brand, bool spanish, int? repeatRow = null, bool landscape = true)
    {
        var page = sheet.PageSetup;
        page.PageOrientation = landscape ? XLPageOrientation.Landscape : XLPageOrientation.Portrait;
        page.FitToPages(1, 0);
        // Letter, always. A3 for wide sheets was tried and measured: Excel on a Mac whose printer
        // has no A3 clipped the page's top instead of scaling it. The header and footer sit in their
        // own 0.3" band inside a 0.75" margin, so neither can print over the first or last row.
        page.PaperSize = XLPaperSize.LetterPaper;
        page.Margins.Left = 0.4;
        page.Margins.Right = 0.4;
        page.Margins.Top = 0.75;
        page.Margins.Bottom = 0.75;
        page.Margins.Header = 0.3;
        page.Margins.Footer = 0.3;
        page.CenterHorizontally = false;
        if (repeatRow is { } row)
        {
            page.SetRowsToRepeatAtTop(row, row);
        }

        if (!string.IsNullOrWhiteSpace(brand.CompanyName))
        {
            page.Header.Left.AddText(brand.CompanyName!, XLHFOccurrence.AllPages);
        }

        page.Header.Right.AddText(sheet.Name, XLHFOccurrence.AllPages);
        page.Footer.Left.AddText(EmailBranding.ProductName, XLHFOccurrence.AllPages);
        page.Footer.Right.AddText(spanish ? "Página " : "Page ", XLHFOccurrence.AllPages);
        page.Footer.Right.AddText(XLHFPredefinedText.PageNumber, XLHFOccurrence.AllPages);
        page.Footer.Right.AddText(spanish ? " de " : " of ", XLHFOccurrence.AllPages);
        page.Footer.Right.AddText(XLHFPredefinedText.NumberOfPages, XLHFOccurrence.AllPages);
    }

    /// <summary>
    /// Column widths from the text, sized to the longest WORD of a wrapped column and the longest
    /// line of a plain one, clamped. A wrapped header cannot save a single long word: "Evaluación"
    /// at width 7 prints "Evalua", which is why the header's words count too.
    /// </summary>
    public static void Widths(IXLWorksheet sheet, int headerRow, int firstRow, int lastRow, int firstColumn, int lastColumn, double min = 8, double max = 48)
    {
        for (var column = firstColumn; column <= lastColumn; column++)
        {
            var longest = sheet.Cell(headerRow, column).GetString()
                .Split([' ', '\n'], StringSplitOptions.RemoveEmptyEntries)
                .Select(w => w.Length)
                .DefaultIfEmpty(0)
                .Max();
            for (var row = firstRow; row <= lastRow; row++)
            {
                var cell = sheet.Cell(row, column);
                if (cell.IsEmpty())
                {
                    continue;
                }

                var text = cell.GetFormattedString();
                var length = cell.Style.Alignment.WrapText
                    ? text.Split([' ', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(w => w.Length).DefaultIfEmpty(0).Max()
                    : text.Length;
                longest = Math.Max(longest, length);
            }

            sheet.Column(column).Width = Math.Clamp(longest + 3, min, max);
        }
    }
}

/// <summary>Words several workbooks print the same way.</summary>
public static class WorkbookWords
{
    /// <summary>A survey's status as a reader says it, not as the database stores it.</summary>
    public static string SurveyStatus(string status, bool spanish) => status switch
    {
        Surveys.SurveyStatuses.Draft => spanish ? "Borrador" : "Draft",
        Surveys.SurveyStatuses.Scheduled => spanish ? "Programada" : "Scheduled",
        Surveys.SurveyStatuses.Active => spanish ? "Activa" : "Active",
        Surveys.SurveyStatuses.Closed => spanish ? "Cerrada" : "Closed",
        Surveys.SurveyStatuses.Archived => spanish ? "Archivada" : "Archived",
        _ => status,
    };
}

/// <summary>What one workbook's cover says.</summary>
/// <param name="Title">What the file is: «Resultados agregados».</param>
/// <param name="Subtitle">The company and the surveys it covers.</param>
/// <param name="Generated">When it was built, already worded.</param>
/// <param name="Sheets">Every other sheet, with what it holds.</param>
/// <param name="Legend">What each colour means, if the file uses any.</param>
/// <param name="Notes">What a reader must know before using the numbers.</param>
/// <param name="Notice">A line that must not be missed, drawn in a box: who may hold this file.</param>
public sealed record WorkbookCoverContent(
    string Title,
    string Subtitle,
    string Generated,
    IReadOnlyList<WorkbookCoverSheet> Sheets,
    IReadOnlyList<WorkbookCoverLegend> Legend,
    IReadOnlyList<string> Notes,
    string? Notice = null);

/// <summary>One line of the cover's contents: a sheet, linked, and what is in it.</summary>
public sealed record WorkbookCoverSheet(string Name, string Description);

/// <summary>One colour on the cover: a swatch with its label, and what it means.</summary>
public sealed record WorkbookCoverLegend(string Fill, string Ink, string Label, string Meaning);

/// <summary>
/// The cover sheet: the client's logo, what the file is, a linked list of its sheets, what the
/// colours mean and the notes a reader needs.
///
/// <para>
/// <b>A cover, not a masthead on every sheet (ruled by Federico, 14 Nov 2026).</b> TIMS's own
/// scripts read these files with row 1 as the header (<c>esph-respuestas-combinar.py</c>,
/// <c>esph-lista-con-resultados.py</c>, <c>esph-respuestas-formato-2024.py</c>), and they find
/// their sheets by NAME. A first sheet moves no data; a logo band above each table would have
/// moved every header down and broken them silently.
/// </para>
/// </summary>
public static class WorkbookCover
{
    private const int First = 2;
    private const int Last = 4;

    /// <summary>Adds the cover as the first sheet and opens the file on it.</summary>
    public static IXLWorksheet Insert(XLWorkbook book, WorkbookBrand brand, WorkbookCoverContent content, bool spanish)
    {
        ArgumentNullException.ThrowIfNull(book);
        ArgumentNullException.ThrowIfNull(brand);
        ArgumentNullException.ThrowIfNull(content);

        var name = spanish ? "Portada" : "Cover";
        if (book.Worksheets.Any(w => string.Equals(w.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            name = spanish ? "Portada del archivo" : "File cover";
        }

        var sheet = book.AddWorksheet(name, 1);
        sheet.ShowGridLines = false;
        sheet.SetTabColor(XLColor.FromHtml(brand.Accent));
        sheet.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Ink);
        sheet.Column(1).Width = 3;
        sheet.Column(2).Width = 30;
        sheet.Column(3).Width = 64;
        sheet.Column(4).Width = 3;

        // The masthead: the client's logo, or their name where no logo can be drawn.
        var row = 2;
        sheet.Row(row).Height = 54;
        if (!TryDrawLogo(sheet, brand, row))
        {
            var masthead = sheet.Cell(row, First);
            masthead.Value = string.IsNullOrWhiteSpace(brand.CompanyName) ? "OCC" : brand.CompanyName;
            masthead.Style.Font.FontSize = 20;
            masthead.Style.Font.Bold = true;
            masthead.Style.Alignment.Vertical = XLAlignmentVerticalValues.Bottom;
        }

        row += 2;
        var title = sheet.Cell(row, First);
        title.Value = content.Title;
        title.Style.Font.FontSize = 24;
        title.Style.Font.Bold = true;
        sheet.Row(row).Height = 34;
        row++;
        Line(sheet, row++, content.Subtitle, WorkbookPalette.Ink, 12);
        Line(sheet, row++, content.Generated, WorkbookPalette.Secondary, 11);

        // The brand colour as a rule under the masthead.
        row++;
        var rule = sheet.Range(row, First, row, Last - 1);
        rule.Style.Fill.BackgroundColor = XLColor.FromHtml(brand.Accent);
        sheet.Row(row).Height = 4;
        row += 2;

        if (!string.IsNullOrWhiteSpace(content.Notice))
        {
            var notice = sheet.Range(row, First, row, Last - 1);
            notice.Merge();
            notice.FirstCell().Value = content.Notice;
            notice.Style.Font.Bold = true;
            notice.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.CriticalInk);
            notice.Style.Fill.BackgroundColor = XLColor.FromHtml(WorkbookPalette.CriticalFill);
            notice.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            notice.Style.Border.OutsideBorderColor = XLColor.FromHtml(WorkbookPalette.CriticalInk);
            notice.Style.Alignment.WrapText = true;
            notice.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            notice.Style.Alignment.Indent = 1;
            sheet.Row(row).Height = HeightFor(content.Notice!, 90, 18);
            row += 2;
        }

        // Contents, each sheet linked.
        Heading(sheet, row++, spanish ? "Contenido" : "Contents", brand);
        foreach (var entry in content.Sheets)
        {
            var link = sheet.Cell(row, First);
            link.Value = entry.Name;
            link.SetHyperlink(new XLHyperlink($"'{entry.Name.Replace("'", "''", StringComparison.Ordinal)}'!A1"));
            link.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Darken(brand.Accent, WorkbookPalette.Luminance(brand.Accent) > 0.4 ? 0.55 : 0));
            link.Style.Font.Underline = XLFontUnderlineValues.Single;
            var description = sheet.Cell(row, First + 1);
            description.Value = entry.Description;
            description.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
            description.Style.Alignment.WrapText = true;
            var cells = sheet.Range(row, First, row, Last - 1);
            cells.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            cells.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
            cells.Style.Border.BottomBorderColor = XLColor.FromHtml(WorkbookPalette.Rule);
            sheet.Row(row).Height = HeightFor(entry.Description, 64, WorkbookStyle.BodyRowHeight + 2);
            row++;
        }

        if (content.Legend.Count > 0)
        {
            row++;
            Heading(sheet, row++, spanish ? "Qué significan los colores" : "What the colours mean", brand);
            foreach (var entry in content.Legend)
            {
                var swatch = sheet.Cell(row, First);
                swatch.Value = entry.Label;
                WorkbookStyle.Tone(swatch, entry.Fill, entry.Ink);
                swatch.Style.Font.Bold = true;
                swatch.Style.Alignment.Indent = 1;
                swatch.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                swatch.Style.Border.OutsideBorderColor = XLColor.White;
                var meaning = sheet.Cell(row, First + 1);
                meaning.Value = entry.Meaning;
                meaning.Style.Alignment.WrapText = true;
                meaning.Style.Alignment.Indent = 1;
                meaning.Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
                sheet.Range(row, First, row, Last - 1).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
                sheet.Row(row).Height = HeightFor(entry.Meaning, 64, 24);
                row++;
            }
        }

        if (content.Notes.Count > 0)
        {
            row++;
            Heading(sheet, row++, spanish ? "Antes de usar estos datos" : "Before using these figures", brand);
            foreach (var note in content.Notes)
            {
                var range = sheet.Range(row, First, row, Last - 1);
                range.Merge();
                range.FirstCell().Value = "•  " + note;
                range.Style.Alignment.WrapText = true;
                range.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                sheet.Row(row).Height = HeightFor(note, 96, 18);
                row++;
            }
        }

        row += 2;
        Line(sheet, row, EmailBranding.ProductName, WorkbookPalette.Secondary, 9);

        sheet.PageSetup.PageOrientation = XLPageOrientation.Portrait;
        sheet.PageSetup.FitToPages(1, 1);
        sheet.PageSetup.PrintAreas.Add(1, 1, row, Last);
        sheet.SetTabActive();
        sheet.Select();
        foreach (var other in book.Worksheets.Where(w => w != sheet))
        {
            other.TabSelected = false;
            other.TabActive = false;
        }

        return sheet;
    }

    /// <summary>
    /// Draws the logo 56 px high, never wider than the first columns hold; false when there is
    /// none or it cannot be read. Measured: a file whose PNG signature is right and whose body is
    /// not makes ClosedXML throw <c>ArgumentException: PNG is corrupted</c>, and a logo must never
    /// be the reason a download fails.
    /// </summary>
    private static bool TryDrawLogo(IXLWorksheet sheet, WorkbookBrand brand, int row)
    {
        if (brand.LogoFormat is not { } format)
        {
            return false;
        }

        try
        {
            using var stream = new MemoryStream(brand.Logo!);
            var picture = sheet.AddPicture(stream, format, "Logo");
            // Moves with its cell but keeps its own size: a logo must not stretch when a row is resized.
            picture.Placement = XLPicturePlacement.Move;
            picture.MoveTo(sheet.Cell(row, First), 0, 8);
            var scale = Math.Min(56d / Math.Max(1, picture.OriginalHeight), 360d / Math.Max(1, picture.OriginalWidth));
            picture.WithSize(
                Math.Max(1, (int)Math.Round(picture.OriginalWidth * scale)),
                Math.Max(1, (int)Math.Round(picture.OriginalHeight * scale)));
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or FormatException or IOException or NotSupportedException)
        {
            foreach (var partial in sheet.Pictures.ToList())
            {
                partial.Delete();
            }

            return false;
        }
    }

    private static void Line(IXLWorksheet sheet, int row, string text, string color, double size)
    {
        var cell = sheet.Cell(row, First);
        cell.Value = text;
        cell.Style.Font.FontColor = XLColor.FromHtml(color);
        cell.Style.Font.FontSize = size;
    }

    private static void Heading(IXLWorksheet sheet, int row, string text, WorkbookBrand brand)
    {
        sheet.Cell(row, First).Value = text;
        WorkbookStyle.Section(sheet.Range(row, First, row, Last - 1), brand);
    }

    /// <summary>A row tall enough for <paramref name="text"/> wrapped at about <paramref name="perLine"/> characters.</summary>
    private static double HeightFor(string text, int perLine, double minimum)
    {
        var lines = Math.Max(1, (int)Math.Ceiling(text.Length / (double)perLine));
        return Math.Max(minimum, (lines * 15) + 6);
    }
}
