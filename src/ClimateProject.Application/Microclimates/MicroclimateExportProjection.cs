using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Microclimates;

/// <summary>
/// Disclosure control for a microclimate export, and the CSV rendering of the result.
///
/// <para>
/// <b>Why this exists at all.</b> Until #131 nothing applied a small-group floor to a
/// microclimate anywhere on the server. <c>SubmitResponseAsync</c> merges every respondent's
/// words into <c>LiveResults.WordCloudData</c> and <c>GetLiveResultsAsync</c> hands the raw
/// map straight back, so a session with two responses returned whatever those two people
/// typed. The web app carries a client-side mitigation (<c>microclimatePrivacy.ts</c>) whose
/// own docblock says, correctly, that it is "applied client side because nothing applies it
/// server side". An export is a file that leaves the building; a control that lives in the
/// browser does not travel with it. So the floors are enforced here, before the bytes are
/// written.
/// </para>
///
/// <para>
/// <b>The floors are bound, not copied.</b> Both constants come from
/// <see cref="SurveyResultsPrivacy"/>. Microclimate groups are small by nature -- that is
/// what a microclimate is -- so a floor lower than the survey surface's would make this the
/// cheapest place in the product to difference one workforce against itself. Binding to the
/// same constants means tuning either number moves both surfaces together, which is the
/// property <c>SurveyResultsPrivacy.MinimumSegmentRespondents</c> makes the same argument
/// for at length.
/// </para>
///
/// <para>
/// <b>What the word floor can and cannot promise.</b> The stored counts are word
/// OCCURRENCES, not distinct respondents: <c>CountWordFrequencies</c> increments per word per
/// text, so one person writing "visa visa" produces a count of 2 and clears an occurrence
/// floor of 2 on their own. <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/> counts
/// responses containing the word, which is the thing that actually bounds re-identification.
/// The two are therefore NOT equivalent, and this class does not pretend otherwise: the
/// <em>session</em> floor is the load-bearing control here and the per-word one is a
/// useful-but-partial second layer. Making the per-word floor mean what it says requires a
/// respondent-keyed count that the schema cannot currently express -- there is no per-response
/// row to key on. That is recorded on #131 rather than papered over.
/// </para>
///
/// <para>
/// <b>Counters are never suppressed.</b> <c>ResponseCount</c>, the target and the
/// participation rate are reported whatever the floors do, matching the argument
/// <see cref="SurveyResultsPrivacy"/> makes: "3 of 40 so far" identifies nobody, and it is
/// the number that tells an admin whether the session is worth chasing. What is withheld is
/// withheld <em>visibly</em> -- <c>WithheldWordCount</c> and <c>SuppressionReason</c> travel
/// with the payload so a reader can tell "nobody wrote anything" from "this was withheld"
/// and the totals still reconcile.
/// </para>
/// </summary>
public static class MicroclimateExportProjection
{
    /// <summary>Machine-readable reason codes. Not display copy.</summary>
    public const string BelowMinimumRespondents = SurveyResultsPrivacy.BelowMinimumRespondents;

    /// <inheritdoc cref="BelowMinimumRespondents"/>
    public const string RareWordsWithheld = "rare_words_withheld";

    /// <summary>
    /// Applies both floors to a session's word cloud and assembles the export payload.
    /// </summary>
    /// <param name="words">The stored cloud, unsuppressed.</param>
    /// <param name="responseCount">
    /// The session's own total, not the word list's length: the floor is about how many
    /// people could be re-identified, not about how much they wrote.
    /// </param>
    public static MicroclimateExport Project(
        Guid id,
        string? title,
        string? description,
        Guid companyId,
        string status,
        string language,
        string resolvedLocale,
        IReadOnlyList<string> fallbackFields,
        DateTimeOffset startTime,
        DateTimeOffset endTime,
        int responseCount,
        int targetParticipantCount,
        string engagementLevel,
        double sentimentScore,
        IReadOnlyList<QuestionDto> questions,
        IReadOnlyList<WordCloudEntry> words,
        DateTimeOffset generatedAt)
    {
        ArgumentNullException.ThrowIfNull(questions);
        ArgumentNullException.ThrowIfNull(words);
        ArgumentNullException.ThrowIfNull(fallbackFields);

        var (kept, withheld, reason) = SuppressWords(words, responseCount);

        return new MicroclimateExport(
            id,
            title,
            description,
            companyId,
            status,
            language,
            resolvedLocale,
            fallbackFields,
            startTime,
            endTime,
            responseCount,
            targetParticipantCount,
            ParticipationPercent(responseCount, targetParticipantCount),
            engagementLevel,
            sentimentScore,
            questions,
            kept,
            reason == BelowMinimumRespondents,
            withheld,
            reason,
            generatedAt);
    }

