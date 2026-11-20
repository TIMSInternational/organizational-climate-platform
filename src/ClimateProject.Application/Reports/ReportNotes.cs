using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Reports;

/// <summary>
/// «Notas de TIMS» on a report: introduction, conclusions and recommendations, in Spanish and
/// in English (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>). The six
/// columns are <c>reports.notes_{intro,conclusions,recommendations}_{en,es}</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>TIMS's words, not respondent data.</b> Nothing here is aggregated or floored: a note is
/// authored by an administrator and printed where the report itself is printed -- the PDF and
/// the shared link's page -- and nowhere else.
/// </para>
/// <para>
/// <b>One language per reading, never the other one's words.</b> A note written only in Spanish
/// is not printed in an English document (<see cref="For"/>), the rule the editable-content
/// ruling applies to every client-facing text.
/// </para>
/// <para>
/// <b>Plain text.</b> A blank line separates paragraphs (<see cref="Paragraphs"/>); a single line
/// break inside a paragraph is a soft wrap. No markup is interpreted anywhere.
/// </para>
/// </remarks>
public static class ReportNotes
{
    /// <summary>The width of each of the six columns.</summary>
    public const int MaxLength = 4000;

    /// <summary>The six fields as the wire names them, in the order a refusal checks them.</summary>
    public static readonly IReadOnlyList<string> Fields =
    [
        "introEs", "introEn", "conclusionsEs", "conclusionsEn", "recommendationsEs", "recommendationsEn",
    ];

    /// <summary>The report's notes as stored, both languages, for an editor.</summary>
    public static ReportNotesDto From(Report report)
    {
        ArgumentNullException.ThrowIfNull(report);
        return new ReportNotesDto(
            report.NotesIntroEs,
            report.NotesIntroEn,
            report.NotesConclusionsEs,
            report.NotesConclusionsEn,
            report.NotesRecommendationsEs,
            report.NotesRecommendationsEn);
    }

    /// <summary>
    /// The first field longer than <see cref="MaxLength"/> after trimming, or null when every
    /// field fits. Measured on the value that would be stored, so trailing whitespace pasted from
    /// a document is never the reason for a refusal.
    /// </summary>
    public static string? FirstTooLong(ReportNotesDto? notes)
    {
        if (notes is null)
        {
            return null;
        }

        var values = Values(notes);
        for (var i = 0; i < values.Count; i++)
        {
            if (Normalise(values[i]) is { Length: > MaxLength })
            {
                return Fields[i];
            }
        }

        return null;
    }

    /// <summary>
    /// Writes all six columns from <paramref name="notes"/>: a whole replacement, so an absent or
    /// blank field clears that note. Call <see cref="FirstTooLong"/> first.
    /// </summary>
    public static void Apply(Report report, ReportNotesDto? notes)
    {
        ArgumentNullException.ThrowIfNull(report);
        report.NotesIntroEs = Normalise(notes?.IntroEs);
        report.NotesIntroEn = Normalise(notes?.IntroEn);
        report.NotesConclusionsEs = Normalise(notes?.ConclusionsEs);
        report.NotesConclusionsEn = Normalise(notes?.ConclusionsEn);
        report.NotesRecommendationsEs = Normalise(notes?.RecommendationsEs);
        report.NotesRecommendationsEn = Normalise(notes?.RecommendationsEn);
    }

    /// <summary>
    /// The notes in exactly <paramref name="locale"/>, or null when none is set in it. Never the
    /// other language's text: an unset note in this locale is an absent page, not a Spanish page
    /// in an English document.
    /// </summary>
    public static ReportNotesText? For(Report report, string? locale)
    {
        ArgumentNullException.ThrowIfNull(report);
        var spanish = string.Equals(
            ContentLanguages.NormaliseLocale(locale) ?? ContentLanguages.FallbackLocale,
            ContentLanguages.Spanish,
            StringComparison.Ordinal);

        var text = new ReportNotesText(
            spanish ? ContentLanguages.Spanish : ContentLanguages.English,
            Normalise(spanish ? report.NotesIntroEs : report.NotesIntroEn),
            Normalise(spanish ? report.NotesConclusionsEs : report.NotesConclusionsEn),
            Normalise(spanish ? report.NotesRecommendationsEs : report.NotesRecommendationsEn));

        return text is { Introduction: null, Conclusions: null, Recommendations: null } ? null : text;
    }

    /// <summary>
    /// A note's paragraphs: split on blank lines, each paragraph's own line breaks folded into
    /// spaces, empty paragraphs dropped. The PDF and the web split the same way.
    /// </summary>
    public static IReadOnlyList<string> Paragraphs(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var paragraphs = new List<string>();
        var current = new List<string>();
        foreach (var line in text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n'))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                Flush();
                continue;
            }

            current.Add(line.Trim());
        }

        Flush();
        return paragraphs;

        void Flush()
        {
            if (current.Count > 0)
            {
                paragraphs.Add(string.Join(' ', current));
                current.Clear();
            }
        }
    }

    private static IReadOnlyList<string?> Values(ReportNotesDto notes)
        =>
        [
            notes.IntroEs, notes.IntroEn, notes.ConclusionsEs, notes.ConclusionsEn, notes.RecommendationsEs,
            notes.RecommendationsEn,
        ];

    /// <summary>Trimmed, line endings unified, blank as null.</summary>
    private static string? Normalise(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim();
    }
}

/// <summary>
/// «Notas de TIMS» on the wire: the body of <c>PUT /admin/reports/{id}/notes</c>, the optional
/// <c>notes</c> of <c>POST /admin/reports</c>, and <see cref="ReportDetail.Notes"/>. Both
/// languages, because the editor edits both; null or blank is "no note".
/// </summary>
public sealed record ReportNotesDto(
    string? IntroEs = null,
    string? IntroEn = null,
    string? ConclusionsEs = null,
    string? ConclusionsEn = null,
    string? RecommendationsEs = null,
    string? RecommendationsEn = null);

/// <summary>
/// The notes as one reading prints them: one language, named, each null when unset.
/// </summary>
/// <param name="Locale">The language the three texts are in.</param>
public sealed record ReportNotesText(
    string Locale,
    string? Introduction,
    string? Conclusions,
    string? Recommendations);
