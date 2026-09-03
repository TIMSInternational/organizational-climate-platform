using System.Text;

namespace ClimateProject.Application.Reports.Rendering;

/// <summary>
/// The formats a report can actually be produced in, and the only place that decides.
///
/// <para>
/// <c>reports.format</c> was a free 10-character string that nothing branched on
/// (<c>ReportConfiguration.cs:22</c> caps the length and adds no check constraint), so the
/// column held whatever a caller sent and the download handed back JSON regardless. Now the
/// column is honoured, which makes the set of legal values load-bearing: a value stored here
/// is a promise that <see cref="ReportRenderer"/> can render it.
/// </para>
/// <para>
/// <b><c>excel</c> is refused, not downgraded.</b> The web offered it for a year and nothing
/// ever produced a spreadsheet; there is no xlsx writer in this solution to produce one with.
/// See <c>docs/decisions/report-rendering.md</c> for the whole argument. Accepting the word and
/// quietly handing back a PDF would be the worse half of both options -- the admin's choice is
/// recorded in the row, contradicted by the file, and nothing tells them.
/// </para>
/// </summary>
public static class ReportFormats
{
    /// <summary>The formatted document, rendered by <see cref="Exports.PdfDocument"/>.</summary>
    public const string Pdf = "pdf";

    /// <summary>The machine-readable long-format document, rendered by <see cref="Exports.CsvWriter"/>.</summary>
    public const string Csv = "csv";

    /// <summary>Every value <see cref="Normalise"/> accepts, in the order an error message names them.</summary>
    public static readonly string[] Supported = [Pdf, Csv];

    /// <summary>
    /// The canonical stored form of <paramref name="raw"/>, or null when it is not a format
    /// this solution can render.
    /// </summary>
    /// <remarks>
    /// Trimmed and lower-cased so <c>"PDF"</c> and <c>" pdf "</c> land on one row value --
    /// the reason <c>ReportForm.tsx</c> offered a fixed list in the first place was to stop
    /// one company accumulating "PDF", "pdf" and "Pdf". Case-insensitivity is
    /// <see cref="StringComparison.OrdinalIgnoreCase"/>, not a culture's: a Turkish-culture
    /// host lower-cases the I in "PDF" to a dotless ı and would reject it.
    /// </remarks>
    public static string? Normalise(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var trimmed = raw.Trim();
        foreach (var supported in Supported)
        {
            if (string.Equals(trimmed, supported, StringComparison.OrdinalIgnoreCase))
            {
                return supported;
            }
        }

        return null;
    }

    /// <summary>
    /// Whether a report whose stored format is <paramref name="storedFormat"/> should be
    /// rendered as CSV. Everything else -- including a legacy row saying <c>excel</c>, and a
    /// row saying nothing at all -- renders as PDF.
    /// </summary>
    /// <remarks>
    /// This is deliberately NOT <c>Normalise(x) is null =&gt; throw</c>. Rows created before
    /// <see cref="Normalise"/> guarded the column exist (the integration suite's own fixtures
    /// wrote <c>"type"</c> and <c>"excel"</c> into it), and a download that 500s on them would
    /// turn a year-old data defect into an outage on the one screen an administrator uses to
    /// get their report out. The caller logs the substitution -- see
    /// <c>ReportEndpoints.DownloadAsync</c> -- so the row is findable without the admin being
    /// the one who finds it.
    /// </remarks>
    public static bool IsCsv(string? storedFormat)
        => string.Equals(Normalise(storedFormat), Csv, StringComparison.Ordinal);

    /// <summary>The media type a rendered report is served as.</summary>
    public static string ContentType(bool csv) => csv ? "text/csv" : "application/pdf";

    /// <summary>
    /// The download name: the report's own title, reduced to something every filesystem and
    /// every <c>Content-Disposition</c> parser accepts, falling back to the id.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A title is authored prose -- "Informe de clima Q3 2026 (borrador)" -- and it is what an
    /// administrator will look for in their Downloads folder, so <c>report-{guid}.pdf</c> (the
    /// shape <c>SurveyExport.PdfFileName</c> uses, where there is no title to use) is a
    /// measurably worse artefact once a title exists. What it cannot be is the title verbatim:
    /// a path separator, a quote or a newline in a filename is a header-injection question, and
    /// a non-ASCII byte in <c>Content-Disposition</c> is an interoperability one.
    /// </para>
    /// <para>
    /// So the title is transliterated to ASCII letters and digits, everything else becomes a
    /// single hyphen, and the result is capped. When nothing survives -- a title written
    /// entirely in a script this cannot transliterate -- the id is used, because a file named
    /// <c>-.pdf</c> is worse than one named after a Guid.
    /// </para>
    /// </remarks>
    public static string FileName(string? title, Guid reportId, bool csv)
    {
        var extension = csv ? Csv : Pdf;
        var slug = Slug(title);
        return slug.Length == 0 ? $"report-{reportId}.{extension}" : $"{slug}.{extension}";
    }

    /// <summary>Longest slug a filename carries. Long enough for a real title, short of any filesystem's limit.</summary>
    private const int MaxSlugLength = 60;

    private static string Slug(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return string.Empty;
        }

        // FormD then drop the combining marks: "Clima Anual — Ámbito" becomes
        // "clima-anual-ambito" rather than "clima-anual-mbito". Dropping the accented letter
        // outright would silently shorten a Spanish word, which is most of this product's prose.
        var decomposed = title.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        var pendingSeparator = false;

        foreach (var character in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character)
                == System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsAsciiLetterOrDigit(character))
            {
                if (pendingSeparator && builder.Length > 0)
                {
                    builder.Append('-');
                }

                pendingSeparator = false;
                builder.Append(char.ToLowerInvariant(character));

                if (builder.Length >= MaxSlugLength)
                {
                    break;
                }

                continue;
            }

            // Every run of anything else collapses to one hyphen, and only if a kept character
            // follows it -- so no filename starts or ends with a separator.
            pendingSeparator = true;
        }

        return builder.ToString();
    }
}
