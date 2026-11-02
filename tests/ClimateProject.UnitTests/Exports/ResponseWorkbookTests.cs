using ClimateProject.Application.Exports;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Exports;

public class ResponseWorkbookTests
{
    private static readonly Guid Q1 = Guid.NewGuid();
    private static readonly Guid Q2 = Guid.NewGuid();

    private static ResponseExportSurvey Survey(bool anonymous, string title) => new(
        Guid.NewGuid(),
        "ESPH",
        title,
        "active",
        anonymous,
        DateTimeOffset.Parse("2026-10-15T06:00:00Z"),
        DateTimeOffset.Parse("2026-11-01T00:00:00Z"),
        [
            new ResponseExportQuestion(Q1, 1, "P01", "Comunicación", "likert", "Recibo a tiempo la información."),
            new ResponseExportQuestion(Q2, 2, "P02", "Preguntas abiertas", "open_ended", "¿Qué mejoraría?"),
        ],
        [
            new ResponseExportRow(
                Guid.NewGuid(),
                anonymous ? null : "Andrés Tafur",
                anonymous ? null : "andres@esph.cr",
                anonymous ? null : "esph-ab12cd34",
                "Gerencia",
                new Dictionary<string, string> { ["antiguedad"] = "4_a_6_anos" },
                DateTimeOffset.Parse("2026-10-15T14:00:00Z"),
                DateTimeOffset.Parse("2026-10-15T14:27:00Z"),
                true,
                1620,
                [new ResponseExportAnswer(Q1, "4", null), new ResponseExportAnswer(Q2, "[withheld]", null)]),
        ],
        [
            new ResponseExportPending("Carmen Soto", "carmen@esph.cr", "esph-pq55rr66", "not_started", null),
            new ResponseExportPending(
                "Luis Mora", "luis@esph.cr", "esph-tt11uu22", "started", new DateOnly(2026, 10, 15)),
        ]);

    private static XLWorkbook Read(params ResponseExportSurvey[] surveys)
    {
        var bytes = ResponseWorkbook.Build(surveys, DateTimeOffset.Parse("2026-10-16T01:00:00Z"));
        return new XLWorkbook(new MemoryStream(bytes));
    }

    private static List<string> HeaderOf(IXLWorksheet sheet) => sheet.Row(1).CellsUsed()
        .Select(c => c.GetString()).ToList();

    [Fact]
    public void An_identified_sheet_names_the_respondent_and_an_anonymous_one_has_no_such_column()
    {
        using var book = Read(Survey(anonymous: false, "Clima identificado"), Survey(anonymous: true, "Clima anónimo"));

        var identified = HeaderOf(book.Worksheet("R01 Clima identificado"));
        Assert.Equal(["#", "nombre", "correo", "usuario", "departamento"], identified.Take(5));
        Assert.Equal("Andrés Tafur", book.Worksheet("R01 Clima identificado").Cell(2, 2).GetString());

        // Not an empty column -- no column. A blank "nombre" reads as data that went missing,
        // and nothing went missing: responses.user_id was never written for an anonymous survey.
        var anonymous = HeaderOf(book.Worksheet("R02 Clima anónimo"));
        Assert.DoesNotContain("nombre", anonymous);
        Assert.DoesNotContain("correo", anonymous);
        Assert.DoesNotContain("usuario", anonymous);
        Assert.Equal(["#", "departamento"], anonymous.Take(2));
    }

    [Fact]
    public void A_scale_answer_is_a_number_so_the_column_averages_without_being_retyped()
    {
        using var book = Read(Survey(anonymous: false, "Clima identificado"));
        var sheet = book.Worksheet("R01 Clima identificado");
        var header = HeaderOf(sheet);

        var p01 = header.IndexOf("P01") + 1;
        Assert.Equal(XLDataType.Number, sheet.Cell(2, p01).DataType);
        Assert.Equal(4d, sheet.Cell(2, p01).GetDouble());

        // The open question's answer arrives already withheld by the endpoint; the writer
        // stores whatever it is given as text and never evaluates it.
        var p02 = header.IndexOf("P02") + 1;
        Assert.Equal(XLDataType.Text, sheet.Cell(2, p02).DataType);
    }

