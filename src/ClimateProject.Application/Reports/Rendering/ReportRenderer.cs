using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports.Rendering;

/// <summary>
/// One generated report as a file: the formatted PDF and the machine-readable CSV, from one
/// projection of the stored <see cref="ReportOutputDocument"/>.
///
/// ## The floors are inherited, never re-applied
///
/// Everything printed here comes off a document <c>ReportGeneration</c> built from
/// <see cref="SurveyAggregation.Compute"/>'s own output. This class computes no floor, compares
/// nothing against <see cref="SurveyResultsPrivacy"/>, and has no branch that could disagree
/// with the results screen -- a suppressed survey section arrives with its
/// <see cref="ReportSurveySection.Questions"/> and <see cref="ReportSurveySection.Dimensions"/>
/// already empty and a suppressed segment with its <c>RespondentCount</c> already zeroed. The
/// same property <c>SurveyExport</c> has, for the same reason, and the reason it matters more
/// here: this file is the artefact an administrator forwards to a director.
///
/// ## What the renderer must NOT do: print a zero
///
/// The one way this class can leak is by treating an absent number as a number. A suppressed
/// department reaches it as <c>(IsSuppressed: true, RespondentCount: 0, ParticipationRate:
/// null)</c>, and a table cell that printed <c>0</c> and <c>Not available</c> would be a
/// confident, wrong claim about those people -- "nobody in Direccion answered" reads as
/// disengagement, not as confidentiality. Every suppressed cell therefore renders the withheld
/// marker, and the notice under the table says which floor produced it.
///
/// ## Departments are named; demographic groups are not
///
/// A withheld <b>department</b> is named with its numbers withheld. A withheld
/// <b>demographic group</b> is not printed at all, only counted -- which is the rule
/// <c>SurveyExport</c> applies to every breakdown, and the divergence is deliberate:
///
/// - A department's name and roster are org-chart data the same administrator reads on
///   <c>/admin/departments</c>, and <c>ReportSurveySections</c> already carries the row into the
///   stored document. Withholding the name here would hide nothing and would lose the reader's
///   ability to see that a department exists and was not measured.
/// - A demographic group's key <b>is the value a respondent typed</b>. <c>SurveyExport</c>
///   records the consequence: with one withheld segment in a breakdown, a named row makes that
///   group's exact size a subtraction, and the row itself would print
///   <c>nationality:Venezolana</c> for the one person who wrote it.
///
/// Both documents below apply both rules, off the same flags, in the same order.
///
/// ## Why one class produces both formats
///
/// The reason <c>SurveyExport</c> gives, one surface up: two projections over one document is
/// how "the CSV says 62% and the PDF says 58%" happens. Both read the same fields in the same
/// order, and <c>ReportRendererTests</c> asserts they agree on the numbers.
///
/// ## What is deliberately not in either file
///
/// Per-question option distributions and open-text word frequencies are in the CSV and not in
/// the PDF. The CSV is a long-format machine surface where a fortieth section costs a row
/// shape; the PDF is a document, and a distribution table per question over an instrument of
/// forty questions across a company's surveys is tens of pages nobody reads. Neither carries a
/// chart: <c>docs/decisions/pdf-rendering.md</c> names an image pipeline as the point at which
/// the hand-written serialiser should be revisited rather than extended.
/// </summary>
public static class ReportRenderer
{
    /// <summary>The CSV's column names. Fixed, and the same for every report.</summary>
    /// <remarks>
    /// <b>Long format</b>, following <c>SurveyExport.Columns</c> and for the reason it gives,
    /// which a report only sharpens: this document is nine shapes at once -- report scalars, a
    /// survey's participation, its questions, their distributions, their words, its dimensions,
    /// its departments, its demographic groups, insights and benchmarks -- and a wide row would
    /// repeat every scalar on every bucket. A reader filters on <c>section</c> and pivots.
    /// <c>survey</c> is the extra column <c>SurveyExport</c> does not need: a report holds many.
    /// </remarks>
    public static readonly string[] Columns = ["section", "survey", "question", "group", "language", "metric", "value"];

    /// <summary>Section names. Constants because the CSV is a machine-readable surface.</summary>
    public const string ReportSection = "report";

    /// <inheritdoc cref="ReportSection"/>
    public const string SurveySection = "survey";

    /// <summary>
    /// One row per question per survey, carrying the question's text. The spine of the
    /// document: every other question-scoped section keys off the same
    /// (<c>survey</c>, <c>question</c>) pair.
    /// </summary>
    public const string QuestionSection = "question";

    /// <inheritdoc cref="ReportSection"/>
    public const string QuestionMetricSection = "question_metric";

