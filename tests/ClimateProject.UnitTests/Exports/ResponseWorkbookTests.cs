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
}
