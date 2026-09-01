using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The encoding table decides whether a Spanish document is readable, and the width table
/// decides whether it fits on the page. Both fail silently.
/// </summary>
public class PdfStandardFontMetricsTests
{
    /// <summary>
    /// Every character Spanish is written with, and the WinAnsi byte it has to become.
    /// </summary>
    /// <remarks>
    /// Written out rather than generated from the same expression the implementation uses --
    /// a test that re-derives the mapping proves only that the derivation is deterministic.
    /// These are the Latin-1 code points, checked against the encoding, and they are the
    /// reason base-14 fonts are acceptable for this product at all.
    /// </remarks>
    [Theory]
    [InlineData('á', 0xE1)]
    [InlineData('é', 0xE9)]
    [InlineData('í', 0xED)]
    [InlineData('ó', 0xF3)]
    [InlineData('ú', 0xFA)]
    [InlineData('ü', 0xFC)]
    [InlineData('ñ', 0xF1)]
    [InlineData('Á', 0xC1)]
    [InlineData('É', 0xC9)]
    [InlineData('Í', 0xCD)]
    [InlineData('Ó', 0xD3)]
    [InlineData('Ú', 0xDA)]
    [InlineData('Ü', 0xDC)]
    [InlineData('Ñ', 0xD1)]
    [InlineData('¿', 0xBF)]
    [InlineData('¡', 0xA1)]
    [InlineData('«', 0xAB)]
    [InlineData('»', 0xBB)]
    [InlineData('º', 0xBA)]
    [InlineData('ª', 0xAA)]
    [InlineData('°', 0xB0)]
    public void Spanish_characters_have_a_win_ansi_byte(char character, int expected)
        => Assert.Equal((byte)expected, PdfStandardFontMetrics.Encode(character));

    /// <summary>
    /// The typographic substitutions a word processor makes without being asked, which arrive
    /// in survey titles written by people who never chose them.
    /// </summary>
    [Theory]
    [InlineData('—', 0x97)] // em dash
    [InlineData('–', 0x96)] // en dash
    [InlineData('“', 0x93)] // left double quote
    [InlineData('”', 0x94)] // right double quote
    [InlineData('’', 0x92)] // right single quote / apostrophe
    [InlineData('…', 0x85)] // ellipsis
    [InlineData('€', 0x80)] // euro
    public void Typographic_substitutions_survive(char character, int expected)
        => Assert.Equal((byte)expected, PdfStandardFontMetrics.Encode(character));

    [Fact]
    public void A_c1_control_is_not_mistaken_for_the_symbol_that_shares_its_byte()
    {
        // U+0080..U+009F are Unicode controls; the WinAnsi symbols at those BYTE values have
        // entirely different code points. Passing a control straight through would print a
        // euro sign where the source held an invisible character -- a defect that looks like
        // data corruption in the export and cannot be traced back to its source.
        Assert.Equal(PdfStandardFontMetrics.Replacement, PdfStandardFontMetrics.Encode(''));
        Assert.Equal(PdfStandardFontMetrics.Replacement, PdfStandardFontMetrics.Encode(''));

        // ...while the real euro sign, U+20AC, still reaches byte 0x80.
        Assert.Equal((byte)0x80, PdfStandardFontMetrics.Encode('€'));
    }

    [Fact]
    public void A_character_the_encoding_cannot_name_becomes_a_visible_replacement()
    {
        // Not a zero byte and not a raw truncation: a '?' is visible to the reader, and a file
        // with a question mark in it is a translation problem, where a file with a stray byte
        // in it is a support ticket about a corrupt download.
        Assert.Equal(PdfStandardFontMetrics.Replacement, PdfStandardFontMetrics.Encode('中'));
        Assert.Equal(PdfStandardFontMetrics.Replacement, PdfStandardFontMetrics.Encode('α'));
    }

    [Fact]
    public void Line_breaks_and_tabs_become_spaces_rather_than_nothing()
    {
        // A raw newline inside a PDF literal string is legal and advances nothing: the viewer
        // draws no glyph and the words either side run together. A survey description pasted
        // from a document is full of them.
        Assert.Equal((byte)' ', PdfStandardFontMetrics.Encode('\n'));
        Assert.Equal((byte)' ', PdfStandardFontMetrics.Encode('\r'));
        Assert.Equal((byte)' ', PdfStandardFontMetrics.Encode('\t'));
    }

    /// <summary>
    /// Every character the encoder can emit is MEASURED -- not merely given a positive number.
    /// </summary>
    /// <remarks>
    /// This assertion used to read <c>CharacterWidth(...) > 0</c>, which is satisfied by
    /// precisely the failure it was hunting: a code with no entry is charged the width of
    /// <c>'?'</c>, which is positive, while the viewer goes on drawing the glyph the code really
    /// names. The test could not distinguish a hand-entered width from a guess, so it closed the
    /// question without answering it.
    ///
    /// <para>
    /// The sweep runs over the whole BMP rather than 0x20..0xFF, because <c>Encode</c> also
    /// folds characters from far outside Latin-1 -- the curly quotes, dashes and ellipsis a word
    /// processor substitutes without being asked -- into WinAnsi codes. Those are the entries
    /// most likely to be added without a width beside them.
    /// </para>
    /// </remarks>
    [Fact]
    public void Every_character_the_encoder_can_emit_is_measured_rather_than_guessed()
    {
        var swept = new HashSet<int>();

        for (var value = 0x20; value <= 0xFFFF; value++)
        {
            var character = (char)value;
            var code = PdfStandardFontMetrics.Encode(character);
            if (code == PdfStandardFontMetrics.Replacement && character != '?')
            {
                continue; // the encoder cannot name it; drawn as '?' and measured as one
            }

            Assert.True(
                PdfStandardFontMetrics.HasOwnWidth(code),
                $"U+{value:X4} is drawn as WinAnsi 0x{code:X2} but charged the replacement's width");

            swept.Add(code);
        }

        // The sweep has to have reached past ASCII, or a fold that stopped working would empty
        // the interesting half of the loop and every assertion in it.
        Assert.True(swept.Count > 200, $"the sweep only reached {swept.Count} codes");
        Assert.Contains(0xAB, swept);  // guillemotleft, Spanish quotation
        Assert.Contains(0xB7, swept);  // periodcentered, the separator SurveyExport draws
        Assert.Contains(0x92, swept);  // quoteright, reached only through the high fold
    }