    /// <inheritdoc cref="ReportSection"/>
    public const string OptionSection = "option";

    /// <inheritdoc cref="ReportSection"/>
    public const string WordSection = "word";

    /// <inheritdoc cref="ReportSection"/>
    public const string DimensionSection = "dimension";

    /// <inheritdoc cref="ReportSection"/>
    public const string DepartmentSection = "department";

    /// <inheritdoc cref="ReportSection"/>
    public const string DemographicSection = "demographic";

    /// <inheritdoc cref="ReportSection"/>
    public const string DemographicSegmentSection = "demographic_segment";

    /// <inheritdoc cref="ReportSection"/>
    public const string InsightSection = "insight";

    /// <inheritdoc cref="ReportSection"/>
    public const string BenchmarkSection = "benchmark";

    /// <inheritdoc cref="ReportSection"/>
    public const string ComparisonSection = "comparison";

    /// <inheritdoc cref="ReportSection"/>
    public const string BenchmarkMetricSection = "benchmark_metric";

    /// <inheritdoc cref="ReportSection"/>
    public const string BenchmarkPriorPeriodSection = "benchmark_prior_period";

    // ------------------------------------------------------------------
    // PDF
    // ------------------------------------------------------------------

    /// <summary>The formatted document.</summary>
    public static PdfDocument BuildPdf(ReportRenderContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var copy = ReportRenderCopy.For(context.ChromeLocale);
        var title = string.IsNullOrWhiteSpace(context.Title) ? copy.UntitledReport : context.Title;

        var document = new PdfDocument(title);
        document.Title(title);
        document.Paragraph(
            $"{copy.Type}: {context.Type} · {copy.GeneratedAt}: {context.GeneratedAt:yyyy-MM-dd HH:mm} UTC");

        if (!string.IsNullOrWhiteSpace(context.Description))
        {
            document.Paragraph(context.Description);
        }

        document.Paragraph(copy.PrivacyNotice(SurveyResultsPrivacy.MinimumRespondents));

        if (context.Document is null)
        {
            // Not an exception and not an empty page. A report row whose stored document
            // predates #88, or was written by something this version cannot read, still has to
            // produce a file that says which report it is and why it has no content.
            document.Heading(copy.Scope);
            document.Paragraph(UnreadableDocumentNote(context, copy));
            return document;
        }

        var stored = context.Document;

        // The generation note is printed VERBATIM and untranslated, at the top rather than in a
        // footnote. It is server-authored English naming the sections the generator does not
        // build yet (ReportGeneration.cs), and translating it here would put a second, drifting
        // copy of that list in this file -- the failure #195 is about. SharedReportPage.tsx
        // makes the same call for the same string.
        document.Heading(copy.Scope);
        document.Paragraph(stored.GenerationNote);

        // What the author chose to include. Printed only for documents that carry a scope --
        // the ones written before filters existed meant "everything", and inventing the
        // sentence for them would be a claim about a decision nobody made. Without this an
        // excluded section and an empty one look identical, which is the absent-versus-withheld
        // confusion the rest of this renderer works to avoid.
        if (stored.Scope is { } scope)
        {
            document.KeyValues(
            [
                (copy.Surveys, scope.AllSurveys ? copy.AllSurveysIncluded : copy.SurveysSelected),
                (copy.AiInsights, scope.AiInsightsIncluded ? copy.IncludedSections : copy.ExcludedSections),
                (copy.Benchmarks, scope.BenchmarksIncluded ? copy.IncludedSections : copy.ExcludedSections),
                (copy.Comparison, scope.ComparisonIncluded ? copy.IncludedSections : copy.ExcludedSections),
            ]);
        }

        document.Heading(copy.Surveys);
        if (stored.Surveys.Count == 0)
        {
            document.Paragraph(copy.NoSurveys);
        }

        foreach (var section in stored.Surveys)
        {
            WriteSurveySection(document, section);
        }

        WriteInsights(document, copy, stored.AiInsights);
        WriteBenchmarks(document, copy, stored.Benchmarks);
        WriteComparison(document, copy, stored.Comparison);

        return document;
    }

