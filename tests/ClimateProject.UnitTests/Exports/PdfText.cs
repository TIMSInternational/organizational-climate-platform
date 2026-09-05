using System.Text;
using System.Text.RegularExpressions;
using ClimateProject.Application.Exports;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// Reads a <see cref="PdfDocument"/> back as the literal strings it actually draws on a page.
///
/// <para>
/// <b>Why a reader rather than a substring search.</b> A substring search over the whole file
/// cannot express "no cell is the string <c>0</c>", which is the one assertion the suppression
/// branches are provable by: a PDF's cross-reference table, its object numbers and its
/// coordinates are full of zeros. Reading the literals back also means an accented Spanish
/// label is compared as the character rather than as the octal escape the serialiser emitted.
/// </para>
/// <para>
/// <b>Why it is shared.</b> Two exporters now render PDFs -- reports and dashboards -- and both
/// have to prove the same thing about withheld figures. Two copies of this reader could drift,
/// and a drifted reader fails in the worst possible direction: it makes a suppression test go
/// green against a file that never contained the suppression.
/// </para>
/// </summary>
internal static partial class PdfText
{
    /// <summary>Every string drawn on a page, in the order the content stream draws them.</summary>
    public static IReadOnlyList<string> DrawnStrings(PdfDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var content = Encoding.Latin1.GetString(document.ToBytes());

        // `Tm (` anchors on the text-positioning operator, so /Info's /Title -- a literal too,
        // and not drawn on any page -- is excluded by construction rather than by an index.
        return [.. TjPattern().Matches(content).Select(match => Unescape(match.Groups["literal"].Value))];
    }

    /// <summary>The drawn strings rejoined into prose.</summary>
    /// <remarks>
    /// <see cref="PdfDocument.WrapText"/> breaks a paragraph on whitespace, so rejoining the
    /// lines with a single space reconstructs the sentence exactly -- which is what lets a test
    /// assert on a sentence rather than on wherever the wrapper happened to break it. A test
    /// that searched one drawn line for a sentence would go green or red depending on the
    /// content width, which is not the guarantee.
    /// </remarks>
    public static string Prose(PdfDocument document) => string.Join(" ", DrawnStrings(document));

    /// <summary>Reverses <c>PdfDocument.LiteralString</c>: the escapes back into characters.</summary>
    public static string Unescape(string literal)
    {
        ArgumentNullException.ThrowIfNull(literal);

        var builder = new StringBuilder(literal.Length);
        for (var i = 0; i < literal.Length; i++)
        {
            if (literal[i] != '\\')
            {
                builder.Append(literal[i]);
                continue;
            }

            i++;
            if (i >= literal.Length)
            {
                break;
            }

            if (char.IsAsciiDigit(literal[i]))
            {
                // WinAnsi is Latin-1 over the range this product's Spanish uses, which is what
                // makes the octal escape decodable back to a char at all.
                var octal = literal.Substring(i, Math.Min(3, literal.Length - i));
                builder.Append((char)Convert.ToInt32(octal, 8));
                i += octal.Length - 1;
                continue;
            }

            builder.Append(literal[i]);
        }

        return builder.ToString();
    }

    [GeneratedRegex(@"Tm \((?<literal>(?:\\.|[^\\)])*)\) Tj")]
    private static partial Regex TjPattern();
}
