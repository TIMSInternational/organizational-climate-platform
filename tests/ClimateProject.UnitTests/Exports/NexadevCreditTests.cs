using System.Text;
using System.Text.RegularExpressions;
using ClimateProject.Application.Email;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// "Desarrollado por Nexadev" / "Powered by Nexadev": the credit ruled 2026-10-21 for every
/// screen, every email and every PDF page. The web half is
/// <c>web/src/components/layout/PoweredByNexadev.test.tsx</c>, which also reads
/// <c>NexadevCredit.cs</c> and fails if the two wordings drift apart.
/// </summary>
public class NexadevCreditTests
{
    [Theory]
    [InlineData("es", NexadevCredit.Spanish)]
    [InlineData("es-CR", NexadevCredit.Spanish)]
    [InlineData("ES", NexadevCredit.Spanish)]
    [InlineData("en", NexadevCredit.English)]
    [InlineData("", NexadevCredit.English)]
    [InlineData(null, NexadevCredit.English)]
    public void Spanish_reads_Desarrollado_por_and_everything_else_Powered_by(string? locale, string expected)
        => Assert.Equal(expected, NexadevCredit.For(locale));

    [Fact]
    public void Every_email_document_carries_the_credit_in_its_language_under_the_card()
    {
        var spanish = EmailBranding.Document("es", "<p>cuerpo</p>");
        var english = EmailBranding.Document("en", "<p>body</p>");

        Assert.Contains("Desarrollado por Nexadev", spanish);
        Assert.DoesNotContain("Powered by Nexadev", spanish);
        Assert.Contains("Powered by Nexadev", english);

        // Under the card, not inside it: after the card's closing </div> and before </body>.
        var credit = spanish.IndexOf("Desarrollado por Nexadev", StringComparison.Ordinal);
        Assert.True(credit > spanish.LastIndexOf("</div>", StringComparison.Ordinal));
        Assert.True(credit < spanish.IndexOf("</body>", StringComparison.Ordinal));
    }

    [Fact]
    public void Every_page_of_a_PDF_ends_with_the_credit()
    {
        var document = new PdfDocument("Informe") { Credit = NexadevCredit.Spanish };
        document.Title("Informe");
        var rows = Enumerable.Range(1, 120).Select(i => (IReadOnlyList<string?>)[$"Fila {i}", "x"]).ToList();
        document.Table([new PdfTableColumn("A", 1), new PdfTableColumn("B", 1)], rows);
        Assert.True(document.PageCount > 1, "the fixture must span pages, or 'every page' proves nothing");

        var pdf = Encoding.Latin1.GetString(document.ToBytes());
        var drawn = Regex.Matches(pdf, @"\(Desarrollado por Nexadev\) Tj").Count;
        Assert.Equal(document.PageCount, drawn);

        // Drawn at write time, not into the pages: a second ToBytes is byte-identical.
        Assert.Equal(document.ToBytes(), document.ToBytes());
    }

    [Fact]
    public void A_PDF_with_no_credit_set_draws_none()
    {
        var document = new PdfDocument("Plain");
        document.Paragraph("body");
        Assert.DoesNotContain("Nexadev", Encoding.Latin1.GetString(document.ToBytes()));
    }
}