    [Fact]
    public void The_unassigned_win_ansi_slots_are_unmeasured_and_nothing_encodes_to_them()
    {
        // The control on the sweep above, and the reason the assertion can no longer be `> 0`.
        // These five byte values name no glyph in WinAnsiEncoding, so they have no width -- and
        // a predicate whose false case nothing could reach would be indistinguishable from a
        // constant `true`, which is the failure mode the sweep is supposed to be immune to.
        int[] unassigned = [0x81, 0x8D, 0x8F, 0x90, 0x9D];

        foreach (var code in unassigned)
        {
            Assert.False(PdfStandardFontMetrics.HasOwnWidth(code), $"0x{code:X2} claims a width");

            // Charged the replacement's width, positive and plausible -- exactly what made the
            // old assertion unable to see it.
            Assert.True(PdfStandardFontMetrics.CharacterWidth('?', PdfStandardFont.Regular) > 0);
        }

        // And the encoder never produces one, which is what makes the gap harmless in practice
        // rather than merely undetected. Collected in one pass and compared as sets, because
        // 65,536 individual assertions cost nine seconds of a three-second suite.
        var produced = new HashSet<int>();
        for (var value = 0; value <= 0xFFFF; value++)
        {
            produced.Add(PdfStandardFontMetrics.Encode((char)value));
        }

        Assert.Empty(produced.Intersect(unassigned));
    }

    [Fact]
    public void A_measured_character_reports_so()
    {
        // The other half of the control: the predicate is not a constant `false` either.
        Assert.True(PdfStandardFontMetrics.HasOwnWidth(PdfStandardFontMetrics.Encode('«')));
        Assert.True(PdfStandardFontMetrics.HasOwnWidth(PdfStandardFontMetrics.Encode('·')));
        Assert.True(PdfStandardFontMetrics.HasOwnWidth(PdfStandardFontMetrics.Encode('ñ')));
        Assert.True(PdfStandardFontMetrics.HasOwnWidth(PdfStandardFontMetrics.Encode('A')));
    }

    [Fact]
    public void An_accented_letter_advances_exactly_like_its_base_letter()
    {
        // Not an approximation -- it is what the Helvetica AFM says, and it is the reason the
        // hand-entered part of the table stops at ASCII. If this ever stops holding, the fold
        // is wrong rather than merely imprecise.
        foreach (var (accented, plain) in new[] { ('á', 'a'), ('ñ', 'n'), ('Ó', 'O'), ('ü', 'u'), ('É', 'E') })
        {
            Assert.Equal(
                PdfStandardFontMetrics.CharacterWidth(plain, PdfStandardFont.Regular),
                PdfStandardFontMetrics.CharacterWidth(accented, PdfStandardFont.Regular));
            Assert.Equal(
                PdfStandardFontMetrics.CharacterWidth(plain, PdfStandardFont.Bold),
                PdfStandardFontMetrics.CharacterWidth(accented, PdfStandardFont.Bold));
        }
    }

    [Fact]
    public void Bold_is_measured_with_the_bold_table()
    {
        // The tempting shortcut is to measure both faces with the regular widths. Bold
        // Helvetica is wider almost everywhere, so a bold heading measured as regular overruns
        // the margin -- and headings are the one place capital-heavy Spanish appears.
        Assert.NotEqual(
            PdfStandardFontMetrics.MeasureText("EVALUACIÓN DE CLIMA", PdfStandardFont.Regular, 12),
            PdfStandardFontMetrics.MeasureText("EVALUACIÓN DE CLIMA", PdfStandardFont.Bold, 12));

        Assert.True(
            PdfStandardFontMetrics.MeasureText("Dirección", PdfStandardFont.Bold, 12)
            > PdfStandardFontMetrics.MeasureText("Dirección", PdfStandardFont.Regular, 12));
    }

    [Fact]
    public void A_known_string_measures_the_width_the_afm_tables_give_it()
    {
        // One arithmetic anchor, so the whole class is not self-referential. "Hola" in
        // Helvetica at 10pt: H 722 + o 556 + l 222 + a 556 = 2056/1000 em = 20.56pt.
        Assert.Equal(20.56, PdfStandardFontMetrics.MeasureText("Hola", PdfStandardFont.Regular, 10), 3);
    }

    [Fact]
    public void An_empty_string_measures_nothing()
    {
        Assert.Equal(0, PdfStandardFontMetrics.MeasureText(null, PdfStandardFont.Regular, 10));
        Assert.Equal(0, PdfStandardFontMetrics.MeasureText(string.Empty, PdfStandardFont.Bold, 10));
    }
}
