using System.Globalization;
using System.Text;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The drawing layer added for the survey report's charts (14 Nov 2026): colour, shapes,
/// positioned text, Times-Bold and a running header -- and the promise that a document using
/// none of it is written exactly as before.
/// </summary>
public class PdfDrawingTests
{
    [Fact]
    public void A_document_that_never_draws_in_times_bold_has_no_third_font()
    {
        var document = new PdfDocument("Sin serif");
        document.Title("Título");
        document.Paragraph("Texto.");
        var text = Latin1(document.ToBytes());

        Assert.DoesNotContain("Times-Bold", text, StringComparison.Ordinal);
        Assert.DoesNotContain("/F3", text, StringComparison.Ordinal);
    }

    [Fact]
    public void A_document_that_draws_in_times_bold_declares_it_and_every_offset_stays_true()
    {
        var document = new PdfDocument("Con serif");
        document.DisplayTitle("Clima Organizacional 2026");
        document.StartPage();
        document.SectionTitle("Mapa de clima", "Subtítulo");
        var text = Latin1(document.ToBytes());

        Assert.Contains("/BaseFont /Times-Bold", text, StringComparison.Ordinal);
        Assert.Contains("/F3 ", text, StringComparison.Ordinal);

        var startxref = int.Parse(text[(text.LastIndexOf("startxref", StringComparison.Ordinal) + 10)..].Split('\n')[0], CultureInfo.InvariantCulture);
        var lines = text[startxref..].Split('\n');
        var count = int.Parse(lines[1].Split(' ')[1], CultureInfo.InvariantCulture);

        // Catalog, pages, three fonts, two objects per page, the information dictionary.
        Assert.Equal(7 + (2 * document.PageCount), count);
        for (var number = 1; number < count; number++)
        {
            var offset = int.Parse(lines[2 + number][..10], CultureInfo.InvariantCulture);
            Assert.StartsWith($"{number.ToString(CultureInfo.InvariantCulture)} 0 obj", text[offset..], StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Coloured_text_keeps_its_colour_inside_its_own_graphics_state()
    {
        var document = new PdfDocument("Color");
        document.DrawString("3,70", 100, 500, PdfStandardFont.Bold, 10, PdfColor.FromHex("#156B32"));
        var text = Latin1(document.ToBytes());

        Assert.Contains("q 0.08 0.42 0.2 rg BT /F2 10 Tf 1 0 0 1 100 500 Tm (3,70) Tj ET Q", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Uncoloured_text_is_written_exactly_as_it_was_before_colour_existed()
    {
        var document = new PdfDocument("Plain");
        document.Paragraph("Hola");
        var text = Latin1(document.ToBytes());

        Assert.Contains("BT /F1 9.5 Tf 1 0 0 1 56 ", text, StringComparison.Ordinal);
        Assert.DoesNotContain(" rg BT", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Shapes_are_paths_filled_or_stroked_in_their_own_graphics_state()
    {
        var document = new PdfDocument("Shapes");
        document.FillRectangle(10, 20, 30, 40, PdfColor.Gray(0.5));
        document.FillRectangle(10, 20, 30, 40, PdfColor.Gray(0.5), radius: 4);
        document.StrokeLine(0, 0, 10, 10, PdfColor.Black, 0.8);
        document.FillCircle(50, 50, 5, PdfColor.White);
        document.FillPolygon([(0, 0), (10, 0), (5, 8)], PdfColor.Black);
        var text = Latin1(document.ToBytes());

        Assert.Contains("q 0.5 0.5 0.5 rg 10 20 30 40 re f Q", text, StringComparison.Ordinal);
        Assert.Contains("q 0.8 w 0 0 0 RG 0 0 m 10 10 l S Q", text, StringComparison.Ordinal);
        Assert.Contains("q 0 0 0 rg 0 0 m 10 0 l 5 8 l h f Q", text, StringComparison.Ordinal);

        // The rounded rectangle and the circle are four Bezier curves each.
        var content = text[text.IndexOf("stream\n", StringComparison.Ordinal)..];
        Assert.Equal(8, CountOccurrences(content, " c "));
    }

    [Fact]
    public void A_shape_with_no_area_draws_nothing()
    {
        var document = new PdfDocument("Nothing");
        document.FillRectangle(10, 20, 0, 40, PdfColor.Black);
        document.FillCircle(10, 20, 0, PdfColor.Black);

        Assert.DoesNotContain(" re f", Latin1(document.ToBytes()), StringComparison.Ordinal);
    }

    [Fact]
    public void The_running_header_numbers_every_page_against_the_total()
    {
        var document = new PdfDocument("Header") { RunningHeaderBrand = "OCC", RunningHeader = "Clima · Meridiano", PageLabelFormat = "Página {0} de {1}" };
        document.Paragraph("Uno");
        document.StartPage();
        document.Paragraph("Dos");
        document.StartPage();

        var drawn = PdfText.DrawnStrings(document);

        Assert.Equal(["Página 1 de 3", "Página 2 de 3", "Página 3 de 3"], drawn.Where(s => s.StartsWith("Página", StringComparison.Ordinal)));
        Assert.Equal(3, drawn.Count(s => s == "OCC"));
    }

    [Fact]
    public void A_colour_is_read_from_the_notation_the_design_uses()
    {
        var colour = PdfColor.FromHex("#30A46C");
        Assert.Equal(0x30 / 255d, colour.R, 6);
        Assert.Equal(0xA4 / 255d, colour.G, 6);
        Assert.Equal(0x6C / 255d, colour.B, 6);
        Assert.Throws<ArgumentException>(() => PdfColor.FromHex("#30A4"));
        Assert.Throws<ArgumentException>(() => PdfColor.FromHex("green"));
    }

    [Fact]
    public void Fit_shortens_with_an_ellipsis_and_never_exceeds_the_width()
    {
        const string text = "Departamento de Atención al Cliente Corporativo";
        var fitted = PdfDocument.Fit(text, PdfStandardFont.Regular, 8, 60);

        Assert.EndsWith("…", fitted, StringComparison.Ordinal);
        Assert.True(PdfStandardFontMetrics.MeasureText(fitted, PdfStandardFont.Regular, 8) <= 60);
        Assert.Equal("Corto", PdfDocument.Fit("Corto", PdfStandardFont.Regular, 8, 60));
    }

    [Fact]
    public void Times_bold_widths_are_the_afms()
    {
        // ptmb8a.afm: C 722, l 278, i 278, m 833, a 500 -- and an accent folds onto its letter.
        Assert.Equal(2.611, PdfStandardFontMetrics.MeasureText("Clima", PdfStandardFont.SerifBold, 1), 6);
        Assert.Equal(
            PdfStandardFontMetrics.MeasureText("A", PdfStandardFont.SerifBold, 10),
            PdfStandardFontMetrics.MeasureText("Á", PdfStandardFont.SerifBold, 10));
        Assert.Equal("Times-Bold", PdfStandardFontMetrics.BaseFontName(PdfStandardFont.SerifBold));

        // Helvetica is untouched by the third face: C 722, l 222, i 222, m 833, a 556.
        Assert.Equal(2.555, PdfStandardFontMetrics.MeasureText("Clima", PdfStandardFont.Regular, 1), 6);
    }

    private static string Latin1(byte[] bytes) => Encoding.Latin1.GetString(bytes);

    private static int CountOccurrences(string text, string token)
    {
        var count = 0;
        for (var at = text.IndexOf(token, StringComparison.Ordinal); at >= 0; at = text.IndexOf(token, at + 1, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }
}