    /// <summary>
    /// One survey's pages, in the locale that survey's authored text is in.
    /// </summary>
    /// <remarks>
    /// The section's own <see cref="ReportSurveySection.ResolvedLocale"/> decides the labels
    /// here, not the document's chrome locale: a table of Spanish question text under the header
    /// "Question" is the silent substitution #195 forbids, in print. The locale is also stated
    /// on the section header, because a reader of a mixed-language document has no other way to
    /// know which language they are looking at.
    /// </remarks>
    private static void WriteSurveySection(PdfDocument document, ReportSurveySection section)
    {
        var copy = ReportRenderCopy.For(section.ResolvedLocale);
        var participation = section.Participation;

        document.SubHeading(
            $"{(string.IsNullOrWhiteSpace(section.Title) ? copy.UntitledSurvey : section.Title)} · {copy.PrintedIn}: {section.ResolvedLocale}");

        // Printed even for a suppressed section, which is the aggregation's own decision
        // carried through: ReportSurveySection.Participation is documented "Always populated,
        // even below the disclosure floor -- a count identifies nobody", and SurveyExport's PDF
        // does the same. "3 of 40 so far" is the number that tells an admin whether to keep
        // chasing responses, and withholding it would make a low-response survey
        // indistinguishable from one nobody had run.
        document.KeyValues(
        [
            (copy.Status, section.Status),
            (copy.Invited, copy.Count(participation.InvitedCount)),
            (copy.Responses, copy.Count(participation.ResponseCount)),
            (copy.Completed, copy.Count(participation.CompletedCount)),
            (copy.Partial, copy.Count(participation.PartialCount)),
            (copy.ParticipationRate, copy.Percent(participation.ParticipationRate)),
            (copy.CompletionRate, copy.Percent(participation.CompletionRate)),
            (copy.FirstResponse, copy.Day(participation.FirstResponseAt)),
            (copy.LastResponse, copy.Day(participation.LastResponseAt)),
        ]);

        if (section.IsSuppressed)
        {
            // The tables below are empty anyway -- the aggregation emptied them. This paragraph
            // is what a reader of a FILE cannot ask anyone: WHY they are empty. It carries the
            // aggregation's own reason code verbatim.
            document.Heading(copy.ResultsWithheld);
            document.Paragraph(copy.SectionWithheld(
                section.SuppressionReason,
                SurveyResultsPrivacy.MinimumRespondents,
                participation.CompletedCount));
            return;
        }

        if (section.Dimensions.Count > 0)
        {
            document.Heading(copy.Dimensions);
            document.Table(
                [
                    new PdfTableColumn(copy.Dimension, 4),
                    new PdfTableColumn(copy.QuestionCount, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.AnsweredCount, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.AverageScore, 1.4, RightAligned: true),
                ],
                [.. section.Dimensions.Select(d => new string?[]
                {
                    d.Dimension,
                    copy.Count(d.QuestionCount),
                    copy.Count(d.AnsweredCount),
                    copy.Decimal(d.AverageScore),
                })]);
        }

        if (section.Questions.Count > 0)
        {
            document.Heading(copy.QuestionResults);
            document.Table(
                [
                    // Weights measured against the values this product actually writes, not
                    // guessed: `PdfDocument.WrapText` falls back to breaking mid-token when a
                    // token is wider than its column, so a Type column too narrow for
                    // `multiple_choice` renders it as "multiple_choi ce" and an Answers column
                    // too narrow for its own header renders "Answer s". Both were in the first
                    // draft and both are invisible to every assertion that searches the whole
                    // document rather than the drawn cells.
                    new PdfTableColumn(copy.Ordinal, 0.6, RightAligned: true),
                    new PdfTableColumn(copy.Question, 4.2),
                    new PdfTableColumn(copy.QuestionType, 2.3),
                    new PdfTableColumn(copy.Dimension, 2),
                    new PdfTableColumn(copy.AnsweredCount, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.Average, 1.3, RightAligned: true),
                    new PdfTableColumn(copy.Median, 1.3, RightAligned: true),
                ],
                [.. section.Questions.Select(q => new string?[]
                {
                    // One-based, matching what the authoring screen prints
                    // (SurveyQuestionList.tsx renders `question.order + 1`): a document that
                    // numbered the first question 0 would not line up with the survey an
                    // admin edited.
                    copy.Count(q.Order + 1),
                    q.Text,
                    q.Type,
                    q.Category,
                    copy.Count(q.AnsweredCount),
                    copy.Decimal(q.Average),
                    copy.Decimal(q.Median),
                })]);
        }

        WriteDepartments(document, copy, section);
        WriteDemographics(document, copy, section);
    }

