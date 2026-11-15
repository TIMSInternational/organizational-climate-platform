using System.Globalization;
using System.Text;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Reports.SurveyReports;
using ClimateProject.UnitTests.Exports;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// The survey report PDF, read back as the strings it draws. The renderer decides nothing about
/// disclosure, so what these pin is that it draws exactly what the model says: one «Protegida»
/// per protected cell and no number in it, no section that was left out, and a file a reader
/// can open.
/// </summary>
public class SurveyReportPdfTests
{
    private static SurveyReportFixture Meridiano()
        => new SurveyReportFixture()
            .Add(12, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(10, SurveyReportFixture.Operaciones, "hombre", 3)
            .Add(6, SurveyReportFixture.Finanzas, "mujer", 5)
            .Add(4, SurveyReportFixture.Finanzas, "hombre", 2)
            .Add(2, SurveyReportFixture.Finanzas, "otra", 1)
            .Add(1, SurveyReportFixture.Legal, "otra", 1);

    [Fact]
    public void Every_protected_cell_is_drawn_as_the_one_word_and_nothing_else()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(crosses: ["department*gender"])));
        Assert.True(model.ProtectedCellCount > 0, "the fixture must protect at least one cell");

        var drawn = PdfText.DrawnStrings(SurveyReportPdf.Build(model));

        // The cell's word is drawn alone, as its own string: the count of exact «Protegida»
        // strings is the count of protected cells. The explanation paragraph that also starts
        // with the word is a longer string and does not match.
        Assert.Equal(model.ProtectedCellCount, drawn.Count(s => s == "Protegida"));
    }

    [Fact]
    public void A_protected_cells_group_size_is_printed_nowhere_in_the_file()
    {
        // Finanzas × otra is 2 people and Finanzas × hombre is 4 -- both protected. Their sizes
        // must not appear as a cell's «N personas»; the department's own total (12) may.
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(sections: "crosses", crosses: ["department*gender"])));
        var finanzas = SurveyReportFixture.Finanzas.ToString();
        Assert.False(model.Crosses.Single().Table.Cell(finanzas, "otra")!.IsDisclosed);
        Assert.False(model.Crosses.Single().Table.Cell(finanzas, "hombre")!.IsDisclosed);

        var drawn = PdfText.DrawnStrings(SurveyReportPdf.Build(model));

        Assert.DoesNotContain("2 personas", drawn);
        Assert.DoesNotContain("4 personas", drawn);
        Assert.Contains("12 personas", drawn);
    }

    [Fact]
    public void A_section_left_out_is_not_printed()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(sections: "summary")));

        var prose = PdfText.Prose(SurveyReportPdf.Build(model));

        // The KPI labels are set in capitals, as the design's are.
        Assert.Contains("MEDIA GENERAL", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("Mapa de clima", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("Resultados por pregunta", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("Clima por dimensión", prose, StringComparison.Ordinal);
    }

    [Fact]
    public void A_survey_under_the_floor_prints_its_participation_and_no_section()
    {
        var model = SurveyReportBuilder.Build(new SurveyReportFixture()
            .Add(2, SurveyReportFixture.Operaciones, "mujer", 5)
            .Source(SurveyReportFixture.Options()));

        var prose = PdfText.Prose(SurveyReportPdf.Build(model));

        Assert.Contains("Todavía no hay resultados que mostrar", prose, StringComparison.Ordinal);
        Assert.Contains("PARTICIPACIÓN", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("MEDIA GENERAL", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("Mapa de clima", prose, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_page_is_numbered_against_the_total()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(crosses: ["department*gender", "gender"])));
        var pdf = SurveyReportPdf.Build(model);
        Assert.True(pdf.PageCount > 1);

        var drawn = PdfText.DrawnStrings(pdf);

        for (var page = 1; page <= pdf.PageCount; page++)
        {
            Assert.Contains(string.Format(CultureInfo.InvariantCulture, "Página {0} de {1}", page, pdf.PageCount), drawn);
        }
    }

    [Fact]
    public void An_english_report_prints_english_words_and_points()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(), locale: "en"));

        var drawn = PdfText.DrawnStrings(SurveyReportPdf.Build(model));

        Assert.Contains("OVERALL MEAN", string.Join(" ", drawn), StringComparison.Ordinal);
        Assert.Contains(drawn, s => s == "Page 1 of " + SurveyReportPdf.Build(model).PageCount.ToString(CultureInfo.InvariantCulture));
        Assert.DoesNotContain(drawn, s => s.Contains("Página", StringComparison.Ordinal));
    }

    [Fact]
    public void Readings_print_with_two_decimals_and_the_locales_separator()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(sections: "summary")));
        var expected = SurveyReportCopy.Es.Score(model.OverallAverage!.Value, ScoreScale.Mean);
        Assert.Matches(@"^\d,\d\d$", expected);

        Assert.Contains(expected, PdfText.DrawnStrings(SurveyReportPdf.Build(model)));
    }

    [Fact]
    public void The_file_is_one_a_reader_can_open()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(
            sections: string.Join(',', SurveyReportSections.All),
            crosses: ["department*gender", "gender"])));
        var bytes = SurveyReportPdf.Build(model).ToBytes();
        var text = Encoding.Latin1.GetString(bytes);

        Assert.StartsWith("%PDF-1.4", text, StringComparison.Ordinal);
        Assert.EndsWith("%%EOF\n", text, StringComparison.Ordinal);

        // Every object the cross-reference table names is where it says: what "opens" means.
        var startxref = int.Parse(text[(text.LastIndexOf("startxref", StringComparison.Ordinal) + 10)..].Split('\n')[0], CultureInfo.InvariantCulture);
        var lines = text[startxref..].Split('\n');
        var count = int.Parse(lines[1].Split(' ')[1], CultureInfo.InvariantCulture);
        for (var number = 1; number < count; number++)
        {
            var offset = int.Parse(lines[2 + number][..10], CultureInfo.InvariantCulture);
            Assert.StartsWith($"{number.ToString(CultureInfo.InvariantCulture)} 0 obj", text[offset..], StringComparison.Ordinal);
        }

        Assert.Contains("/BaseFont /Times-Bold", text, StringComparison.Ordinal);
    }

    [Fact]
    public void No_character_outside_the_encoding_is_printed_as_a_question_mark()
    {
        // ≥, → and the minus sign have no WinAnsi code; the copy uses words and an en dash
        // instead. A '?' standing where none was written is the symptom of one slipping in.
        var before = new SurveyReportFixture().Add(10, SurveyReportFixture.Operaciones, "mujer", 5).Inputs().Compute();
        var model = SurveyReportBuilder.Build(Meridiano().Source(
            SurveyReportFixture.Options(sections: string.Join(',', SurveyReportSections.All), crosses: ["department*gender"], compare: Guid.NewGuid().ToString()),
            before));

        var drawn = PdfText.DrawnStrings(SurveyReportPdf.Build(model));

        Assert.DoesNotContain(drawn, s => s.Contains('?', StringComparison.Ordinal) && !s.Contains('¿', StringComparison.Ordinal));
    }
}
