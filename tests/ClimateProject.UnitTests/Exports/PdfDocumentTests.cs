using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The file this class produces has to be a PDF, not merely bytes that start with
/// <c>%PDF</c>.
///
/// <para>
/// Every test here parses the output back rather than asserting on the calls that produced it.
/// A hand-written serialiser fails in exactly one way -- it emits something a reader cannot
/// follow -- and a test that checked "did we append the string we meant to append" would go
/// green on every one of those failures. The cross-reference table is the sharpest example: it
/// is a list of byte offsets, and an offset that is wrong by one is a file that opens in no
/// reader at all while every string in it is perfectly correct.
/// </para>
/// </summary>
public partial class PdfDocumentTests
{
    [Fact]
    public void Every_cross_reference_offset_points_at_the_object_it_claims()
    {
        // The load-bearing structural test. A reader locates object N by seeking to
        // xref[N] and expecting "N 0 obj" there, so this is what "the file opens" means
        // mechanically. Nothing else in this class would notice an off-by-one.
        var document = Sample();
        var text = Latin1(document.ToBytes());

        var (startxref, offsets) = ReadCrossReferenceTable(text);

        Assert.StartsWith("xref", text[startxref..], StringComparison.Ordinal);

        // The free entry, the catalog, the page tree, the two fonts, then a page dictionary
        // and a content stream each. Derived from the document rather than written down, so
        // this stays a statement about the numbering rule and not about today's fixture.
        Assert.Equal(5 + (2 * document.PageCount), offsets.Length);

        for (var number = 1; number < offsets.Length; number++)
        {
            Assert.StartsWith(
                $"{number.ToString(CultureInfo.InvariantCulture)} 0 obj",
                text[(int)offsets[number]..],
                StringComparison.Ordinal);
        }
    }

