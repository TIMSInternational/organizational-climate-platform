namespace ClimateProject.Application.Exports;

/// <summary>
/// Which of the two base-14 faces a run of text is drawn in.
/// </summary>
/// <remarks>
/// Two, not fourteen. A climate report is headings, prose and tables; italic and the serif
/// families would be more resource dictionary entries and more width tables for no reader
/// benefit. Adding one later is an entry in <see cref="PdfStandardFontMetrics"/> and a
/// resource name, not a redesign.
/// </remarks>
public enum PdfStandardFont
{
    /// <summary>Helvetica. Body text, table cells.</summary>
    Regular = 0,

    /// <summary>Helvetica-Bold. Headings, table headers, emphasised values.</summary>
    Bold = 1,
}

/// <summary>
/// Character widths for the two Helvetica faces, and the Unicode -> WinAnsiEncoding mapping
/// that decides which byte a character is written as.
///
/// <para>
/// <b>Why widths at all.</b> A PDF viewer positions glyphs; it does not wrap text. Every line
/// break, every column boundary and every ellipsis in <see cref="PdfDocument"/> is decided
/// here, before a byte is written. Guessing an average width instead -- the tempting shortcut
/// -- overflows the margin on capital-heavy Spanish headings ("EVALUACIÓN DE CLIMA
/// ORGANIZACIONAL") and leaves a ragged half-empty column on lowercase prose, which is exactly
/// the sort of defect that only shows up in the artefact a client opens.
/// </para>
///
/// <para>
/// <b>Why the base-14 fonts and no embedding.</b> Helvetica and Helvetica-Bold are two of the
/// fourteen faces every conforming PDF reader is required to have, so the file carries no font
/// program: no licensing question, no megabyte of glyph data per export, and nothing to keep
/// in sync. The cost is that the document is limited to the glyphs WinAnsiEncoding can name.
/// </para>
///
/// <para>
/// <b>WinAnsiEncoding covers Spanish completely.</b> This is the reason the limitation is
/// acceptable rather than merely tolerable: á é í ó ú ü ñ, their capitals, ¿ and ¡ are all in
/// Latin-1 and therefore all have a WinAnsi code point. So do the typographic quotes and
/// dashes a word processor substitutes into a survey title. A character outside the encoding
/// becomes <c>?</c> rather than a corrupt byte -- visible, and not a broken file.
/// </para>
///
/// <para>
/// <b>Accented letters borrow their base letter's width.</b> In Helvetica an <c>á</c> is an
/// <c>a</c> with a mark above it and the two advance identically; the same holds for every
/// acute, grave, diaeresis, circumflex and tilde in the Latin-1 range. Folding them onto the
/// base letter is not an approximation -- it is what the AFM tables say -- and it keeps the
/// hand-entered numbers here down to the ASCII range plus the punctuation that genuinely
/// differs, which is the half of a width table a human can proofread.
/// </para>
/// </summary>
public static class PdfStandardFontMetrics
{
    /// <summary>The byte an unrepresentable character is written as.</summary>
    public const byte Replacement = (byte)'?';

    /// <summary>Widths for codes 32..126, in 1/1000 em, Helvetica.</summary>
    private static readonly short[] RegularAscii =
    [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ];

    /// <summary>Widths for codes 32..126, in 1/1000 em, Helvetica-Bold.</summary>
    private static readonly short[] BoldAscii =
    [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    ];

    /// <summary>
    /// The Latin-1 accented letters, each folded onto the ASCII letter it advances like.
    /// </summary>
    /// <remarks>
    /// Keyed by WinAnsi code, which for this range is the Unicode code point. See the class
    /// remarks for why the fold is exact rather than approximate.
    /// </remarks>
    private static readonly Dictionary<int, char> AccentFold = BuildAccentFold();

