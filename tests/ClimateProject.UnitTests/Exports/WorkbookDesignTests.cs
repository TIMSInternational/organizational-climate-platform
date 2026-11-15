using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;
using ClimateProject.UnitTests.Reports;
using ClosedXML.Excel;
using ClosedXML.Excel.Drawings;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The redesigned workbooks (14 Nov 2026, after #666): the client's logo on a cover sheet, the
/// client's colour on the headers, and colours that mean something -- without moving or changing
/// a single value the files carried before.
/// </summary>
public class WorkbookDesignTests
{
    /// <summary>A real 1x1 PNG: ClosedXML reads its size, so the cover can draw it.</summary>
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");

    private static readonly QuestionnaireSurvey Clima = new(
        "Clima",
        "closed",
        null,
        null,
        [
            new QuestionnaireQuestion(0, "likert", "workload", true, "Mi jefatura me trata con respeto.", "My manager treats me with respect.", 1, 5, null, null, null, null, []),
            new QuestionnaireQuestion(1, "multiple_choice", null, false, "¿Qué beneficio valora más?", null, null, null, null, null, null, null,
                [new QuestionnaireOption(0, "salud", "Seguro de salud", null), new QuestionnaireOption(1, "horario", "Horario flexible", "Flexible hours")]),
        ]);

    private static XLWorkbook Open(byte[] bytes) => new(new MemoryStream(bytes));

    private static string Fill(IXLCell cell) => cell.Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8");

    // ------------------------------------------------------------------ the brand

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("blue")]
    [InlineData("#12345")]
    public void A_missing_or_invalid_colour_wears_the_product_navy(string? color)
        => Assert.Equal(WorkbookBrand.ProductAccent, new WorkbookBrand("ESPH", null, color).Accent);

    [Theory]
    [InlineData("#FFD400", "#0B1524")] // a light brand gets dark text
    [InlineData("#0B6E4F", "#FFFFFF")] // a dark one gets white
    public void Header_text_is_whichever_of_black_or_white_reads_on_the_brand(string color, string ink)
        => Assert.Equal(ink, new WorkbookBrand("ESPH", null, color).OnAccent);

    [Fact]
    public void Only_png_and_jpeg_can_be_drawn()
    {
        Assert.Equal(XLPictureFormat.Png, new WorkbookBrand("A", Png, null).LogoFormat);
        Assert.Equal(XLPictureFormat.Jpeg, new WorkbookBrand("A", [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0], null).LogoFormat);
        byte[] webp = [.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8];
        Assert.Null(new WorkbookBrand("A", webp, null).LogoFormat);
        Assert.Null(new WorkbookBrand("A", null, null).LogoFormat);
    }

    // ------------------------------------------------------------------ the cover

    [Fact]
    public void Every_file_opens_on_its_cover()
    {
        var brand = new WorkbookBrand("ESPH", null, "#0B6E4F");
        var aggregate = new SurveyReportFixture().Add(4, SurveyReportFixture.Operaciones, "mujer", 4).Inputs().Compute();
        byte[][] files =
        [
            QuestionnaireWorkbook.Build([Clima], spanish: true, brand),
            ResultsWorkbook.Build([new ResultsWorkbookSurvey("Clima", "closed", aggregate, SurveyReportFixture.Labels, [])], ScoreScale.Mean, true, new DateOnly(2026, 11, 14), SurveyReportFixture.Bands, brand),
            StatusWorkbook.Build([new StatusWorkbookSurvey("Clima", false, false, [])], new DateOnly(2026, 11, 14), true, StatusWorkbookLayout.Standard, brand),
            ResponseWorkbook.Build([], DateTimeOffset.Parse("2026-11-14T00:00:00Z"), brand: brand),
        ];

        foreach (var file in files)
        {
            using var book = Open(file);
            var cover = book.Worksheet(1);
            Assert.Equal("Portada", cover.Name);
            Assert.True(cover.TabActive);
            Assert.False(cover.ShowGridLines);
        }
    }

    [Fact]
    public void The_cover_draws_the_logo_when_there_is_one_and_prints_the_name_when_there_is_not()
    {
        using (var branded = Open(QuestionnaireWorkbook.Build([Clima], true, new WorkbookBrand("ESPH", Png, "#0B6E4F"))))
        {
            Assert.Single(branded.Worksheet("Portada").Pictures);
        }

        using var plain = Open(QuestionnaireWorkbook.Build([Clima], true, new WorkbookBrand("ESPH", null, "#0B6E4F")));
        Assert.Empty(plain.Worksheet("Portada").Pictures);
        Assert.Equal("ESPH", plain.Worksheet("Portada").Cell(2, 2).GetString());
    }

    /// <summary>
    /// Measured: a PNG whose signature is right and whose body is not makes ClosedXML throw. A
    /// logo must never be the reason a download fails.
    /// </summary>
    [Fact]
    public void A_logo_that_cannot_be_read_leaves_the_name_and_the_file_still_builds()
    {
        byte[] corrupt = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8];

        using var book = Open(QuestionnaireWorkbook.Build([Clima], true, new WorkbookBrand("ESPH", corrupt, "#0B6E4F")));

        Assert.Empty(book.Worksheet("Portada").Pictures);
        Assert.Equal("ESPH", book.Worksheet("Portada").Cell(2, 2).GetString());
    }

    [Fact]
    public void Every_line_of_the_contents_links_to_a_sheet_that_exists()
    {
        using var book = Open(QuestionnaireWorkbook.Build([Clima, Clima with { Title = "Teletrabajo" }], true));
        var links = book.Worksheet("Portada").CellsUsed().Where(c => c.HasHyperlink).ToList();

        Assert.Equal(2, links.Count);
        foreach (var link in links)
        {
            var target = link.GetHyperlink().InternalAddress;
            Assert.Contains(book.Worksheets, w => target.StartsWith($"'{w.Name}'!", StringComparison.Ordinal));
        }
    }

    // ------------------------------------------------------------------ colours that mean something

    [Fact]
    public void A_mean_is_painted_with_its_result_area()
    {
        ResultsWorkbookSurvey Uniform(string title, int score)
            => new(title, "closed", new SurveyReportFixture().Add(4, SurveyReportFixture.Operaciones, "mujer", score).Inputs().Compute(), SurveyReportFixture.Labels, []);

        using var book = Open(ResultsWorkbook.Build(
            [Uniform("Alta", 5), Uniform("Media", 3), Uniform("Baja", 2)], ScoreScale.Mean, true, new DateOnly(2026, 11, 14), SurveyReportFixture.Bands));

        Assert.Equal("FF" + WorkbookPalette.StrengthFill.TrimStart('#'), Fill(book.Worksheet("Alta").Cell(6, 6)));
        Assert.Equal("FF" + WorkbookPalette.OpportunityFill.TrimStart('#'), Fill(book.Worksheet("Media").Cell(6, 6)));
        Assert.Equal("FF" + WorkbookPalette.CriticalFill.TrimStart('#'), Fill(book.Worksheet("Baja").Cell(6, 6)));
        // The summary's overall mean too.
        Assert.Equal("FF" + WorkbookPalette.StrengthFill.TrimStart('#'), Fill(book.Worksheet("Resumen").Cell(5, 6)));
    }

    [Fact]
    public void Without_the_companys_bands_no_mean_is_painted()
    {
        var aggregate = new SurveyReportFixture().Add(4, SurveyReportFixture.Operaciones, "mujer", 5).Inputs().Compute();

        using var book = Open(ResultsWorkbook.Build([new ResultsWorkbookSurvey("Clima", "closed", aggregate, SurveyReportFixture.Labels, [])], ScoreScale.Mean, true, new DateOnly(2026, 11, 14)));

        Assert.Equal(XLFillPatternValues.None, book.Worksheet("Clima").Cell(6, 6).Style.Fill.PatternType);
    }

    [Fact]
    public void A_missing_translation_is_painted_and_stays_empty()
    {
        using var book = Open(QuestionnaireWorkbook.Build([Clima], spanish: true));
        var sheet = book.Worksheet("Clima");

        // P02's English question was never written.
        Assert.True(sheet.Cell(6, 6).IsEmpty());
        Assert.Equal("FF" + WorkbookPalette.OpportunityFill.TrimStart('#'), Fill(sheet.Cell(6, 6)));
        // P01 is translated, so its English cell is not painted.
        Assert.NotEqual("FF" + WorkbookPalette.OpportunityFill.TrimStart('#'), Fill(sheet.Cell(5, 6)));
        // One option label is missing in English: the options cell says "salud =" and is painted.
        Assert.Equal("FF" + WorkbookPalette.OpportunityFill.TrimStart('#'), Fill(sheet.Cell(6, 13)));
    }

    [Fact]
    public void A_dimension_prints_its_name_not_its_key()
    {
        using var book = Open(QuestionnaireWorkbook.Build([Clima], spanish: true));

        // A catalogue key, as the instrument stores it, printed as the reader says it.
        Assert.Equal("Carga de trabajo", book.Worksheet("Clima").Cell(5, 2).GetString());
    }

    [Theory]
    [InlineData(224, 225, 2, 0.99)]   // «0%»: never «100%» with someone left
    [InlineData(224, 225, 3, 0.995)]  // «0.0%»
    [InlineData(2, 3, 3, 0.666)]
    [InlineData(5, 5, 2, 1.0)]
    [InlineData(0, 0, 2, 0.0)]
    public void A_share_is_cut_down_to_what_it_prints(int finished, int total, int places, double expected)
        => Assert.Equal(expected, StatusWorkbook.FinishedShare(finished, total, places), precision: 9);

    // ------------------------------------------------------------------ style only, never a value

    /// <summary>
    /// TIMS's scripts read the response workbook by sheet name and row 1. The brand must change
    /// how every sheet looks and nothing a script reads.
    /// </summary>
    [Fact]
    public void A_brand_changes_no_value_of_the_response_workbook()
    {
        var q = Guid.NewGuid();
        var survey = new ResponseExportSurvey(Guid.NewGuid(), "ESPH", "Clima", "closed", false,
            DateTimeOffset.Parse("2026-10-15T06:00:00Z"), DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            [new ResponseExportQuestion(q, 1, "P01", "Comunicación", "likert", "Recibo a tiempo la información.", 1, 5)],
            [new ResponseExportRow(Guid.NewGuid(), "Ana", "ana@esph.cr", "esph-1", "Gerencia", new Dictionary<string, string> { ["genero"] = "F" },
                DateTimeOffset.Parse("2026-10-15T14:00:00Z"), DateTimeOffset.Parse("2026-10-15T14:20:00Z"), true, 1200, [new ResponseExportAnswer(q, "4", null)])],
            [new ResponseExportPending("Luis", "luis@esph.cr", "esph-2", "started", null)]);
        var at = DateTimeOffset.Parse("2026-11-14T00:00:00Z");

        using var plain = Open(ResponseWorkbook.Build([survey], at));
        using var branded = Open(ResponseWorkbook.Build([survey], at, brand: new WorkbookBrand("ESPH", Png, "#0B6E4F")));

        var sheets = plain.Worksheets.Where(w => w.Name != "Portada").Select(w => w.Name).ToList();
        Assert.Equal(sheets, branded.Worksheets.Where(w => w.Name != "Portada").Select(w => w.Name));
        Assert.Equal(["RESUMEN", "PREGUNTAS", "PENDIENTES", "R01 Clima"], sheets);
        foreach (var name in sheets)
        {
            Assert.Equal(
                plain.Worksheet(name).CellsUsed().Select(c => (c.Address.ToString(), c.Value.ToString())),
                branded.Worksheet(name).CellsUsed().Select(c => (c.Address.ToString(), c.Value.ToString())));
        }

        // Row 1 is still the header a script reads.
        Assert.Equal("#", branded.Worksheet("R01 Clima").Cell(1, 1).GetString());
        Assert.Equal("Hoja", branded.Worksheet("PREGUNTAS").Cell(1, 1).GetString());
    }

    [Fact]
    public void Branded_question_headers_are_two_tones_of_the_brand_and_neither_is_the_identity_header()
    {
        var q1 = Guid.NewGuid();
        var q2 = Guid.NewGuid();
        var survey = new ResponseExportSurvey(Guid.NewGuid(), "ESPH", "Clima", "closed", true,
            DateTimeOffset.Parse("2026-10-15T06:00:00Z"), DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
            [new ResponseExportQuestion(q1, 1, "P01", "Comunicación", "likert", "a", 1, 5), new ResponseExportQuestion(q2, 2, "P02", "Liderazgo", "likert", "b", 1, 5)],
            [new ResponseExportRow(Guid.NewGuid(), null, null, null, "Gerencia", new Dictionary<string, string>(), DateTimeOffset.Parse("2026-10-15T14:00:00Z"), null, false, null,
                [new ResponseExportAnswer(q1, "4", null), new ResponseExportAnswer(q2, "2", null)])],
            []);

        using var book = Open(ResponseWorkbook.Build([survey], DateTimeOffset.Parse("2026-11-14T00:00:00Z"), brand: new WorkbookBrand("ESPH", null, "#0B6E4F")));
        var sheet = book.Worksheet("R01 Clima");
        var headers = sheet.Row(1).CellsUsed().ToList();
        var identity = Fill(headers.First(c => c.GetString() == "#"));
        var p01 = Fill(headers.First(c => c.GetString() == "P01"));
        var p02 = Fill(headers.First(c => c.GetString() == "P02"));

        Assert.Equal("FF0B6E4F", identity);
        Assert.NotEqual(identity, p01);
        Assert.NotEqual(identity, p02);
        Assert.NotEqual(p01, p02);
    }
}