    private static void WriteDepartments(PdfDocument document, ReportRenderCopy copy, ReportSurveySection section)
    {
        // No department rows means the aggregation produced no department breakdown for this
        // survey -- nobody who answered carries one. Printing the heading anyway produced
        // "Participation by department / Withheld departments: 0 (covering 0 people) …
        // Responses carrying no department: 7" over an absent table, which reads as though
        // departments exist and none of them answered. The unsegmented count in that case is
        // simply everyone, and the participation counters above already report it.
        if (section.Departments.Count == 0)
        {
            return;
        }

        document.Heading(copy.Departments);

        {
            document.Table(
                [
                    new PdfTableColumn(copy.Department, 4),
                    new PdfTableColumn(copy.Respondents, 1.5, RightAligned: true),
                    new PdfTableColumn(copy.ParticipationRate, 1.8, RightAligned: true),
                ],
                [.. section.Departments.Select(d => new string?[]
                {
                    string.IsNullOrWhiteSpace(d.Name) ? d.DepartmentId : d.Name,
                    // THE branch this class exists for. `RespondentCount` is already 0 and
                    // `ParticipationRate` already null for a withheld department -- printing
                    // them would render "0" and "Not available", which reads as "nobody here
                    // answered". That is a number this report does not have.
                    d.IsSuppressed ? copy.Withheld : copy.Count(d.RespondentCount),
                    d.IsSuppressed ? copy.Withheld : copy.Percent(d.ParticipationRate),
                })]);

            if (section.Departments.Any(d => d.IsSuppressed))
            {
                document.Paragraph(copy.DepartmentWithheldNotice(section.MinimumGroupSize));
            }
        }

        {
            document.Paragraph(copy.DepartmentsWithheldCounts(
                section.SuppressedDepartmentCount,
                section.SuppressedRespondentCount,
                section.UnsegmentedRespondentCount,
                section.MinimumGroupSize));
        }
    }

    /// <summary>
    /// Every non-department breakdown, with withheld groups counted and never named.
    /// </summary>
    /// <remarks>
    /// The rule <c>SurveyExport</c> writes down at length, applied verbatim: a demographic
    /// group's key IS the value a respondent typed, so a named row discloses both which group
    /// is small and what one of its members wrote. The counters below are what a reader
    /// balances the table against.
    /// </remarks>
    private static void WriteDemographics(PdfDocument document, ReportRenderCopy copy, ReportSurveySection section)
    {
        foreach (var breakdown in section.Demographics)
        {
            var visible = breakdown.Segments.Where(s => !s.IsSuppressed).ToList();
            if (visible.Count == 0 && breakdown.SuppressedSegmentCount == 0)
            {
                continue;
            }

            document.Heading($"{copy.Dimension}: {breakdown.Dimension}");

            if (visible.Count > 0)
            {
                document.Table(
                    [
                        new PdfTableColumn(breakdown.Dimension, 4),
                        new PdfTableColumn(copy.Respondents, 1.5, RightAligned: true),
                    ],
                    [.. visible.Select(s => new string?[]
                    {
                        string.IsNullOrWhiteSpace(s.Label) ? s.Key : s.Label,
                        copy.Count(s.RespondentCount),
                    })]);
            }

            // NOT DepartmentsWithheldCounts: this is a demographic breakdown, and that string
            // says "Withheld departments", which under the heading "Dimension: nationality"
            // names the wrong kind of group while reading as correct.
            document.Paragraph(copy.SegmentsWithheldCounts(
                breakdown.Dimension,
                breakdown.SuppressedSegmentCount,
                breakdown.SuppressedRespondentCount,
                breakdown.UnsegmentedRespondentCount,
                section.MinimumGroupSize));
        }
    }

    private static void WriteInsights(
        PdfDocument document,
        ReportRenderCopy copy,
        IReadOnlyList<ReportAIInsightItem> insights)
    {
        document.Heading(copy.AiInsights);

        if (insights.Count == 0)
        {
            document.Paragraph(copy.NoAiInsights);
            return;
        }

        foreach (var insight in insights)
        {
            document.SubHeading(insight.Title);
            document.KeyValues(
            [
                (copy.Type, insight.Type),
                (copy.Category, insight.Category),
                (copy.Priority, insight.Priority),
                // An integer percentage 0-100, copied off AIInsight.ConfidenceScore. Never a
                // 0-1 fraction: ReportAIInsightItem documents the #152 bug where a report read
                // the wrong entity's fractional confidence and printed 0 for everything.
                (copy.Confidence, $"{copy.Count(insight.ConfidenceScore)} %"),
                (copy.Acknowledged, copy.Boolean(insight.IsAcknowledged)),
            ]);
            document.Paragraph(insight.Description);

            if (insight.RecommendedActions.Count > 0)
            {
                document.Paragraph($"{copy.RecommendedActions}: {string.Join("; ", insight.RecommendedActions)}");
            }
        }
    }

