using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// Everything an export needs about one survey, and the only way to build one.
/// </summary>
/// <param name="Aggregate">
/// <b>Already suppressed.</b> This is <see cref="SurveyAggregation.Compute"/>'s own output,
/// carried verbatim -- the same object <c>/results</c>, <c>/statistics</c>, <c>/analytics</c>
/// and report generation serve. Nothing downstream of here recomputes a floor, which is what
/// makes "the export shows what the screen withholds" impossible rather than unlikely. See
/// <see cref="SurveyExport"/>.
/// </param>
/// <param name="ResolvedLocale">
/// The locale the caller is actually READING, not the one they asked for -- same contract as
/// <c>SurveyResultsResponse.ResolvedLocale</c>. It picks the PDF's chrome language and labels
/// the resolved text in the CSV.
/// </param>
/// <param name="FallbackFields">
/// The fields that fell back to the other locale. Carried into the file rather than left in a
/// JSON payload an admin never sees: an export is forwarded to people who cannot ask why a
/// question is in the wrong language.
/// </param>
public sealed record SurveyExportContext(
    Guid SurveyId,
    string? Title,
    string Status,
    string ContentLanguage,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    SurveyAggregate Aggregate,
    DateTimeOffset GeneratedAt);

/// <summary>
/// One survey's results as a file: the CSV rows and the PDF document, from one projection.
///
/// ## The anonymity floor is inherited, never re-applied
///
/// Everything printed here comes off a <see cref="SurveyAggregate"/> that
/// <see cref="SurveyAggregation.Compute"/> has already suppressed. This class computes no
/// floor, compares nothing against <see cref="SurveyResultsPrivacy"/>, and has no branch that
/// could disagree with the screen -- when the survey is below
/// <see cref="SurveyResultsPrivacy.MinimumRespondents"/> the aggregate's
/// <c>Questions</c>/<c>Dimensions</c>/<c>Breakdowns</c> are already empty, and when a segment
/// is below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/> its own
/// <c>Questions</c> are already empty and its counts already zero.
///
/// That is a deliberate structural choice and not a convenience. An export is the surface
/// where a disclosure control is most likely to be bypassed by accident, because it is written
/// by different code from the screen and read by people the screen never reached. The only way
/// to make that impossible is for the export to have no suppression logic to get wrong. What
/// it does instead is *report* the suppression: withheld counts and reason codes are part of
/// both documents, so a reader can tell "nobody answered" from "this was withheld".
///
/// ## What is deliberately NOT exported: per-respondent rows
///
/// #122's scope says "CSV of raw responses". This class exports the aggregate instead, and the
/// reason is a guarantee already written down elsewhere in this codebase.
/// <see cref="SurveyResultsPrivacy"/> justifies NOT suppressing a bucket of one -- "one person
/// strongly disagreed" -- on the grounds that it "says nothing about *which* respondent, and
/// the joint distribution that would let a reader link two answers to one person is never
/// exposed". A per-respondent CSV is exactly that joint distribution. Shipping one would not
/// add a feature to the export; it would retroactively invalidate the argument that lets every
/// singleton bucket be displayed on the results screen, and it would do it in the format most
/// likely to be forwarded outside the company.
///
/// The same holds, more sharply, for verbatim open text: the results surface returns word
/// frequencies and never the sentences, because "one respondent writing 'my visa renewal'
/// names themselves to a reader who knows the team". An export that carried the sentences
/// would reveal precisely what the screen withholds.
///
/// So the raw-response export is refused here rather than half-built, and #122 carries the
/// decision. Making it safe is a real piece of work -- it needs a documented re-identification
/// model, not a flag -- and it is not made safe by being written carefully.
///
/// ## Why one class produces both formats
///
/// The same reason <c>SurveyAggregateLoader</c> is shared with report generation: two
/// projections over one aggregate is how "the CSV says 62% and the PDF says 58%" happens. Both
/// documents below read the same fields in the same order.
/// </summary>
public static class SurveyExport
{
    /// <summary>The CSV's column names. Fixed, and the same for every survey.</summary>
    /// <remarks>
    /// <b>Long format</b>, following the shape <c>MicroclimateExportProjection.ToCsv</c>
    /// established, and for the reason it gives: a survey export is five shapes at once -- a
    /// handful of scalars, a question list, a distribution per question, a word list, a segment
    /// table -- and a wide row would have to repeat every scalar on every bucket. A reader
    /// filters on <c>section</c> and pivots; the suppression bookkeeping rides in the same
    /// columns as everything else, so it cannot be dropped by a reader who only kept the rows
    /// they wanted.
    /// </remarks>
    public static readonly string[] Columns = ["section", "question", "group", "language", "metric", "value"];

