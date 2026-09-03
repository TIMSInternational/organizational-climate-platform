using System.Text.Json;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Reports.Rendering;

/// <summary>
/// Everything a rendered report needs, and the only way to build one.
/// </summary>
/// <param name="Document">
/// The stored <see cref="ReportOutputDocument"/>, or <b>null</b> when <c>reports.report_output</c>
/// is empty or is not a document this version can read. Nullable on purpose: rows written before
/// #88 hold a bare JSON string (the old placeholder), and a download that threw on them would
/// turn a year-old data shape into a 500 on the one screen an administrator uses to get their
/// report out. <see cref="ReportRenderer"/> prints a document that says so instead.
/// </param>
/// <param name="GeneratedAt">
/// <c>generation_completed_at</c> where there is one, else <c>created_at</c>. The instant the
/// numbers in the document are true as of -- not "now", which would restamp an old report every
/// time it was downloaded and make two copies of one document disagree about their own date.
/// </param>
public sealed record ReportRenderContext(
    Guid ReportId,
    string? Title,
    string? Description,
    string Type,
    DateTimeOffset GeneratedAt,
    ReportOutputDocument? Document)
{
    /// <summary>
    /// The locale the document's own chrome -- headings, table headers, the privacy notice --
    /// is printed in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A report is a company document with no <c>?lang</c> to honour, and its sections can
    /// legitimately disagree: a company running one English and one Spanish survey has two
    /// sections with two <see cref="ReportSurveySection.ResolvedLocale"/> values, and the
    /// authored text inside each is in that section's language whatever this property says.
    /// </para>
    /// <para>
    /// So the chrome follows the FIRST section -- which is the newest survey, because
    /// <c>ReportGeneration</c> orders by <c>created_at</c> descending -- and every section
    /// header additionally prints the locale it is in. The alternative considered was a
    /// majority vote across sections, which changes a document's language when a survey is
    /// added and is therefore worse: two downloads of the same report would come back in
    /// different languages. An empty document falls back to
    /// <see cref="ContentLanguages.FallbackLocale"/>.
    /// </para>
    /// </remarks>
    public string ChromeLocale
        => Document?.Surveys.Count > 0
            ? ContentLanguages.NormaliseLocale(Document.Surveys[0].ResolvedLocale) ?? ContentLanguages.FallbackLocale
            : ContentLanguages.FallbackLocale;
}

/// <summary>
/// The one way <c>reports.report_output</c> is turned back into a document.
/// </summary>
public static class ReportDocumentReader
{
    /// <summary>
    /// The stored document, or null when there is nothing readable there.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="JsonSerializerOptions.Web"/>, which is what <c>ReportGeneration</c> serialized
    /// with -- camelCase, case-insensitive. Reading it back with the default options would
    /// silently produce a document whose every property is its default, because
    /// <c>generationNote</c> does not match <c>GenerationNote</c> under a case-sensitive
    /// comparison: a null-shaped document rather than an exception, which is the worst of the
    /// three outcomes.
    /// </para>
    /// <para>
    /// A <see cref="JsonException"/> is caught rather than propagated because the column is not
    /// under this code's control: <c>report_output</c> is <c>jsonb</c> and Postgres will accept
    /// any valid JSON, including the bare string the pre-#88 stub wrote
    /// (<c>"Report generation is stubbed…"</c>, which the web's own test fixture still carries).
    /// Distinguishing "no document" from "a document I cannot read" is not worth a second
    /// return channel: both mean the same thing to a reader of the file, and the renderer says
    /// it plainly.
    /// </para>
    /// </remarks>
    public static ReportOutputDocument? Parse(string? reportOutput)
    {
        if (string.IsNullOrWhiteSpace(reportOutput))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<ReportOutputDocument>(reportOutput, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return null;
        }
        catch (NotSupportedException)
        {
            // Thrown, not JsonException, when the JSON is well-formed but its shape cannot be
            // bound at all -- a bare `"string"` where an object is required is this case, and it
            // is exactly the legacy row above.
            return null;
        }
    }
}