    /// <summary>
    /// The period-over-period section (#88 follow-up).
    /// </summary>
    /// <remarks>
    /// Three states, and they must not print the same. <b>Null</b> is "fewer than two closed
    /// surveys" -- nothing to compare. <b>Suppressed</b> is "two waves, one below the floor" --
    /// something to compare and a promise not to. Printing either as an empty table would say
    /// "no movement", which is the absent-count-as-zero reading this codebase already forbids
    /// for a suppressed segment.
    /// </remarks>
    private static void WriteComparison(
        PdfDocument document,
        ReportRenderCopy copy,
        ReportComparisonSection? comparison)
    {
        document.Heading(copy.Comparison);

        if (comparison is null)
        {
            document.Paragraph(copy.NoComparison);
            return;
        }

        document.KeyValues(
        [
            (copy.EarlierSurvey, $"{comparison.EarlierSurveyTitle ?? copy.UntitledSurvey} ({copy.Day(comparison.EarlierEndDate)})"),
            (copy.LaterSurvey, $"{comparison.LaterSurveyTitle ?? copy.UntitledSurvey} ({copy.Day(comparison.LaterEndDate)})"),
        ]);

        if (comparison.IsSuppressed)
        {
            document.Paragraph(copy.ComparisonWithheld);
            return;
        }

        document.Table(
            [
                new PdfTableColumn(copy.Dimension, 3),
                new PdfTableColumn(copy.EarlierSurvey, 1.4, RightAligned: true),
                new PdfTableColumn(copy.LaterSurvey, 1.4, RightAligned: true),
                new PdfTableColumn(copy.Change, 1.4, RightAligned: true),
            ],
            [.. comparison.Dimensions.Select(d => new string?[]
            {
                d.Dimension,
                copy.Decimal(d.EarlierScore),
                copy.Decimal(d.LaterScore),
                copy.Decimal(d.Delta),
            })]);
    }

    private static void WriteBenchmarks(
        PdfDocument document,
        ReportRenderCopy copy,
        IReadOnlyList<ReportBenchmarkComparison> benchmarks)
    {
        document.Heading(copy.Benchmarks);

        if (benchmarks.Count == 0)
        {
            document.Paragraph(copy.NoBenchmarks);
            return;
        }

        foreach (var benchmark in benchmarks)
        {
            document.SubHeading(benchmark.Name);
            document.KeyValues(
            [
                (copy.Category, benchmark.Category),
                (copy.Type, benchmark.Type),
                (copy.PriorPeriodStatus, benchmark.PriorPeriodStatus),
            ]);

            if (benchmark.Metrics.Count > 0)
            {
                document.Table(
                    [
                        new PdfTableColumn(copy.Metric, 3),
                        new PdfTableColumn(copy.Value, 1.3, RightAligned: true),
                        new PdfTableColumn(copy.Unit, 1.3),
                        new PdfTableColumn(copy.Percentile, 1.3, RightAligned: true),
                        new PdfTableColumn(copy.SampleSize, 1.3, RightAligned: true),
                    ],
                    [.. benchmark.Metrics.Select(m => new string?[]
                    {
                        m.MetricName,
                        copy.Decimal(m.Value),
                        m.Unit,
                        copy.Decimal(m.Percentile),
                        copy.Count(m.SampleSize),
                    })]);
            }

            if (benchmark.PriorPeriod is { Metrics.Count: > 0 } prior)
            {
                document.Paragraph($"{copy.PriorPeriod}: {prior.Name}");
                document.Table(
                    [
                        new PdfTableColumn(copy.Metric, 3),
                        new PdfTableColumn(copy.Value, 1.3, RightAligned: true),
                        new PdfTableColumn(copy.PriorValue, 1.5, RightAligned: true),
                        new PdfTableColumn(copy.Change, 1.3, RightAligned: true),
                        new PdfTableColumn(copy.ChangeRatio, 1.5, RightAligned: true),
                    ],
                    [.. prior.Metrics.Select(m => new string?[]
                    {
                        m.MetricName,
                        copy.Decimal(m.Value),
                        copy.Decimal(m.PriorValue),
                        // Delta and ChangeRatio are BenchmarkPriorPeriod's own subtraction,
                        // carried through. Both are null when the two sides are in different
                        // units, and this table prints the absence rather than computing one --
                        // #89's whole point.
                        copy.Decimal(m.Delta),
                        m.ChangeRatio is null ? copy.NotAvailable : copy.Percent(m.ChangeRatio * 100d),
                    })]);
            }
        }
    }