    [Fact]
    public void The_trailer_size_matches_the_number_of_objects()
    {
        // /Size that disagrees with the table is the other half of the same failure: a reader
        // that trusts it walks off the end of the list.
        var text = Latin1(Sample().ToBytes());
        var (_, offsets) = ReadCrossReferenceTable(text);

        Assert.Contains($"/Size {offsets.Length.ToString(CultureInfo.InvariantCulture)}", text, StringComparison.Ordinal);
        Assert.EndsWith("%%EOF\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Content_that_overflows_a_page_starts_another_one()
    {
        // Pagination proved by counting, not by trusting the layout maths. One page would mean
        // every row after the first forty was drawn below the bottom margin -- off the paper,
        // in a file that still opens.
        var document = Sample();

        Assert.True(document.PageCount > 1, "a 60-row table did not paginate");

        var text = Latin1(document.ToBytes());
        var declared = PageCountPattern().Match(text);
        Assert.True(declared.Success, "no /Count in the page tree");
        Assert.Equal(document.PageCount, int.Parse(declared.Groups[1].Value, CultureInfo.InvariantCulture));

        // The /Kids array has to name exactly that many page objects, or a reader renders
        // fewer pages than the file contains.
        var kids = KidsPattern().Match(text);
        Assert.True(kids.Success, "no /Kids array");
        Assert.Equal(document.PageCount, kids.Groups[1].Value.Split(" R", StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Fact]
    public void A_table_repeats_its_header_on_every_page_it_spills_onto()
    {
        // A continuation page whose columns are unlabelled is a page of unattributed numbers --
        // and in a climate report the columns are "respondents" and "participation", which a
        // reader will confidently misread rather than notice are missing.
        var document = new PdfDocument("headers");
        document.Table(
            [new PdfTableColumn("Departamento", 3), new PdfTableColumn("Respondieron", 1, RightAligned: true)],
            [.. Enumerable.Range(0, 120).Select(i => new string?[] { $"Departamento {i}", i.ToString(CultureInfo.InvariantCulture) })]);

        Assert.True(document.PageCount > 1);

        // Once per page, counted in the drawn text rather than in the call log.
        var drawn = ContentStreams(document.ToBytes());
        Assert.Equal(document.PageCount, drawn.Count(page => page.Contains("(Departamento)", StringComparison.Ordinal)));
    }

    [Fact]
    public void Spanish_text_is_written_as_the_win_ansi_bytes_a_reader_will_decode()
    {
        // The product is Spanish. If the accented characters do not survive serialisation the
        // export is unusable, and the failure is silent: the file opens, the words are there,
        // and every á is a black diamond.
        var document = new PdfDocument("acentos");
        document.Paragraph("Dirección: ñandú, ¿sí? «Señor» — año 2026");

        var drawn = string.Join("\n", ContentStreams(document.ToBytes()));

        // Octal escapes of the WinAnsi codes: ó=0xF3=363, ñ=0xF1=361, ú=0xFA=372,
        // ¿=0xBF=277, í=0xED=355, «=0xAB=253, »=0xBB=273, —=0x97=227, Ñ has none here.
        Assert.Contains(@"Direcci\363n", drawn, StringComparison.Ordinal);
        Assert.Contains(@"\361and\372", drawn, StringComparison.Ordinal);
        Assert.Contains(@"\277s\355?", drawn, StringComparison.Ordinal);
        Assert.Contains(@"\253Se\361or\273", drawn, StringComparison.Ordinal);
        Assert.Contains(@"a\361o 2026", drawn, StringComparison.Ordinal);

        // And the whole stream stays ASCII, which is what the octal escaping buys: no tool in
        // the path can re-encode the file and corrupt exactly the accented characters.
        Assert.All(drawn, character => Assert.True(character < 128));
    }

    [Fact]
    public void The_three_characters_that_could_end_a_string_early_are_escaped()
    {
        // An unescaped ")" closes the literal string mid-word and everything after it is read
        // as operators. One department called "Ventas (Región)" would corrupt the rest of the
        // page, not one cell.
        Assert.Equal(@"(Ventas \(Regi\363n\) 50\\50)", PdfDocumentAccess.Literal("Ventas (Región) 50\\50"));
    }

    [Fact]
    public void Text_wraps_on_words_and_falls_back_to_characters_for_one_that_cannot_fit()
    {
        var wrapped = PdfDocument.WrapText(
            "La comunicación con la jefatura inmediata es clara y oportuna",
            PdfStandardFont.Regular,
            9.5,
            120);

        Assert.True(wrapped.Count > 1);
        Assert.All(wrapped, line => Assert.True(
            PdfStandardFontMetrics.MeasureText(line, PdfStandardFont.Regular, 9.5) <= 120,
            $"line overran the column: {line}"));

        // A single token wider than the column -- a URL, a 40-character department name --
        // has no space to break on. Without the character-level fallback it would be emitted
        // as one over-wide line, which on a table overwrites the next column.
        var unbreakable = PdfDocument.WrapText(new string('M', 200), PdfStandardFont.Bold, 9.5, 60);
        Assert.True(unbreakable.Count > 1);
        Assert.All(unbreakable, line => Assert.True(
            PdfStandardFontMetrics.MeasureText(line, PdfStandardFont.Bold, 9.5) <= 60));
    }

    [Fact]
    public void Wrapping_always_yields_at_least_one_line()
    {
        // Callers size a table row from Count. A zero-line cell would produce a row of height
        // zero and silently overprint the row below it.
        Assert.Single(PdfDocument.WrapText(null, PdfStandardFont.Regular, 9, 100));
        Assert.Single(PdfDocument.WrapText("   ", PdfStandardFont.Regular, 9, 100));
        Assert.Single(PdfDocument.WrapText("word", PdfStandardFont.Regular, 9, 0));
    }

    [Fact]
    public void A_table_row_that_disagrees_with_its_columns_is_refused()
    {
        var document = new PdfDocument("arity");
        Assert.Throws<ArgumentException>(() => document.Table(
            [new PdfTableColumn("a", 1), new PdfTableColumn("b", 1)],
            [new string?[] { "only one" }]));
    }

    /// <summary>A document long enough to paginate, with the shapes a survey export uses.</summary>
    private static PdfDocument Sample()
    {
        var document = new PdfDocument("Clima Q3");
        document.Title("Evaluación de Clima Organizacional");
        document.Paragraph("Generado para la prueba.");
        document.KeyValues([("Estado", "activa"), ("Respuestas completas", "128")]);
        document.Heading("Resultados por pregunta");
        document.Table(
            [
                new PdfTableColumn("Pregunta", 4),
                new PdfTableColumn("Respuestas", 1, RightAligned: true),
            ],
            [.. Enumerable.Range(0, 60).Select(i => new string?[]
            {
                $"¿Cómo calificarías la comunicación con tu jefatura inmediata? (pregunta {i})",
                (i * 3).ToString(CultureInfo.InvariantCulture),
            })]);

        return document;
    }

    /// <summary>
    /// The bytes as Latin-1 text, which is a lossless byte-per-char view for parsing structure.
    /// </summary>
    private static string Latin1(byte[] bytes) => Encoding.Latin1.GetString(bytes);

    /// <summary>Reads <c>startxref</c> and the offset table it points at.</summary>
    private static (int StartXref, long[] Offsets) ReadCrossReferenceTable(string text)
    {
        var marker = text.LastIndexOf("startxref", StringComparison.Ordinal);
        Assert.True(marker >= 0, "no startxref");

        var startxref = int.Parse(
            text[(marker + "startxref".Length)..].Trim().Split('\n')[0],
            CultureInfo.InvariantCulture);

        var table = text[startxref..];
        var lines = table.Split('\n');
        Assert.Equal("xref", lines[0]);

        var count = int.Parse(lines[1].Split(' ')[1], CultureInfo.InvariantCulture);
        var offsets = new long[count];
        for (var i = 0; i < count; i++)
        {
            offsets[i] = long.Parse(lines[2 + i][..10], CultureInfo.InvariantCulture);
        }

        return (startxref, offsets);
    }

    /// <summary>Each page's content stream, as text.</summary>
    private static IReadOnlyList<string> ContentStreams(byte[] bytes)
    {
        var text = Latin1(bytes);
        return [.. StreamPattern().Matches(text).Select(m => m.Groups[1].Value)];
    }

    [GeneratedRegex(@"/Count (\d+)")]
    private static partial Regex PageCountPattern();

    [GeneratedRegex(@"/Kids \[([^\]]*)\]")]
    private static partial Regex KidsPattern();

    [GeneratedRegex(@"stream\n(.*?)\nendstream", RegexOptions.Singleline)]
    private static partial Regex StreamPattern();
}

/// <summary>
/// Reaches <see cref="PdfDocument"/>'s internal string escaper.
/// </summary>
/// <remarks>
/// The escaper is internal rather than public because it is a serialisation detail no caller
/// should be choosing to use -- but it is also the one function whose failure corrupts a whole
/// page rather than one cell, so it is worth testing directly rather than only through a
/// rendered document. <c>InternalsVisibleTo</c> is not configured on the Application assembly;
/// this exercises it through the public surface that reaches it.
/// </remarks>
internal static class PdfDocumentAccess
{
    public static string Literal(string text)
    {
        var document = new PdfDocument("x");
        document.Paragraph(text);

        var content = Encoding.Latin1.GetString(document.ToBytes());
        var start = content.IndexOf("Tm (", StringComparison.Ordinal) + 3;
        var end = content.IndexOf(") Tj", start, StringComparison.Ordinal) + 1;
        return content[start..end];
    }
}