    /// <summary>
    /// Widths for the WinAnsi codes that are not letters and therefore cannot be folded --
    /// currency, the inverted marks, the fractions, the guillemets Spanish uses for quotation.
    /// </summary>
    private static readonly Dictionary<int, (short Regular, short Bold)> SymbolWidths = new()
    {
        [0x80] = (556, 556),   // euro
        [0x82] = (222, 278),   // quotesinglbase
        [0x83] = (556, 556),   // florin
        [0x84] = (333, 500),   // quotedblbase
        [0x85] = (1000, 1000), // ellipsis
        [0x86] = (556, 556),   // dagger
        [0x87] = (556, 556),   // daggerdbl
        [0x88] = (333, 333),   // circumflex
        [0x89] = (1000, 1000), // perthousand
        [0x8A] = (667, 722),   // Scaron
        [0x8B] = (333, 333),   // guilsinglleft
        [0x8C] = (1000, 1000), // OE
        [0x8E] = (611, 611),   // Zcaron
        [0x91] = (222, 278),   // quoteleft
        [0x92] = (222, 278),   // quoteright
        [0x93] = (333, 500),   // quotedblleft
        [0x94] = (333, 500),   // quotedblright
        [0x95] = (350, 350),   // bullet
        [0x96] = (556, 556),   // endash
        [0x97] = (1000, 1000), // emdash
        [0x98] = (333, 333),   // tilde
        [0x99] = (1000, 1000), // trademark
        [0x9A] = (500, 556),   // scaron
        [0x9B] = (333, 333),   // guilsinglright
        [0x9C] = (944, 944),   // oe
        [0x9E] = (500, 500),   // zcaron
        [0x9F] = (667, 667),   // Ydieresis
        [0xA0] = (278, 278),   // space (nbsp)
        [0xA1] = (333, 333),   // exclamdown
        [0xA2] = (556, 556),   // cent
        [0xA3] = (556, 556),   // sterling
        [0xA4] = (556, 556),   // currency
        [0xA5] = (556, 556),   // yen
        [0xA6] = (260, 280),   // brokenbar
        [0xA7] = (556, 556),   // section
        [0xA8] = (333, 333),   // dieresis
        [0xA9] = (737, 737),   // copyright
        [0xAA] = (370, 370),   // ordfeminine
        [0xAB] = (556, 556),   // guillemotleft
        [0xAC] = (584, 584),   // logicalnot
        [0xAD] = (333, 333),   // hyphen (soft)
        [0xAE] = (737, 737),   // registered
        [0xAF] = (333, 333),   // macron
        [0xB0] = (400, 400),   // degree
        [0xB1] = (584, 584),   // plusminus
        [0xB2] = (333, 333),   // twosuperior
        [0xB3] = (333, 333),   // threesuperior
        [0xB4] = (333, 333),   // acute
        [0xB5] = (556, 611),   // mu
        [0xB6] = (537, 556),   // paragraph
        [0xB7] = (278, 278),   // periodcentered
        [0xB8] = (333, 333),   // cedilla
        [0xB9] = (333, 333),   // onesuperior
        [0xBA] = (365, 365),   // ordmasculine
        [0xBB] = (556, 556),   // guillemotright
        [0xBC] = (834, 834),   // onequarter
        [0xBD] = (834, 834),   // onehalf
        [0xBE] = (834, 834),   // threequarters
        [0xBF] = (611, 611),   // questiondown
        [0xC6] = (1000, 1000), // AE
        [0xD0] = (722, 722),   // Eth
        [0xD7] = (584, 584),   // multiply
        [0xD8] = (778, 778),   // Oslash
        [0xDE] = (667, 667),   // Thorn
        [0xDF] = (611, 611),   // germandbls
        [0xE6] = (889, 889),   // ae
        [0xF0] = (556, 611),   // eth
        [0xF7] = (584, 584),   // divide
        [0xF8] = (611, 611),   // oslash
        [0xFE] = (556, 611),   // thorn
    };

    /// <summary>
    /// The WinAnsi codes for the characters outside Latin-1 that the encoding can still name.
    /// </summary>
    /// <remarks>
    /// These are the ones a word processor substitutes without being asked -- curly quotes for
    /// straight ones, an en dash for a hyphen, an ellipsis for three dots -- so they arrive in
    /// survey titles and department names written by people who never chose them. Mapping them
    /// is the difference between "Clima Q3 – Operaciones" and "Clima Q3 ? Operaciones".
    /// </remarks>
    private static readonly Dictionary<char, byte> HighUnicode = new()
    {
        ['€'] = 0x80, ['‚'] = 0x82, ['ƒ'] = 0x83, ['„'] = 0x84,
        ['…'] = 0x85, ['†'] = 0x86, ['‡'] = 0x87, ['ˆ'] = 0x88,
        ['‰'] = 0x89, ['Š'] = 0x8A, ['‹'] = 0x8B, ['Œ'] = 0x8C,
        ['Ž'] = 0x8E, ['‘'] = 0x91, ['’'] = 0x92, ['“'] = 0x93,
        ['”'] = 0x94, ['•'] = 0x95, ['–'] = 0x96, ['—'] = 0x97,
        ['˜'] = 0x98, ['™'] = 0x99, ['š'] = 0x9A, ['›'] = 0x9B,
        ['œ'] = 0x9C, ['ž'] = 0x9E, ['Ÿ'] = 0x9F,
    };