    private static string UnreadableDocumentNote(ReportRenderContext context, ReportRenderCopy copy)
        => copy.DecimalComma
            ? $"Este informe no tiene un documento almacenado que esta versión pueda leer, así que el archivo no lleva secciones. Identificador del informe: {context.ReportId}. Vuelva a generarlo para obtener un documento completo."
            : $"This report has no stored document this version can read, so the file carries no sections. Report id: {context.ReportId}. Generate it again to get a complete document.";

    // ------------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------------

    /// <summary>
    /// The whole document as long-format rows, header included.
    /// </summary>
    /// <remarks>
    /// Buffered, unlike <c>SurveyExport.WriteCsvAsync</c>, and for the reason
    /// <c>docs/decisions/pdf-rendering.md</c> gives about the PDF: a report is bounded by the
    /// instrument, the org chart and the company's survey count -- not by the response count,
    /// which the aggregation has already collapsed into the stored document. The unbounded
    /// export in this product is a survey's raw CSV, and that one streams.
    /// </remarks>
    public static CsvWriter BuildCsv(ReportRenderContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var csv = new CsvWriter(Columns);

        void Row(string section, string? survey, string? question, string? group, string? language, string metric, string? value)
            => csv.AppendRow(section, survey, question, group, language, metric, value);

        var locale = context.ChromeLocale;

        Row(ReportSection, null, null, "report_id", null, "value", context.ReportId.ToString());
        Row(ReportSection, null, null, "title", locale, "value", context.Title);
        Row(ReportSection, null, null, "description", locale, "value", context.Description);
        Row(ReportSection, null, null, "type", null, "value", context.Type);
        Row(ReportSection, null, null, "generated_at", null, "value", context.GeneratedAt.ToString("O"));
        Row(ReportSection, null, null, "minimum_respondents", null, "value", Number(SurveyResultsPrivacy.MinimumRespondents));
        Row(ReportSection, null, null, "document_readable", null, "value", Boolean(context.Document is not null));
        Row(ReportSection, null, null, "generation_note", null, "value", context.Document?.GenerationNote);

        if (context.Document is null)
        {
            return csv;
        }

        foreach (var section in context.Document.Surveys)
        {
            WriteSurveyRows(Row, section);
        }

        foreach (var insight in context.Document.AiInsights)
        {
            var id = insight.Id.ToString();
            Row(InsightSection, null, null, id, null, "title", insight.Title);
            Row(InsightSection, null, null, id, null, "type", insight.Type);
            Row(InsightSection, null, null, id, null, "category", insight.Category);
            Row(InsightSection, null, null, id, null, "priority", insight.Priority);
            Row(InsightSection, null, null, id, null, "confidence_score", Number(insight.ConfidenceScore));
            Row(InsightSection, null, null, id, null, "is_acknowledged", Boolean(insight.IsAcknowledged));
            Row(InsightSection, null, null, id, null, "description", insight.Description);

            foreach (var segment in insight.AffectedSegments)
            {
                Row(InsightSection, null, null, id, null, "affected_segment", segment);
            }

            foreach (var action in insight.RecommendedActions)
            {
                Row(InsightSection, null, null, id, null, "recommended_action", action);
            }
        }

        if (context.Document.Scope is { } scope)
        {
            Row(ReportSection, null, null, "scope", null, "all_surveys", scope.AllSurveys ? "true" : "false");
            Row(ReportSection, null, null, "scope", null, "survey_count", Number(scope.SurveyCount));
            Row(ReportSection, null, null, "scope", null, "ai_insights_included", scope.AiInsightsIncluded ? "true" : "false");
            Row(ReportSection, null, null, "scope", null, "benchmarks_included", scope.BenchmarksIncluded ? "true" : "false");
            Row(ReportSection, null, null, "scope", null, "comparison_included", scope.ComparisonIncluded ? "true" : "false");
        }

        // The comparison, as machine-readable rows. `group` carries the dimension key, the
        // same column the dimension rows use, so a consumer joining the two does not have to
        // know which section a dimension name came from.
        if (context.Document.Comparison is { } comparison)
        {
            Row(ComparisonSection, comparison.EarlierSurveyId.ToString(), null, null, null, "earlier_survey_title", comparison.EarlierSurveyTitle);
            Row(ComparisonSection, comparison.EarlierSurveyId.ToString(), null, null, null, "earlier_end_date", comparison.EarlierEndDate.ToString("O"));
            Row(ComparisonSection, comparison.LaterSurveyId.ToString(), null, null, null, "later_survey_title", comparison.LaterSurveyTitle);
            Row(ComparisonSection, comparison.LaterSurveyId.ToString(), null, null, null, "later_end_date", comparison.LaterEndDate.ToString("O"));

            // Stated as a value rather than implied by absent rows: a consumer must be able to
            // tell "withheld" from "no movement", and an empty section says the second.
            Row(ComparisonSection, null, null, null, null, "is_suppressed", comparison.IsSuppressed ? "true" : "false");

            foreach (var movement in comparison.Dimensions)
            {
                Row(ComparisonSection, null, null, movement.Dimension, null, "earlier_score", Optional(movement.EarlierScore));
                Row(ComparisonSection, null, null, movement.Dimension, null, "later_score", Optional(movement.LaterScore));
                Row(ComparisonSection, null, null, movement.Dimension, null, "delta", Optional(movement.Delta));
            }
        }

        foreach (var benchmark in context.Document.Benchmarks)
        {
            var id = benchmark.BenchmarkId.ToString();
            Row(BenchmarkSection, null, null, id, null, "name", benchmark.Name);
            Row(BenchmarkSection, null, null, id, null, "category", benchmark.Category);
            Row(BenchmarkSection, null, null, id, null, "type", benchmark.Type);
            Row(BenchmarkSection, null, null, id, null, "company_id", benchmark.CompanyId?.ToString());
            Row(BenchmarkSection, null, null, id, null, "prior_period_status", benchmark.PriorPeriodStatus);

            foreach (var metric in benchmark.Metrics)
            {
                Row(BenchmarkMetricSection, null, null, $"{id}:{metric.MetricName}", null, "value", Number(metric.Value));
                Row(BenchmarkMetricSection, null, null, $"{id}:{metric.MetricName}", null, "unit", metric.Unit);
                Row(BenchmarkMetricSection, null, null, $"{id}:{metric.MetricName}", null, "percentile", Optional(metric.Percentile));
                Row(BenchmarkMetricSection, null, null, $"{id}:{metric.MetricName}", null, "sample_size", Optional(metric.SampleSize));
            }

            if (benchmark.PriorPeriod is null)
            {
                continue;
            }

            foreach (var metric in benchmark.PriorPeriod.Metrics)
            {
                var key = $"{id}:{metric.MetricName}";
                Row(BenchmarkPriorPeriodSection, null, null, key, null, "value", Optional(metric.Value));
                Row(BenchmarkPriorPeriodSection, null, null, key, null, "prior_value", Optional(metric.PriorValue));
                Row(BenchmarkPriorPeriodSection, null, null, key, null, "delta", Optional(metric.Delta));
                Row(BenchmarkPriorPeriodSection, null, null, key, null, "change_ratio", Optional(metric.ChangeRatio));
            }
        }

        return csv;
    }