    [Fact]
    public void Resumen_says_in_words_which_sheets_can_carry_an_identity_and_preguntas_maps_every_code()
    {
        using var book = Read(Survey(anonymous: false, "Clima identificado"), Survey(anonymous: true, "Clima anónimo"));

        var summary = book.Worksheet("RESUMEN");
        Assert.Equal("Identificada", summary.Cell(2, 5).GetString());
        Assert.Equal("Anónima", summary.Cell(3, 5).GetString());
        Assert.Contains("no se guardó quién respondió", summary.Cell(3, 13).GetString(), StringComparison.Ordinal);
        Assert.Equal(1, summary.Cell(2, 8).GetDouble());
        Assert.Equal(2, summary.Cell(2, 10).GetDouble());

        // The climate's own window and the latest row in the sheet, so a file downloaded
        // mid-measurement cannot be mistaken for a finished one a week later.
        Assert.Equal(new DateTime(2026, 10, 15, 6, 0, 0), summary.Cell(2, 6).GetDateTime());
        Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0), summary.Cell(2, 7).GetDateTime());
        Assert.Equal(new DateTime(2026, 10, 15, 14, 27, 0), summary.Cell(2, 11).GetDateTime());

        var questions = book.Worksheet("PREGUNTAS");
        Assert.Equal("R01", questions.Cell(2, 1).GetString());
        Assert.Equal("P01", questions.Cell(2, 2).GetString());
        Assert.Equal("Comunicación", questions.Cell(2, 3).GetString());
        Assert.Equal("Recibo a tiempo la información.", questions.Cell(2, 5).GetString());
    }

    /// <summary>
    /// The sheet the morning and afternoon status mail is written from. One list across every
    /// climate in the file, and it keeps the roster's own three-way distinction rather than
    /// flattening everyone into "pendiente": somebody who never opened it needs their sign-in
    /// details again, somebody who stopped half way already has them.
    /// </summary>
    [Fact]
    public void Pendientes_lists_everyone_who_has_not_finished_with_the_rosters_own_states()
    {
        using var book = Read(Survey(anonymous: false, "Clima identificado"));
        var pending = book.Worksheet("PENDIENTES");

        Assert.Equal(
            ["Hoja", "Empresa", "Clima", "Nombre", "Correo", "Usuario", "Estado", "Última actividad"],
            pending.Row(1).CellsUsed().Select(c => c.GetString()));

        Assert.Equal("Carmen Soto", pending.Cell(2, 4).GetString());
        Assert.Equal("not_started", pending.Cell(2, 7).GetString());
        Assert.True(pending.Cell(2, 8).IsEmpty());

        Assert.Equal("Luis Mora", pending.Cell(3, 4).GetString());
        Assert.Equal("started", pending.Cell(3, 7).GetString());
        Assert.Equal(new DateTime(2026, 10, 15), pending.Cell(3, 8).GetDateTime());
    }

    [Fact]
    public void A_comment_column_appears_only_where_a_comment_exists()
    {
        var withComment = Survey(anonymous: false, "Clima identificado") with
        {
            Rows =
            [
                new ResponseExportRow(
                    Guid.NewGuid(), "Federico Tafur", "fede@esph.cr", "esph-zz99yy88", "TI",
                    new Dictionary<string, string>(),
                    DateTimeOffset.Parse("2026-10-15T14:00:00Z"), null, false, null,
                    [new ResponseExportAnswer(Q1, "3", "[withheld]")]),
            ],
        };

        using var book = Read(withComment);
        var header = HeaderOf(book.Worksheet("R01 Clima identificado"));
        Assert.Contains("P01_texto", header);
        Assert.DoesNotContain("P02_texto", header);
    }

    // ------------------------------------------------------------------ readable (2026-11-02)

    /// <summary>A 1–5 scale question and the identified survey carrying it, for the format tests.</summary>
    private static ResponseExportSurvey Scaled(params ResponseExportDemographicColumn[] columns)
    {
        var survey = Survey(anonymous: false, "Clima identificado");
        return survey with
        {
            Questions =
            [
                new ResponseExportQuestion(Q1, 1, "P01", "Comunicación", "likert", "Recibo a tiempo la información.", 1, 5),
                new ResponseExportQuestion(Q2, 2, "P02", "Preguntas abiertas", "open_ended", "¿Qué mejoraría?"),
            ],
            Rows =
            [
                survey.Rows[0] with
                {
                    Demographics = new Dictionary<string, string>
                    {
                        ["antiguedad"] = "De 4 a 6 años",
                        ["turno"] = "noche",
                    },
                },
            ],
            DemographicColumns = columns,
        };
    }

    [Fact]
    public void A_demographic_column_is_headed_by_its_label_and_a_key_with_no_label_still_prints()
    {
        using var book = Read(Scaled(new ResponseExportDemographicColumn("antiguedad", "Antigüedad")));
        var sheet = book.Worksheet("R01 Clima identificado");
        var header = HeaderOf(sheet);

        Assert.Contains("Antigüedad", header);
        Assert.DoesNotContain("antiguedad", header);
        Assert.Equal("De 4 a 6 años", sheet.Cell(2, header.IndexOf("Antigüedad") + 1).GetString());

        // The caller did not list "turno". Its value is still the person's answer, so it prints
        // under its key rather than vanishing because a label was missing.
        Assert.Equal("noche", sheet.Cell(2, header.IndexOf("turno") + 1).GetString());
    }

    [Fact]
    public void Without_answers_every_row_and_demographic_stays_and_no_answer_or_question_sheet_does()
    {
        var bytes = ResponseWorkbook.Build(
            [Scaled(new ResponseExportDemographicColumn("antiguedad", "Antigüedad"))],
            DateTimeOffset.Parse("2026-10-16T01:00:00Z"),
            includeAnswers: false);
        using var book = new XLWorkbook(new MemoryStream(bytes));
        var sheet = book.Worksheet("R01 Clima identificado");
        var header = HeaderOf(sheet);

        Assert.DoesNotContain(header, h => h.StartsWith('P'));
        Assert.Equal("De 4 a 6 años", sheet.Cell(2, header.IndexOf("Antigüedad") + 1).GetString());
        Assert.Equal(1, sheet.RowsUsed().Count() - 1);
        Assert.False(book.Worksheets.Contains("PREGUNTAS"));

        // Said in the file, so a list without answers is not mistaken for an export that lost them.
        var summary = book.Worksheet("RESUMEN");
        Assert.Contains(summary.CellsUsed(), c => c.GetString().StartsWith("Solo demográficos", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(1, 5)]
    [InlineData(0, 10)]
    [InlineData(1, 7)]
    [InlineData(20, 100)]
    public void Every_point_of_a_scale_falls_in_exactly_one_colour_and_the_ends_in_the_end_colours(int min, int max)
    {
        var question = new ResponseExportQuestion(Q1, 1, "P01", null, "likert", "x", min, max);
        var buckets = ResponseWorkbook.ScaleBuckets(question)!;

        Assert.Equal(ResponseWorkbook.ScaleFills.Length, buckets.Count);
        for (var value = min; value <= max; value++)
        {
            Assert.Single(buckets, b => value >= b.Low && value <= b.High);
        }

        Assert.True(min >= buckets[0].Low && min <= buckets[0].High);
        Assert.True(max >= buckets[^1].Low && max <= buckets[^1].High);
    }

    [Fact]
    public void On_a_one_to_five_scale_each_answer_gets_its_own_step_with_the_middle_grey()
    {
        var buckets = ResponseWorkbook.ScaleBuckets(
            new ResponseExportQuestion(Q1, 1, "P01", null, "likert", "x", 1, 5))!;

        for (var value = 1; value <= 5; value++)
        {
            var step = buckets.ToList().FindIndex(b => value >= b.Low && value <= b.High);
            Assert.Equal(value - 1, step);
        }

        Assert.Equal("F0EFEC", ResponseWorkbook.ScaleFills[2]);
    }

    [Fact]
    public void A_question_with_no_scale_to_sit_on_is_not_coloured()
    {
        Assert.Null(ResponseWorkbook.ScaleBuckets(new ResponseExportQuestion(Q2, 2, "P02", null, "open_ended", "x")));
        Assert.Null(ResponseWorkbook.ScaleBuckets(new ResponseExportQuestion(Q2, 2, "P02", null, "multiple_choice", "x", 1, 5)));
        Assert.Null(ResponseWorkbook.ScaleBuckets(new ResponseExportQuestion(Q1, 1, "P01", null, "likert", "x")));
        Assert.Null(ResponseWorkbook.ScaleBuckets(new ResponseExportQuestion(Q1, 1, "P01", null, "likert", "x", 5, 5)));
    }

    [Fact]
    public void The_scale_column_carries_the_five_colours_and_the_open_one_carries_none()
    {
        using var book = Read(Scaled());
        var sheet = book.Worksheet("R01 Clima identificado");
        var header = HeaderOf(sheet);
        var p01 = header.IndexOf("P01") + 1;
        var p02 = header.IndexOf("P02") + 1;

        var onP01 = sheet.ConditionalFormats
            .Where(f => f.Ranges.Any(r => r.RangeAddress.FirstAddress.ColumnNumber == p01))
            .ToList();
        Assert.Equal(ResponseWorkbook.ScaleFills.Length, onP01.Count);
        Assert.Equal(
            ResponseWorkbook.ScaleFills.Select(f => "FF" + f),
            onP01.Select(f => f.Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8")));

        Assert.DoesNotContain(
            sheet.ConditionalFormats,
            f => f.Ranges.Any(r => r.RangeAddress.FirstAddress.ColumnNumber == p02));
    }

    [Fact]
    public void A_question_header_is_banded_by_dimension_and_carries_its_wording_and_the_block_beside_it_is_frozen()
    {
        using var book = Read(Scaled());
        var sheet = book.Worksheet("R01 Clima identificado");
        var header = HeaderOf(sheet);
        var p01 = sheet.Cell(1, header.IndexOf("P01") + 1);
        var p02 = sheet.Cell(1, header.IndexOf("P02") + 1);

        Assert.Contains("Recibo a tiempo la información.", p01.GetComment().Text, StringComparison.Ordinal);
        Assert.Contains("Comunicación", p01.GetComment().Text, StringComparison.Ordinal);

        // Two dimensions side by side, so two different steps of the one hue.
        Assert.Equal("FF" + ResponseWorkbook.DimensionBands[0], p01.Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
        Assert.Equal("FF" + ResponseWorkbook.DimensionBands[1], p02.Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));

        // Everything up to "minutos" stays on screen while the answers scroll.
        Assert.Equal(1, sheet.SheetView.SplitRow);
        Assert.Equal(header.IndexOf("minutos") + 1, sheet.SheetView.SplitColumn);
        Assert.True(sheet.AutoFilter.IsEnabled);
    }
}