    /// <summary>Section names. Constants because the CSV is a machine-readable surface.</summary>
    public const string SummarySection = "summary";

    /// <inheritdoc cref="SummarySection"/>
    public const string LanguageSection = "language";

    /// <inheritdoc cref="SummarySection"/>
    public const string QuestionSection = "question";

    /// <inheritdoc cref="SummarySection"/>
    public const string OptionSection = "option";

    /// <inheritdoc cref="SummarySection"/>
    public const string WordSection = "word";

    /// <inheritdoc cref="SummarySection"/>
    public const string DimensionSection = "dimension";

    /// <inheritdoc cref="SummarySection"/>
    public const string BreakdownSection = "breakdown";

    /// <inheritdoc cref="SummarySection"/>
    public const string SegmentSection = "segment";

    /// <inheritdoc cref="SummarySection"/>
    public const string SegmentQuestionSection = "segment_question";

    /// <summary>The download name of a survey's CSV.</summary>
    public static string CsvFileName(Guid surveyId) => $"survey-{surveyId}-results.csv";

    /// <summary>The download name of a survey's PDF.</summary>
    public static string PdfFileName(Guid surveyId) => $"survey-{surveyId}-results.pdf";

    // ------------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------------

    /// <summary>
    /// Writes the whole document to <paramref name="csv"/>, header row included.
    /// </summary>
    /// <remarks>
    /// Row by row, awaiting each: the writer holds one row at a time and this method holds no
    /// accumulated buffer, so the export's own memory is flat in the number of rows. What is
    /// not flat is the aggregation upstream -- <c>SurveyAggregateLoader</c> materialises every
    /// answer of every completed response to compute the aggregate, which is the same cost
    /// <c>/results</c> has always paid. This slice does not change it, and pretending otherwise
    /// would be worse than saying so.
    /// </remarks>
    public static async Task WriteCsvAsync(
        CsvStreamWriter csv,
        SurveyExportContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(csv);
        ArgumentNullException.ThrowIfNull(context);

        var aggregate = context.Aggregate;
        var summary = aggregate.Summary;
        var locale = context.ResolvedLocale;

        await csv.WriteHeaderAsync(cancellationToken).ConfigureAwait(false);

        Task Row(string section, string? question, string? group, string? language, string metric, string? value)
            => csv.WriteRowAsync(cancellationToken, section, question, group, language, metric, value);

        Task Summary(string group, string? value, string? language = null)
            => Row(SummarySection, null, group, language, "value", value);

        await Summary("survey_id", context.SurveyId.ToString()).ConfigureAwait(false);
        await Summary("title", context.Title, locale).ConfigureAwait(false);
        await Summary("status", context.Status).ConfigureAwait(false);
        await Summary("content_language", context.ContentLanguage).ConfigureAwait(false);
        await Summary("resolved_locale", locale).ConfigureAwait(false);

        foreach (var field in context.FallbackFields)
        {
            await Summary("untranslated_field", field, locale).ConfigureAwait(false);
        }

        await Summary("invited_count", Optional(summary.InvitedCount)).ConfigureAwait(false);
        await Summary("response_count", Number(summary.ResponseCount)).ConfigureAwait(false);
        await Summary("completed_count", Number(summary.CompletedCount)).ConfigureAwait(false);
        await Summary("partial_count", Number(summary.PartialCount)).ConfigureAwait(false);
        await Summary("participation_rate", Optional(summary.ParticipationRate)).ConfigureAwait(false);
        await Summary("completion_rate", Number(summary.CompletionRate)).ConfigureAwait(false);
        await Summary("average_completion_seconds", Optional(summary.AverageCompletionSeconds)).ConfigureAwait(false);
        await Summary("first_response_at", summary.FirstResponseAt?.ToString("O")).ConfigureAwait(false);
        await Summary("last_response_at", summary.LastResponseAt?.ToString("O")).ConfigureAwait(false);

        // The floors themselves travel with the file. A reader holding a spreadsheet of
        // withheld rows has to be able to see what the threshold was without opening the app.
        await Summary("minimum_respondents", Number(SurveyResultsPrivacy.MinimumRespondents)).ConfigureAwait(false);
        await Summary("minimum_segment_respondents", Number(aggregate.MinimumGroupSize)).ConfigureAwait(false);
        await Summary("minimum_word_respondents", Number(SurveyResultsPrivacy.MinimumWordRespondents)).ConfigureAwait(false);
        await Summary("is_suppressed", Boolean(aggregate.IsSuppressed)).ConfigureAwait(false);
        await Summary("suppression_reason", aggregate.SuppressionReason).ConfigureAwait(false);
        await Summary("generated_at", context.GeneratedAt.ToString("O")).ConfigureAwait(false);

        foreach (var language in summary.ByLanguage)
        {
            await Row(LanguageSection, null, language.Language, language.Language, "response_count", Number(language.Count))
                .ConfigureAwait(false);
        }

        // Below the survey floor these three collections are empty -- the aggregation emptied
        // them, not this loop. There is deliberately no `if (IsSuppressed)` branch here: a
        // guard that has to be remembered is a guard that will be forgotten by whoever adds
        // the sixth section.
        foreach (var question in aggregate.Questions)
        {
            var order = Number(question.Order + 1);
            var id = question.QuestionId.ToString();

            await Row(QuestionSection, order, id, locale, "text", question.Text).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "type", question.Type).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "category", question.Category).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "answered_count", Number(question.AnsweredCount)).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "average", Optional(question.Average)).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "median", Optional(question.Median)).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "scale_min", Optional(question.ScaleMin)).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "scale_max", Optional(question.ScaleMax)).ConfigureAwait(false);
            await Row(QuestionSection, order, id, locale, "scale_label_min", question.ScaleLabelMin).ConfigureAwait(false);
            await Row(QuestionSection, order, id, locale, "scale_label_max", question.ScaleLabelMax).ConfigureAwait(false);
            await Row(QuestionSection, order, id, null, "suppressed_word_count", Number(question.SuppressedWordCount)).ConfigureAwait(false);

            foreach (var bucket in question.Distribution)
            {
                await Row(OptionSection, order, bucket.Value, locale, "label", bucket.Label).ConfigureAwait(false);
                await Row(OptionSection, order, bucket.Value, null, "count", Number(bucket.Count)).ConfigureAwait(false);
                await Row(OptionSection, order, bucket.Value, null, "percentage", Number(bucket.Percentage)).ConfigureAwait(false);
                await Row(OptionSection, order, bucket.Value, null, "average_rank", Optional(bucket.AverageRank)).ConfigureAwait(false);
            }

            // Word FREQUENCIES, never the sentences they were counted from. The aggregation
            // has already dropped words appearing in fewer than MinimumWordRespondents
            // responses and counted them into SuppressedWordCount above.
            foreach (var word in question.Words)
            {
                await Row(WordSection, order, word.Word, word.Language, "response_count", Number(word.ResponseCount))
                    .ConfigureAwait(false);
            }
        }

        foreach (var dimension in aggregate.Dimensions)
        {
            await Row(DimensionSection, null, dimension.Dimension, null, "question_count", Number(dimension.QuestionCount)).ConfigureAwait(false);
            await Row(DimensionSection, null, dimension.Dimension, null, "answered_count", Number(dimension.AnsweredCount)).ConfigureAwait(false);
            await Row(DimensionSection, null, dimension.Dimension, null, "average_score", Optional(dimension.AverageScore)).ConfigureAwait(false);
        }

        foreach (var breakdown in aggregate.Breakdowns)
        {
            await Row(BreakdownSection, null, breakdown.Dimension, null, "suppressed_segment_count", Number(breakdown.SuppressedSegmentCount)).ConfigureAwait(false);
            await Row(BreakdownSection, null, breakdown.Dimension, null, "suppressed_respondent_count", Number(breakdown.SuppressedRespondentCount)).ConfigureAwait(false);
            await Row(BreakdownSection, null, breakdown.Dimension, null, "unsegmented_respondent_count", Number(breakdown.UnsegmentedRespondentCount)).ConfigureAwait(false);

            foreach (var segment in breakdown.Segments)
            {
                var key = $"{breakdown.Dimension}:{segment.Key}";

                await Row(SegmentSection, null, key, locale, "label", segment.Label).ConfigureAwait(false);
                await Row(SegmentSection, null, key, null, "respondent_count", Number(segment.RespondentCount)).ConfigureAwait(false);
                await Row(SegmentSection, null, key, null, "participation_rate", Optional(segment.ParticipationRate)).ConfigureAwait(false);
                await Row(SegmentSection, null, key, null, "headcount", Optional(segment.Headcount)).ConfigureAwait(false);
                await Row(SegmentSection, null, key, null, "is_suppressed", Boolean(segment.IsSuppressed)).ConfigureAwait(false);

                // Empty for a suppressed segment, because the aggregation left it empty. This
                // is the one loop where a missing floor would leak a small group's answers, and
                // it is the one loop with no floor in it.
                foreach (var segmentQuestion in segment.Questions)
                {
                    var order = Number(OrderOf(aggregate, segmentQuestion.QuestionId) + 1);
                    await Row(SegmentQuestionSection, order, key, null, "answered_count", Number(segmentQuestion.AnsweredCount)).ConfigureAwait(false);
                    await Row(SegmentQuestionSection, order, key, null, "average", Optional(segmentQuestion.Average)).ConfigureAwait(false);
                }
            }
        }

        await csv.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    // ------------------------------------------------------------------
    // PDF
    // ------------------------------------------------------------------

    /// <summary>
    /// The formatted document, in the locale the caller is reading.
    /// </summary>
    /// <remarks>
    /// Reads the same fields, in the same order, as <see cref="WriteCsvAsync"/>. Where the CSV
    /// is a machine surface of reason codes, this is the artefact an admin forwards to a
    /// director, so the chrome is translated and the numbers are formatted for the reader --
    /// but not one number is computed differently.
    /// </remarks>
    public static PdfDocument BuildPdf(SurveyExportContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var copy = SurveyExportCopy.For(context.ResolvedLocale);
        var aggregate = context.Aggregate;
        var summary = aggregate.Summary;

        var document = new PdfDocument(context.Title ?? copy.UntitledSurvey);
        document.Title(context.Title ?? copy.UntitledSurvey);
        document.Paragraph($"{copy.Status}: {context.Status} · {copy.GeneratedAt}: {context.GeneratedAt:yyyy-MM-dd HH:mm} UTC");
        document.Spacer(4);

        document.Heading(copy.Participation);
        document.KeyValues(
        [
            (copy.Invited, copy.Format(summary.InvitedCount)),
            (copy.Responses, copy.Format(summary.ResponseCount)),
            (copy.Completed, copy.Format(summary.CompletedCount)),
            (copy.Partial, copy.Format(summary.PartialCount)),
            (copy.ParticipationRate, copy.Percent(summary.ParticipationRate)),
            (copy.CompletionRate, copy.Percent(summary.CompletionRate)),
            (copy.AverageDuration, copy.Seconds(summary.AverageCompletionSeconds)),
            (copy.FirstResponse, summary.FirstResponseAt?.ToString("yyyy-MM-dd HH:mm") ?? copy.NotAvailable),
            (copy.LastResponse, summary.LastResponseAt?.ToString("yyyy-MM-dd HH:mm") ?? copy.NotAvailable),
        ]);

        document.Paragraph(copy.PrivacyNotice(SurveyResultsPrivacy.MinimumRespondents, aggregate.MinimumGroupSize));

        if (context.FallbackFields.Count > 0)
        {
            document.Paragraph(copy.UntranslatedNotice(context.FallbackFields.Count, context.ResolvedLocale));
        }

        // The whole-survey floor. The aggregate is already empty; this paragraph says WHY it
        // is empty, which a reader of a file cannot ask anyone.
        if (aggregate.IsSuppressed)
        {
            document.Heading(copy.ResultsWithheld);
            document.Paragraph(copy.WithheldBody(SurveyResultsPrivacy.MinimumRespondents, summary.CompletedCount));
            return document;
        }

        if (aggregate.Dimensions.Count > 0)
        {
            document.Heading(copy.Dimensions);
            document.Table(
                [
                    new PdfTableColumn(copy.Dimension, 4),
                    new PdfTableColumn(copy.QuestionCount, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.AnsweredCount, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.AverageScore, 1.4, RightAligned: true),
                ],
                [.. aggregate.Dimensions.Select(d => new string?[]
                {
                    d.Dimension,
                    copy.Format(d.QuestionCount),
                    copy.Format(d.AnsweredCount),
                    copy.Decimal(d.AverageScore),
                })]);
        }

        document.Heading(copy.QuestionResults);
        foreach (var question in aggregate.Questions)
        {
            document.SubHeading($"{question.Order + 1}. {question.Text}");

            var facts = new List<(string, string?)>
            {
                (copy.QuestionType, question.Type),
                (copy.AnsweredCount, copy.Format(question.AnsweredCount)),
            };

            if (question.Category is { Length: > 0 })
            {
                facts.Insert(0, (copy.Dimension, question.Category));
            }

            if (question.Average is not null)
            {
                facts.Add((copy.Average, copy.Decimal(question.Average)));
                facts.Add((copy.Median, copy.Decimal(question.Median)));
            }

            document.KeyValues(facts);

            if (question.Distribution.Count > 0)
            {
                document.Table(
                    [
                        new PdfTableColumn(copy.Answer, 5),
                        new PdfTableColumn(copy.Responses, 1.3, RightAligned: true),
                        new PdfTableColumn("%", 1.2, RightAligned: true),
                    ],
                    [.. question.Distribution.Select(b => new string?[]
                    {
                        b.Label ?? b.Value,
                        copy.Format(b.Count),
                        copy.Decimal(b.Percentage),
                    })]);
            }

            if (question.Words.Count > 0)
            {
                document.Table(
                    [
                        new PdfTableColumn(copy.Word, 4),
                        new PdfTableColumn(copy.Language, 1.5),
                        new PdfTableColumn(copy.RespondentsUsingWord, 2, RightAligned: true),
                    ],
                    [.. question.Words.Select(w => new string?[]
                    {
                        w.Word,
                        w.Language,
                        copy.Format(w.ResponseCount),
                    })]);
            }

            if (question.SuppressedWordCount > 0)
            {
                document.Paragraph(copy.WordsWithheld(question.SuppressedWordCount, SurveyResultsPrivacy.MinimumWordRespondents));
            }
        }

        foreach (var breakdown in aggregate.Breakdowns)
        {
            document.Heading(copy.BreakdownHeading(breakdown.Dimension));

            var visible = breakdown.Segments.Where(s => !s.IsSuppressed).ToList();
            if (visible.Count > 0)
            {
                document.Table(
                    [
                        new PdfTableColumn(copy.Group, 4),
                        new PdfTableColumn(copy.Respondents, 1.4, RightAligned: true),
                        new PdfTableColumn(copy.Headcount, 1.4, RightAligned: true),
                        new PdfTableColumn(copy.ParticipationRate, 1.6, RightAligned: true),
                    ],
                    [.. visible.Select(s => new string?[]
                    {
                        s.Label ?? s.Key,
                        copy.Format(s.RespondentCount),
                        copy.Format(s.Headcount),
                        copy.Percent(s.ParticipationRate),
                    })]);
            }

            // Withheld groups are counted and never named. Naming one would defeat the floor
            // that withheld it, and omitting the count entirely would let a reader mistake a
            // suppressed workforce for an absent one.
            document.Paragraph(copy.SegmentsWithheld(
                breakdown.SuppressedSegmentCount,
                breakdown.SuppressedRespondentCount,
                breakdown.UnsegmentedRespondentCount,
                aggregate.MinimumGroupSize));
        }

        return document;
    }

    private static int OrderOf(SurveyAggregate aggregate, Guid questionId)
        => aggregate.Questions.FirstOrDefault(q => q.QuestionId == questionId)?.Order ?? 0;

    private static string Number(int value) => CsvField.Number(value);

    private static string Number(double value) => CsvField.Number(value);

    private static string? Optional(int? value) => value is null ? null : CsvField.Number(value.Value);

    private static string? Optional(double? value) => value is null ? null : CsvField.Number(value.Value);

    /// <summary>
    /// A boolean as a CSV cell.
    /// </summary>
    /// <remarks>
    /// Lower-case <c>true</c>/<c>false</c>, matching <c>MicroclimateExportProjection</c>, rather
    /// than <c>bool.ToString()</c>'s <c>True</c>/<c>False</c>: the two exports of this product
    /// should not disagree about how a flag is spelled, and a spreadsheet filter is
    /// case-sensitive.
    /// </remarks>
    private static string Boolean(bool value) => value ? "true" : "false";
}