    /// <summary>The PostScript name of a face, as it appears in the font dictionary.</summary>
    public static string BaseFontName(PdfStandardFont font)
        => font == PdfStandardFont.Bold ? "Helvetica-Bold" : "Helvetica";

    /// <summary>The resource name a content stream selects a face by.</summary>
    public static string ResourceName(PdfStandardFont font) => font == PdfStandardFont.Bold ? "F2" : "F1";

    /// <summary>
    /// One character as its WinAnsiEncoding byte, or <see cref="Replacement"/> when the
    /// encoding cannot name it.
    /// </summary>
    /// <remarks>
    /// Control characters -- including the tab and the newline a pasted survey description
    /// carries -- become a space. A raw newline inside a PDF literal string is legal but shifts
    /// nothing: the viewer draws it as no glyph at all and the text silently runs together, so
    /// a visible space is the honest rendering. <see cref="PdfDocument"/> does its own line
    /// breaking above this.
    /// </remarks>
    public static byte Encode(char value)
    {
        if (value is '\n' or '\r' or '\t')
        {
            return (byte)' ';
        }

        if (value < 0x20)
        {
            return Replacement;
        }

        if (value <= 0x7E)
        {
            return (byte)value;
        }

        // 0xA0..0xFF only, written as numbers because the equivalent character literals
        // are a non-breaking space and a y-diaeresis -- invisible and near-invisible in a
        // source file, which is not a thing to hide an encoding boundary behind.
        //
        // U+0080..U+009F are deliberately excluded. They are Unicode C1 controls and are
        // NOT the WinAnsi symbols that occupy those byte values, so passing one through
        // would print a euro sign where the source held an invisible control character.
        // The characters that really do live in that byte range are reached by their true
        // Unicode code points, through HighUnicode below.
        if (value is >= (char)0xA0 and <= (char)0xFF)
        {
            return (byte)value;
        }

        return HighUnicode.TryGetValue(value, out var code) ? code : Replacement;
    }

    /// <summary>The advance width of one character, in 1/1000 em.</summary>
    public static short CharacterWidth(char value, PdfStandardFont font)
    {
        var code = (int)Encode(value);

        if (SymbolWidths.TryGetValue(code, out var symbol))
        {
            return font == PdfStandardFont.Bold ? symbol.Bold : symbol.Regular;
        }

        if (AccentFold.TryGetValue(code, out var folded))
        {
            code = folded;
        }

        if (code is < 32 or > 126)
        {
            // Anything still unaccounted for was replaced with '?'; charge it '?' 's width
            // rather than zero, so a line of them still wraps.
            code = Replacement;
        }

        var table = font == PdfStandardFont.Bold ? BoldAscii : RegularAscii;
        return table[code - 32];
    }

    /// <summary>The advance width of a string at <paramref name="fontSize"/>, in points.</summary>
    public static double MeasureText(string? text, PdfStandardFont font, double fontSize)
    {
        if (string.IsNullOrEmpty(text))
        {
            return 0;
        }

        var thousandths = 0;
        foreach (var character in text)
        {
            thousandths += CharacterWidth(character, font);
        }

        return thousandths * fontSize / 1000d;
    }

    private static Dictionary<int, char> BuildAccentFold()
    {
        var fold = new Dictionary<int, char>();

        void Map(char baseLetter, params int[] codes)
        {
            foreach (var code in codes)
            {
                fold[code] = baseLetter;
            }
        }

        Map('A', 0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5);
        Map('C', 0xC7);
        Map('E', 0xC8, 0xC9, 0xCA, 0xCB);
        Map('I', 0xCC, 0xCD, 0xCE, 0xCF);
        Map('N', 0xD1);
        Map('O', 0xD2, 0xD3, 0xD4, 0xD5, 0xD6);
        Map('U', 0xD9, 0xDA, 0xDB, 0xDC);
        Map('Y', 0xDD);
        Map('a', 0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5);
        Map('c', 0xE7);
        Map('e', 0xE8, 0xE9, 0xEA, 0xEB);
        Map('i', 0xEC, 0xED, 0xEE, 0xEF);
        Map('n', 0xF1);
        Map('o', 0xF2, 0xF3, 0xF4, 0xF5, 0xF6);
        Map('u', 0xF9, 0xFA, 0xFB, 0xFC);
        Map('y', 0xFD, 0xFF);

        return fold;
    }
}
