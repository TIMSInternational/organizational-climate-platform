using ClimateProject.Application.Exports;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Exports;

/// <summary>The delivery audit workbook: what TIMS reads to know who never received the email.</summary>
public class DeliveryAuditWorkbookTests
{
    private static readonly DateOnly Today = new(2026, 11, 2);

    private static DeliveryAuditFailure Failure(string name, bool signedIn, string type = "bounce", string? bounce = "Permanent", string? reply = "550 5.1.1 user unknown", int day = 20)
        => new(name, name.ToLowerInvariant() + "@esph-sa.com", "Clima", new DateTimeOffset(2026, 10, 20, 15, 0, 0, TimeSpan.Zero),
            type, bounce, reply, new DateTimeOffset(2026, 10, day, 16, 0, 0, TimeSpan.Zero), signedIn);

    private static XLWorkbook Open(byte[] bytes) => new(new MemoryStream(bytes));

    [Fact]
    public void The_summary_says_who_got_in_who_bounced_and_who_has_given_no_signal()
    {
        var bytes = DeliveryAuditWorkbook.Build(
            "ESPH", [new DeliveryAuditSurvey("Clima", CodesSent: 619, SignedIn: 500, NotDelivered: 9)], [],
            Today, DateTimeOffset.Parse("2026-11-03T00:00:00Z"), spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Resumen");
        Assert.Equal(["Encuesta", "Códigos enviados", "Entraron", "Correo no entregado", "Sin señal todavía"],
            Enumerable.Range(1, 5).Select(c => sheet.Cell(6, c).GetString()));
        Assert.Equal(110, sheet.Cell(7, 5).GetValue<int>());
        Assert.Contains(sheet.CellsUsed(), c => c.GetString() == "Uso interno de TIMS: no se envía al cliente.");
        Assert.Contains(sheet.CellsUsed(), c => c.GetString().StartsWith("Los rebotes se registran desde el 2026-11-03", StringComparison.Ordinal));
    }

    [Fact]
    public void With_nothing_recorded_yet_the_file_says_so_rather_than_implying_nobody_bounced()
    {
        using var book = Open(DeliveryAuditWorkbook.Build("ESPH", [], [], Today, null, spanish: true));

        Assert.Contains(book.Worksheet("Resumen").CellsUsed(), c => c.GetString().StartsWith("Todavía no se ha registrado", StringComparison.Ordinal));
    }

    [Fact]
    public void The_people_still_stuck_come_first_with_the_servers_reply_and_what_to_do()
    {
        var bytes = DeliveryAuditWorkbook.Build("ESPH", [],
            [Failure("Ana", signedIn: true, day: 25), Failure("Beto", signedIn: false, bounce: "Transient", reply: "552 mailbox full", day: 21)],
            Today, DateTimeOffset.Parse("2026-10-20T00:00:00Z"), spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("No entregados");
        Assert.Equal("Beto", sheet.Cell(2, 1).GetString());
        Assert.Equal("Rebote temporal", sheet.Cell(2, 6).GetString());
        Assert.Equal("552 mailbox full", sheet.Cell(2, 7).GetString());
        Assert.Equal("No", sheet.Cell(2, 8).GetString());
        Assert.StartsWith("Buzón lleno", sheet.Cell(2, 9).GetString(), StringComparison.Ordinal);
        Assert.Equal("Ana", sheet.Cell(3, 1).GetString());
        Assert.Equal("Sí", sheet.Cell(3, 8).GetString());
    }

    /// <summary>A receiving server writes the reply, not us: it goes in as text, never as a formula.</summary>
    [Fact]
    public void A_server_reply_that_looks_like_a_formula_stays_text()
    {
        var bytes = DeliveryAuditWorkbook.Build("ESPH", [], [Failure("Ana", signedIn: false, reply: "=HYPERLINK(\"http://x\")")],
            Today, null, spanish: true);

        using var book = Open(bytes);
        var cell = book.Worksheet("No entregados").Cell(2, 7);
        Assert.False(cell.HasFormula);
        Assert.Equal("=HYPERLINK(\"http://x\")", cell.GetString());
    }

    [Theory]
    [InlineData("bounce", "Permanent", "Rebote permanente")]
    [InlineData("bounce", "Transient", "Rebote temporal")]
    [InlineData("bounce", "Undetermined", "Rebote")]
    [InlineData("complaint", null, "Lo marcó como spam")]
    [InlineData("reject", null, "Rechazado antes de salir")]
    public void Each_kind_is_named_in_words(string type, string? bounce, string expected)
        => Assert.Equal(expected, DeliveryAuditWorkbook.KindLabel(type, bounce, spanish: true));
}