    /// <summary>
    /// Participation as a percentage, or null when there is no denominator.
    /// </summary>
    /// <remarks>
    /// Null rather than 0: a rate computed against a target of zero is an invented
    /// denominator. Matches <c>participationPercent</c> in <c>microclimatePrivacy.ts</c> and
    /// <c>charts/participation.ts</c>, so the export and the screens it is exported from
    /// cannot disagree about the same session.
    /// </remarks>
    public static double? ParticipationPercent(int responseCount, int targetParticipantCount)
        => targetParticipantCount <= 0 ? null : (double)responseCount / targetParticipantCount * 100;

    private static (IReadOnlyList<MicroclimateExportWord> Kept, int Withheld, string? Reason) SuppressWords(
        IReadOnlyList<WordCloudEntry> words,
        int responseCount)
    {
        // The whole session is below the floor: every word is withheld, and the count says
        // how many, so the reader can see that there WAS something here.
        if (!SurveyResultsPrivacy.MeetsSurveyFloor(responseCount))
        {
            return ([], words.Count, BelowMinimumRespondents);
        }

        var kept = words
            .Where(w => SurveyResultsPrivacy.MeetsWordFloor(w.Value))
            .OrderByDescending(w => w.Value)
            .ThenBy(w => w.Text, StringComparer.Ordinal)
            .Select(w => new MicroclimateExportWord(w.Text, w.Language, w.Value))
            .ToList();

        var withheld = words.Count - kept.Count;
        return (kept, withheld, withheld > 0 ? RareWordsWithheld : null);
    }

    /// <summary>
    /// The export as CSV.
    /// </summary>
    /// <remarks>
    /// <b>Long format</b> -- <c>section,key,language,value</c> -- rather than one wide row per
    /// entity. A microclimate export is two shapes at once (a handful of session-level
    /// scalars, and a variable-length word list), and the alternatives are worse: a wide row
    /// would repeat every scalar on every word, and two files would let a reader open the
    /// word cloud without the response count it has to be read against. The suppression
    /// bookkeeping rides in the same column as everything else, so a spreadsheet filtered to
    /// <c>section = summary</c> still shows what was withheld.
    ///
    /// <para>
    /// Takes the already-suppressed <see cref="MicroclimateExport"/> rather than the raw
    /// aggregate, so there is no path to a CSV that skipped the floors.
    /// </para>
    /// </remarks>
    public static byte[] ToCsv(MicroclimateExport export)
    {
        ArgumentNullException.ThrowIfNull(export);

        var csv = new CsvWriter("section", "key", "language", "value");

        csv.AppendRow("summary", "microclimate_id", "", export.Id.ToString());
        csv.AppendRow("summary", "title", export.ResolvedLocale, export.Title);
        csv.AppendRow("summary", "description", export.ResolvedLocale, export.Description);
        csv.AppendRow("summary", "status", "", export.Status);
        csv.AppendRow("summary", "content_language", "", export.Language);

        // One row per field that fell back, so the label travels with the file rather than
        // living only in the JSON an admin never sees.
        foreach (var field in export.FallbackFields)
        {
            csv.AppendRow("summary", "untranslated_field", export.ResolvedLocale, field);
        }

        csv.AppendRow("summary", "start_time", "", export.StartTime.ToString("O"));
        csv.AppendRow("summary", "end_time", "", export.EndTime.ToString("O"));
        csv.AppendRow("summary", "response_count", "", CsvWriter.Number(export.ResponseCount));
        csv.AppendRow("summary", "target_participant_count", "", CsvWriter.Number(export.TargetParticipantCount));
        csv.AppendRow(
            "summary",
            "participation_percent",
            "",
            export.ParticipationPercent is double pct ? CsvWriter.Number(pct) : "");
        csv.AppendRow("summary", "engagement_level", "", export.EngagementLevel);
        csv.AppendRow("summary", "sentiment_score", "", CsvWriter.Number(export.SentimentScore));

        // Suppression bookkeeping is part of the document, not a header a reader can drop.
        csv.AppendRow("summary", "is_suppressed", "", export.IsSuppressed ? "true" : "false");
        csv.AppendRow("summary", "withheld_word_count", "", CsvWriter.Number(export.WithheldWordCount));
        csv.AppendRow("summary", "suppression_reason", "", export.SuppressionReason);
        csv.AppendRow("summary", "generated_at", "", export.GeneratedAt.ToString("O"));

        foreach (var question in export.Questions)
        {
            csv.AppendRow("question", CsvWriter.Number(question.Order), export.ResolvedLocale, question.Text);
        }

        foreach (var word in export.Words)
        {
            csv.AppendRow("word", word.Text, word.Language, CsvWriter.Number(word.Occurrences));
        }

        return csv.ToBytes();
    }
}