    private delegate void CsvRow(string section, string? survey, string? question, string? group, string? language, string metric, string? value);

    private static void WriteSurveyRows(CsvRow row, ReportSurveySection section)
    {
        var survey = section.SurveyId.ToString();
        var locale = section.ResolvedLocale;
        var participation = section.Participation;

        void Field(string group, string? value, string? language = null)
            => row(SurveySection, survey, null, group, language, "value", value);

        Field("title", section.Title, locale);
        Field("status", section.Status);
        Field("resolved_locale", locale);
        Field("invited_count", Optional(participation.InvitedCount));
        Field("response_count", Number(participation.ResponseCount));
        Field("completed_count", Number(participation.CompletedCount));
        Field("partial_count", Number(participation.PartialCount));
        Field("participation_rate", Optional(participation.ParticipationRate));
        Field("completion_rate", Number(participation.CompletionRate));
        // The floors and the withheld bookkeeping travel with the file: a reader holding a
        // spreadsheet of withheld rows has to be able to see what the threshold was without
        // opening the app.
        Field("is_suppressed", Boolean(section.IsSuppressed));
        Field("suppression_reason", section.SuppressionReason);
        Field("minimum_group_size", Number(section.MinimumGroupSize));
        Field("suppressed_department_count", Number(section.SuppressedDepartmentCount));
        Field("suppressed_respondent_count", Number(section.SuppressedRespondentCount));
        Field("unsegmented_respondent_count", Number(section.UnsegmentedRespondentCount));

        // Below the survey floor these collections are empty -- the aggregation emptied them,
        // not this loop. There is deliberately no `if (IsSuppressed)` guard here, for the reason
        // SurveyExport records: a guard that has to be remembered is a guard that will be
        // forgotten by whoever adds the tenth section.
        foreach (var question in section.Questions)
        {
            // One row per question per survey, carrying the text. Everything else about the
            // question hangs off the same coordinates in `question_metric`.
            var order = Number(question.Order + 1);
            var id = question.QuestionId.ToString();

            row(QuestionSection, survey, order, id, locale, "text", question.Text);

            row(QuestionMetricSection, survey, order, id, null, "type", question.Type);
            row(QuestionMetricSection, survey, order, id, null, "category", question.Category);
            row(QuestionMetricSection, survey, order, id, null, "answered_count", Number(question.AnsweredCount));
            row(QuestionMetricSection, survey, order, id, null, "average", Optional(question.Average));
            row(QuestionMetricSection, survey, order, id, null, "median", Optional(question.Median));
            row(QuestionMetricSection, survey, order, id, null, "suppressed_word_count", Number(question.SuppressedWordCount));

            foreach (var bucket in question.Distribution)
            {
                row(OptionSection, survey, order, bucket.Value, locale, "label", bucket.Label);
                row(OptionSection, survey, order, bucket.Value, null, "count", Number(bucket.Count));
                row(OptionSection, survey, order, bucket.Value, null, "percentage", Number(bucket.Percentage));
            }

            // Word FREQUENCIES, never the sentences they were counted from. The aggregation has
            // already dropped words appearing in fewer than MinimumWordRespondents responses and
            // counted them into suppressed_word_count above; SurveyQuestionResult carries no
            // verbatim answer anywhere for this loop to reach.
            foreach (var word in question.Words)
            {
                row(WordSection, survey, order, word.Word, word.Language, "response_count", Number(word.ResponseCount));
            }
        }

        foreach (var dimension in section.Dimensions)
        {
            row(DimensionSection, survey, null, dimension.Dimension, null, "question_count", Number(dimension.QuestionCount));
            row(DimensionSection, survey, null, dimension.Dimension, null, "answered_count", Number(dimension.AnsweredCount));
            row(DimensionSection, survey, null, dimension.Dimension, null, "average_score", Optional(dimension.AverageScore));
        }

        foreach (var department in section.Departments)
        {
            row(DepartmentSection, survey, null, department.DepartmentId, locale, "name", department.Name);
            row(DepartmentSection, survey, null, department.DepartmentId, null, "is_suppressed", Boolean(department.IsSuppressed));
            // The same rule as the PDF's table cell, in the format that is actually forwarded:
            // an EMPTY cell for a withheld department, never the zero the document carries. A
            // spreadsheet that summed the column would otherwise report a workforce that
            // answered nothing.
            row(
                DepartmentSection, survey, null, department.DepartmentId, null, "respondent_count",
                department.IsSuppressed ? null : Number(department.RespondentCount));
            row(
                DepartmentSection, survey, null, department.DepartmentId, null, "participation_rate",
                department.IsSuppressed ? null : Optional(department.ParticipationRate));
        }

        foreach (var breakdown in section.Demographics)
        {
            row(DemographicSection, survey, null, breakdown.Dimension, null, "suppressed_segment_count", Number(breakdown.SuppressedSegmentCount));
            row(DemographicSection, survey, null, breakdown.Dimension, null, "suppressed_respondent_count", Number(breakdown.SuppressedRespondentCount));
            row(DemographicSection, survey, null, breakdown.Dimension, null, "unsegmented_respondent_count", Number(breakdown.UnsegmentedRespondentCount));

            // Withheld groups are counted by the three rows above and never named -- the same
            // filter the PDF applies, from the same flag. A demographic key IS the value a
            // respondent typed.
            foreach (var segment in breakdown.Segments.Where(s => !s.IsSuppressed))
            {
                var key = $"{breakdown.Dimension}:{segment.Key}";
                row(DemographicSegmentSection, survey, null, key, locale, "label", segment.Label);
                row(DemographicSegmentSection, survey, null, key, null, "respondent_count", Number(segment.RespondentCount));

                foreach (var score in segment.Dimensions)
                {
                    row(DemographicSegmentSection, survey, null, $"{key}:{score.Dimension}", null, "average_score", Optional(score.AverageScore));
                }
            }
        }
    }

    private static string Number(int value) => CsvField.Number(value);

    private static string Number(double value) => CsvField.Number(value);

    private static string? Optional(int? value) => value is null ? null : CsvField.Number(value.Value);

    private static string? Optional(double? value) => value is null ? null : CsvField.Number(value.Value);

    /// <summary>
    /// A boolean as a CSV cell: lower-case, matching <c>SurveyExport</c> and
    /// <c>MicroclimateExportProjection</c> rather than <c>bool.ToString()</c>'s
    /// <c>True</c>/<c>False</c>. The three exports of this product must not disagree about how
    /// a flag is spelled, and a spreadsheet filter is case-sensitive.
    /// </summary>
    private static string Boolean(bool value) => value ? "true" : "false";
}