/// <summary>
/// The chrome of the PDF, in each locale the product publishes.
/// </summary>
/// <remarks>
/// <para>
/// A dictionary of records keyed by <see cref="ContentLanguages.Locales"/>, which is the
/// pattern <c>NotificationEmailComposer.Copy</c> already established for server-rendered text.
/// The alternatives are worse in the same two ways they are there: a pair of En/Es properties
/// would put a language into a shape (#195), and a resource file would put the product's only
/// Spanish prose somewhere no reviewer of this file reads.
/// </para>
/// <para>
/// <b>Numbers are formatted here, not by a culture.</b> Spanish writes a decimal comma, and
/// <c>CultureInfo.GetCultureInfo("es-CR")</c> would produce one -- on a host with ICU, in the
/// version of ICU that host happens to carry. Replacing the separator explicitly is
/// deterministic, testable, and survives a container built with invariant globalization, which
/// would silently give a Spanish report English decimal points.
/// </para>
/// </remarks>
internal sealed record SurveyExportCopy(
    string UntitledSurvey,
    string Status,
    string GeneratedAt,
    string Participation,
    string Invited,
    string Responses,
    string Completed,
    string Partial,
    string ParticipationRate,
    string CompletionRate,
    string AverageDuration,
    string FirstResponse,
    string LastResponse,
    string NotAvailable,
    string ResultsWithheld,
    string Dimensions,
    string Dimension,
    string QuestionCount,
    string AnsweredCount,
    string AverageScore,
    string QuestionResults,
    string QuestionType,
    string Average,
    string Median,
    string Answer,
    string Word,
    string Language,
    string RespondentsUsingWord,
    string Group,
    string Respondents,
    string Headcount,
    bool DecimalComma)
{
    private static readonly Dictionary<string, SurveyExportCopy> ByLocale = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = new SurveyExportCopy(
            UntitledSurvey: "Untitled survey",
            Status: "Status",
            GeneratedAt: "Generated",
            Participation: "Participation",
            Invited: "Invited",
            Responses: "Responses",
            Completed: "Completed",
            Partial: "In progress",
            ParticipationRate: "Participation rate",
            CompletionRate: "Completion rate",
            AverageDuration: "Average time to complete",
            FirstResponse: "First response",
            LastResponse: "Last response",
            NotAvailable: "Not available",
            ResultsWithheld: "Results withheld",
            Dimensions: "Dimensions",
            Dimension: "Dimension",
            QuestionCount: "Questions",
            AnsweredCount: "Answers",
            AverageScore: "Average",
            QuestionResults: "Results by question",
            QuestionType: "Question type",
            Average: "Average",
            Median: "Median",
            Answer: "Answer",
            Word: "Word",
            Language: "Language",
            RespondentsUsingWord: "Responses containing it",
            Group: "Group",
            Respondents: "Respondents",
            Headcount: "Headcount",
            DecimalComma: false),

        [ContentLanguages.Spanish] = new SurveyExportCopy(
            UntitledSurvey: "Encuesta sin título",
            Status: "Estado",
            GeneratedAt: "Generado",
            Participation: "Participación",
            Invited: "Convocados",
            Responses: "Respuestas",
            Completed: "Completadas",
            Partial: "En curso",
            ParticipationRate: "Tasa de participación",
            CompletionRate: "Tasa de finalización",
            AverageDuration: "Tiempo promedio para completar",
            FirstResponse: "Primera respuesta",
            LastResponse: "Última respuesta",
            NotAvailable: "No disponible",
            ResultsWithheld: "Resultados reservados",
            Dimensions: "Dimensiones",
            Dimension: "Dimensión",
            QuestionCount: "Preguntas",
            AnsweredCount: "Respuestas",
            AverageScore: "Promedio",
            QuestionResults: "Resultados por pregunta",
            QuestionType: "Tipo de pregunta",
            Average: "Promedio",
            Median: "Mediana",
            Answer: "Respuesta",
            Word: "Palabra",
            Language: "Idioma",
            RespondentsUsingWord: "Respuestas que la contienen",
            Group: "Grupo",
            Respondents: "Respondieron",
            Headcount: "Personas",
            DecimalComma: true),
    };

    public static SurveyExportCopy For(string? locale)
    {
        var normalised = ContentLanguages.NormaliseLocale(locale) ?? ContentLanguages.FallbackLocale;
        return ByLocale.TryGetValue(normalised, out var copy) ? copy : ByLocale[ContentLanguages.FallbackLocale];
    }

    public string Format(int value) => Localise(CsvField.Number(value));

    public string Format(int? value) => value is null ? NotAvailable : Format(value.Value);

    public string Decimal(double? value)
        => value is null ? NotAvailable : Localise(Math.Round(value.Value, 2).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));

    public string Percent(double? value) => value is null ? NotAvailable : $"{Decimal(value)} %";

    public string Seconds(double? value) => value is null ? NotAvailable : $"{Decimal(value)} s";

    public string PrivacyNotice(int surveyFloor, int segmentFloor)
        => DecimalComma
            ? $"Confidencialidad: no se calcula ningún resultado por pregunta con menos de {surveyFloor} respuestas completas, y ningún grupo con menos de {segmentFloor} personas que respondieron se muestra por separado. Este archivo no contiene respuestas individuales ni texto libre textual."
            : $"Confidentiality: no per-question result is computed below {surveyFloor} complete responses, and no group with fewer than {segmentFloor} respondents is shown separately. This file contains no individual responses and no verbatim free text.";

    public string UntranslatedNotice(int count, string locale)
        => DecimalComma
            ? $"{count} campo(s) no tienen traducción en «{locale}» y se muestran en el otro idioma."
            : $"{count} field(s) have no translation in \"{locale}\" and are shown in the other language.";

    public string WithheldBody(int floor, int completed)
        => DecimalComma
            ? $"Esta encuesta tiene {Format(completed)} respuestas completas. Por debajo de {floor} no se calcula ningún resultado por pregunta, porque con tan pocas respuestas el resultado equivale a leer lo que contestó cada persona. Las cifras de participación sí se muestran arriba."
            : $"This survey has {Format(completed)} complete responses. Below {floor} no per-question result is computed, because with that few responses the result amounts to reading what each person answered. The participation counters above are still shown.";

    public string WordsWithheld(int count, int floor)
        => DecimalComma
            ? $"{Format(count)} palabra(s) se omitieron por aparecer en menos de {floor} respuestas."
            : $"{Format(count)} word(s) were withheld for appearing in fewer than {floor} responses.";

    public string BreakdownHeading(string dimension)
        => DecimalComma ? $"Desglose por {dimension}" : $"Breakdown by {dimension}";

    public string SegmentsWithheld(int segments, int respondents, int unsegmented, int floor)
        => DecimalComma
            ? $"Grupos reservados: {Format(segments)} (con {Format(respondents)} personas en total) por tener menos de {floor} personas que respondieron. Respuestas sin este dato: {Format(unsegmented)}."
            : $"Withheld groups: {Format(segments)} (covering {Format(respondents)} people) for having fewer than {floor} respondents. Responses carrying no value for this: {Format(unsegmented)}.";

    private string Localise(string invariant)
        => DecimalComma ? invariant.Replace('.', ',') : invariant;
}
