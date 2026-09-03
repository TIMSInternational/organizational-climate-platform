using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// What leaves the building when an administrator downloads a report.
///
/// <para>
/// <b>The survey sections are computed, never assembled.</b> Every section below goes through
/// <see cref="SurveyAggregation.Compute"/> with response and answer rows and then through
/// <see cref="ReportSurveySections.ToSection"/> -- the same two steps
/// <c>ReportGeneration.GenerateAsync</c> runs. Hand-building a
/// <see cref="ReportSurveySection"/> with <c>IsSuppressed: true</c> and empty questions would
/// prove that the renderer prints an empty table when handed an empty list, which is not the
/// guarantee. The guarantee is that a survey with four complete responses produces a file with
/// no per-question content in it and a stated reason, and that can only be shown by starting
/// from four responses.
/// </para>
/// <para>
/// The PDF is read back as the literal strings the content stream actually draws, not as a
/// substring search over the whole file. The difference is the point of
/// <see cref="TheSuppressedDepartmentCellsSayWithheldAndNeverZero"/>: "the bytes do not contain
/// a zero" is unassertable -- a PDF is full of zeros -- while "no drawn cell is the string
/// <c>0</c>" is exactly the claim, and it goes red the moment the suppression branch is
/// removed.
/// </para>
/// </summary>
public partial class ReportRendererTests
{
    private static readonly Guid ReportId = Guid.Parse("7e5000aa-0000-0000-0000-000000000001");
    private static readonly Guid HealthySurvey = Guid.Parse("5e2b1d1a-0000-0000-0000-000000000001");
    private static readonly Guid SecondSurvey = Guid.Parse("5e2b1d1a-0000-0000-0000-000000000002");
    private static readonly Guid ThinSurvey = Guid.Parse("5e2b1d1a-0000-0000-0000-000000000003");
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Engineering = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Direction = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid InsightId = Guid.Parse("6666666a-6666-6666-6666-666666666666");
    private static readonly Guid BenchmarkId = Guid.Parse("77777777-7777-7777-7777-777777777777");

    private static readonly DateTimeOffset GeneratedAt = new(2026, 9, 3, 12, 0, 0, TimeSpan.Zero);

    private const string EnglishTitle = "Clima Q3 2026";

    // ==================================================================
    // The file is a file
    // ==================================================================

    [Fact]
    public void The_pdf_is_a_pdf_and_names_the_report_it_is()
    {
        var bytes = ReportRenderer.BuildPdf(Context()).ToBytes();

        // %PDF- is what every reader dispatches on; a document that renders perfectly and
        // starts with anything else is a file nothing opens.
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(bytes, 0, 5), StringComparison.Ordinal);
        Assert.Contains(EnglishTitle, DrawnStrings(ReportRenderer.BuildPdf(Context())), StringComparer.Ordinal);
    }

    [Fact]
    public void The_csv_starts_with_the_header_row()
    {
        var text = CsvText(Context());

        Assert.Equal(
            string.Join(",", ReportRenderer.Columns.Select(c => $"\"{c}\"")),
            text.Split("\r\n")[0]);
    }

    // ==================================================================
    // THE PROPERTY THIS SLICE OWNS: the file cannot invent a number the
    // document does not have.
    // ==================================================================

    /// <summary>
    /// Direction has three respondents, below
    /// <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>, so the aggregation zeroed
    /// its count and nulled its rate before the document was written. A renderer that printed
    /// those two fields would draw <c>0</c> and <c>Not available</c> -- which reads as "nobody
    /// in Direction answered", a claim about those people that nothing in this product
    /// supports.
    /// </summary>
    [Fact]
    public void TheSuppressedDepartmentCellsSayWithheldAndNeverZero()
    {
        var drawn = DrawnStrings(ReportRenderer.BuildPdf(Context()));

        // The disclosed department prints its real figures, so nothing here passes because the
        // renderer printed nothing: Engineering, 6 respondents, 6 of a headcount of 20.
        var engineering = IndexOfCell(drawn, "Ingeniería");
        Assert.Equal("6", drawn[engineering + 1]);
        Assert.Equal("30 %", drawn[engineering + 2]);

        // Direction IS named, unlike SurveyExport's withheld groups, and deliberately: a
        // department is org-chart data the same administrator reads on /admin/departments, and
        // the row is already in the stored document. See ReportRenderer's class comment.
        var direction = IndexOfCell(drawn, "Dirección");

        // Both of its cells, asserted as the cells rather than as a substring search over the
        // file: the aggregation handed this row (0, null), and a renderer that printed them
        // would draw "0" and "Not available" -- which reads as "nobody in Direction answered".
        Assert.Equal("Withheld", drawn[direction + 1]);
        Assert.Equal("Withheld", drawn[direction + 2]);

        // And the floor that produced it, so a reader of the file can see why.
        Assert.Contains(
            $"fewer than {SurveyResultsPrivacy.MinimumSegmentRespondents} respondents",
            Prose(ReportRenderer.BuildPdf(Context())),
            StringComparison.Ordinal);
    }

    /// <summary>The position of a drawn cell, so the two cells after it can be read.</summary>
    private static int IndexOfCell(IReadOnlyList<string> drawn, string cell)
    {
        for (var i = 0; i < drawn.Count; i++)
        {
            if (string.Equals(drawn[i], cell, StringComparison.Ordinal))
            {
                return i;
            }
        }

        Assert.Fail($"No drawn cell reads exactly \"{cell}\". Drawn: {string.Join(" | ", drawn)}");
        return -1;
    }

    /// <summary>The same rule in the format that is actually forwarded to a spreadsheet.</summary>
    [Fact]
    public void TheSuppressedDepartmentCsvCellsAreEmptyNeverZero()
    {
        var rows = CsvRows(Context());

        var disclosed = Cell(rows, ReportRenderer.DepartmentSection, Engineering.ToString(), "respondent_count");
        var withheld = Cell(rows, ReportRenderer.DepartmentSection, Direction.ToString(), "respondent_count");

        Assert.Equal("6", disclosed);
        // Empty, not "0". A spreadsheet that summed this column would otherwise report a
        // workforce that answered nothing.
        Assert.Equal(string.Empty, withheld);
        Assert.Equal(string.Empty, Cell(rows, ReportRenderer.DepartmentSection, Direction.ToString(), "participation_rate"));

        // The flag is still there, so a reader can tell an empty cell from a missing row.
        Assert.Equal("true", Cell(rows, ReportRenderer.DepartmentSection, Direction.ToString(), "is_suppressed"));
        Assert.Equal("false", Cell(rows, ReportRenderer.DepartmentSection, Engineering.ToString(), "is_suppressed"));
    }

    /// <summary>
    /// A demographic group's key IS the value a respondent typed, which is why
    /// <c>SurveyExport</c> refuses to name a withheld one -- with a single withheld segment in
    /// a breakdown, a named row makes that group's exact size a subtraction, and the row prints
    /// <c>nationality:Venezolana</c> for the one person who wrote it.
    /// </summary>
    [Fact]
    public void A_withheld_demographic_group_is_counted_and_never_named()
    {
        var context = Context();
        var drawn = DrawnStrings(ReportRenderer.BuildPdf(context));
        var csv = CsvText(context);

        // The disclosed group is named in both documents.
        Assert.Contains(drawn, s => s.Contains("Costarricense", StringComparison.Ordinal));
        Assert.Contains("Costarricense", csv, StringComparison.Ordinal);

        // The withheld one is in neither, in any casing, and the counter says it exists.
        Assert.DoesNotContain(drawn, s => s.Contains("Venezolana", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("Venezolana", csv, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            "1",
            Cell(CsvRows(context), ReportRenderer.DemographicSection, "nationality", "suppressed_segment_count"));
    }

    /// <summary>
    /// Four complete responses is below <see cref="SurveyResultsPrivacy.MinimumRespondents"/>.
    /// A reader of a FILE cannot ask anyone why a section is empty, and a section that simply
    /// omitted its results would read as "this survey got no answers" -- a different and
    /// materially wrong statement about a workforce.
    /// </summary>
    [Fact]
    public void A_suppressed_section_prints_the_aggregations_own_reason_code()
    {
        var drawn = Prose(ReportRenderer.BuildPdf(Context()));

        Assert.Contains("Results withheld", drawn, StringComparison.Ordinal);
        // The aggregation's own constant, not prose about it: a support conversation about
        // "why is this section empty" has to reach the same answer as the screen without
        // anybody translating back.
        Assert.Contains(SurveyResultsPrivacy.BelowMinimumRespondents, drawn, StringComparison.Ordinal);
        Assert.Contains("4 complete responses", drawn, StringComparison.Ordinal);
    }

    [Fact]
    public void A_suppressed_sections_csv_carries_its_reason_and_no_question_rows()
    {
        var rows = CsvRows(Context());
        var thin = ThinSurvey.ToString();

        Assert.Equal("true", Cell(rows, ReportRenderer.SurveySection, "is_suppressed", "value", thin));
        Assert.Equal(
            SurveyResultsPrivacy.BelowMinimumRespondents,
            Cell(rows, ReportRenderer.SurveySection, "suppression_reason", "value", thin));

        // The participation counters ARE there: a count identifies nobody, and it is the number
        // that tells an admin whether to keep chasing responses.
        Assert.Equal("4", Cell(rows, ReportRenderer.SurveySection, "completed_count", "value", thin));

        // Not "the flag is set" -- the CONTENT is absent, for every question-scoped section.
        Assert.DoesNotContain(rows, r => r.Survey == thin && r.Section == ReportRenderer.QuestionSection);
        Assert.DoesNotContain(rows, r => r.Survey == thin && r.Section == ReportRenderer.QuestionMetricSection);
        Assert.DoesNotContain(rows, r => r.Survey == thin && r.Section == ReportRenderer.OptionSection);
        Assert.DoesNotContain(rows, r => r.Survey == thin && r.Section == ReportRenderer.DimensionSection);
        Assert.DoesNotContain(rows, r => r.Survey == thin && r.Section == ReportRenderer.DepartmentSection);
    }

    // ==================================================================
    // The document's contents
    // ==================================================================

    /// <summary>
    /// One row per question per survey, keyed by the coordinates every other question-scoped
    /// section hangs off.
    /// </summary>
    [Fact]
    public void The_csv_carries_one_question_row_per_question_per_survey()
    {
        var context = Context();
        var rows = CsvRows(context);
        var document = context.Document!;

        var expected = document.Surveys.Sum(s => s.Questions.Count);
        var questionRows = rows.Where(r => r.Section == ReportRenderer.QuestionSection).ToList();

        // Non-empty AND exact, across TWO surveys that each carry a question -- a renderer that
        // emitted nothing would satisfy "no duplicates" perfectly, and one that emitted the
        // first survey only would satisfy "one row per question".
        Assert.Equal(2, expected);
        Assert.Equal(2, questionRows.Select(r => r.Survey).Distinct().Count());
        Assert.Equal(expected, questionRows.Count);

        foreach (var section in document.Surveys)
        {
            foreach (var question in section.Questions)
            {
                var row = Assert.Single(
                    questionRows,
                    r => r.Survey == section.SurveyId.ToString() && r.Group == question.QuestionId.ToString());

                Assert.Equal("text", row.Metric);
                Assert.Equal(question.Text, row.Value);
                // One-based, matching what the authoring screen prints.
                Assert.Equal((question.Order + 1).ToString(CultureInfo.InvariantCulture), row.Question);
            }
        }
    }

    [Fact]
    public void The_generation_note_is_printed_verbatim_in_both_formats()
    {
        var context = Context();
        const string note = "Sections not yet generated: nothing at all, honestly.";

        var withNote = context with { Document = context.Document! with { GenerationNote = note } };

        Assert.Contains(note, Prose(ReportRenderer.BuildPdf(withNote)), StringComparison.Ordinal);
        Assert.Equal(note, Cell(CsvRows(withNote), ReportRenderer.ReportSection, "generation_note", "value"));
    }

    [Fact]
    public void The_pdf_carries_the_insights_and_the_benchmarks()
    {
        var drawn = Prose(ReportRenderer.BuildPdf(Context()));

        Assert.Contains("Recognition is falling in Engineering", drawn, StringComparison.Ordinal);
        // An integer percentage, never a 0-1 fraction: #152's bug was a report reading the
        // wrong entity's fractional confidence and printing 0 for everything.
        Assert.Contains("82 %", drawn, StringComparison.Ordinal);
        Assert.Contains("Speak up more often", drawn, StringComparison.Ordinal);

        Assert.Contains("Our Engagement", drawn, StringComparison.Ordinal);
        Assert.Contains("Engagement 2025", drawn, StringComparison.Ordinal);
        // The prior-period reading is BenchmarkPriorPeriod's own, carried through and never
        // recomputed here: 6/65 as a percentage, to two places.
        Assert.Contains("9.23 %", drawn, StringComparison.Ordinal);
    }

    [Fact]
    public void The_csv_carries_the_insights_and_the_benchmarks()
    {
        var rows = CsvRows(Context());

        Assert.Equal("82", Cell(rows, ReportRenderer.InsightSection, InsightId.ToString(), "confidence_score"));
        Assert.Equal("false", Cell(rows, ReportRenderer.InsightSection, InsightId.ToString(), "is_acknowledged"));
        Assert.Equal("Our Engagement", Cell(rows, ReportRenderer.BenchmarkSection, BenchmarkId.ToString(), "name"));
        Assert.Equal("71", Cell(rows, ReportRenderer.BenchmarkMetricSection, $"{BenchmarkId}:engagement", "value"));
        Assert.Equal("6", Cell(rows, ReportRenderer.BenchmarkPriorPeriodSection, $"{BenchmarkId}:engagement", "delta"));
    }

    /// <summary>
    /// The two documents come from one projection so that "the CSV says 62% and the PDF says
    /// 58%" is impossible rather than unlikely.
    /// </summary>
    [Fact]
    public void Both_formats_report_the_same_numbers()
    {
        var context = Context();
        var rows = CsvRows(context);
        var drawn = DrawnStrings(ReportRenderer.BuildPdf(context));
        var healthy = HealthySurvey.ToString();

        var completed = Cell(rows, ReportRenderer.SurveySection, "completed_count", "value", healthy);
        var engineering = Cell(rows, ReportRenderer.DepartmentSection, Engineering.ToString(), "respondent_count");

        Assert.Equal("9", completed);
        Assert.Equal("6", engineering);

        // Drawn as cells, not inferred from the bytes.
        Assert.Contains(completed, drawn, StringComparer.Ordinal);
        Assert.Contains(engineering, drawn, StringComparer.Ordinal);
    }

    // ==================================================================
    // Locale
    // ==================================================================

    /// <summary>
    /// A section's labels follow the locale that section's authored text is in, because a table
    /// of Spanish question text under the header "Question" is the silent substitution #195
    /// forbids, in print.
    /// </summary>
    [Fact]
    public void Section_labels_follow_the_locale_the_section_is_printed_in()
    {
        var spanish = Prose(ReportRenderer.BuildPdf(Context(healthyLocale: ContentLanguages.Spanish)));
        var english = Prose(ReportRenderer.BuildPdf(Context(healthyLocale: ContentLanguages.English)));

        Assert.Contains("Participación", spanish, StringComparison.Ordinal);
        Assert.Contains("Participation", english, StringComparison.Ordinal);
        Assert.Contains("Reservado", spanish, StringComparison.Ordinal);
        Assert.Contains("Withheld", english, StringComparison.Ordinal);

        // And the decimal separator with it: 9 of 13 invited is 69.23, a rate with decimals,
        // which is what makes the separator observable at all -- 9 of 12 is exactly 75 and
        // would prove nothing. A Spanish report writing 69.23 is as wrong as an English one
        // writing 69,23, and it is decided in ReportRenderCopy rather than by the host's ICU.
        Assert.Contains("69,23 %", spanish, StringComparison.Ordinal);
        Assert.Contains("69.23 %", english, StringComparison.Ordinal);
        Assert.DoesNotContain("69.23", spanish, StringComparison.Ordinal);
    }

    [Fact]
    public void The_locale_a_section_is_printed_in_is_stated_on_the_section()
    {
        var drawn = Prose(ReportRenderer.BuildPdf(Context(healthyLocale: ContentLanguages.Spanish)));

        // A reader of a mixed-language document has no other way to know which language a
        // section's authored text is in.
        Assert.Contains("Impreso en: es", drawn, StringComparison.Ordinal);
    }

    // ==================================================================
    // Legacy rows
    // ==================================================================

    /// <summary>
    /// <c>reports.report_output</c> is <c>jsonb</c>: Postgres accepts any valid JSON, including
    /// the bare string the pre-#88 stub wrote. Those rows have to produce a file, not a 500 --
    /// the download is the one screen an administrator uses to get their report out.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("\"Report generation is stubbed -- no real rendering yet.\"")]
    [InlineData("{\"generationNote\": unterminated")]
    public void An_unreadable_stored_document_still_renders_a_file_that_says_so(string? stored)
    {
        var context = new ReportRenderContext(
            ReportId, EnglishTitle, null, "summary", GeneratedAt, ReportDocumentReader.Parse(stored));

        Assert.Null(context.Document);

        var drawn = Prose(ReportRenderer.BuildPdf(context));
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(ReportRenderer.BuildPdf(context).ToBytes(), 0, 5), StringComparison.Ordinal);
        Assert.Contains("no stored document this version can read", drawn, StringComparison.Ordinal);
        Assert.Contains(ReportId.ToString(), drawn, StringComparison.Ordinal);

        var rows = CsvRows(context);
        Assert.Equal("false", Cell(rows, ReportRenderer.ReportSection, "document_readable", "value"));
        Assert.DoesNotContain(rows, r => r.Section == ReportRenderer.QuestionSection);
    }

    [Fact]
    public void A_readable_document_round_trips_through_the_reader_the_generator_wrote_it_with()
    {
        // Not a hand-written JSON fixture: the same serializer options ReportGeneration uses,
        // so a property-naming change on either side fails here rather than in production.
        var stored = JsonSerializer.Serialize(Document(), JsonSerializerOptions.Web);
        var parsed = ReportDocumentReader.Parse(stored);

        Assert.NotNull(parsed);
        Assert.Equal(3, parsed.Surveys.Count);
        Assert.Single(parsed.AiInsights);
        Assert.Single(parsed.Benchmarks);
        Assert.Equal(
            SurveyResultsPrivacy.BelowMinimumRespondents,
            parsed.Surveys.Single(section => section.SurveyId == ThinSurvey).SuppressionReason);
    }

    // ==================================================================
    // Formats
    // ==================================================================

    [Theory]
    [InlineData("pdf", "pdf")]
    [InlineData("PDF", "pdf")]
    [InlineData("  csv ", "csv")]
    public void A_supported_format_normalises_to_its_stored_spelling(string raw, string expected)
        => Assert.Equal(expected, ReportFormats.Normalise(raw));

    [Theory]
    [InlineData("excel")]
    [InlineData("xlsx")]
    [InlineData("docx")]
    [InlineData("json")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void An_unrenderable_format_is_refused_rather_than_downgraded(string? raw)
        => Assert.Null(ReportFormats.Normalise(raw));

    /// <summary>
    /// A stored value no renderer honours still has to serve a file. Legacy rows hold "excel"
    /// and, in the integration suite's own fixtures, "type".
    /// </summary>
    [Theory]
    [InlineData("csv", true)]
    [InlineData("CSV", true)]
    [InlineData("pdf", false)]
    [InlineData("excel", false)]
    [InlineData("type", false)]
    [InlineData("", false)]
    public void A_legacy_format_falls_back_to_the_pdf(string stored, bool expectCsv)
        => Assert.Equal(expectCsv, ReportFormats.IsCsv(stored));

    [Theory]
    // A real title, accents folded rather than dropped: "clima-anual-ambito", not
    // "clima-anual-mbito".
    [InlineData("Clima Anual — Ámbito", false, "clima-anual-ambito.pdf")]
    [InlineData("Clima Q3 2026", true, "clima-q3-2026.csv")]
    // No filename starts or ends with a separator, and a run of punctuation collapses to one.
    [InlineData("  ///Q3??? ", false, "q3.pdf")]
    public void A_filename_is_the_titles_slug(string title, bool csv, string expected)
        => Assert.Equal(expected, ReportFormats.FileName(title, ReportId, csv));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    // A title in a script this cannot transliterate leaves nothing; "-.pdf" is worse than a Guid.
    [InlineData("климат")]
    public void A_title_that_slugs_to_nothing_falls_back_to_the_id(string? title)
        => Assert.Equal($"report-{ReportId}.pdf", ReportFormats.FileName(title, ReportId, csv: false));

    [Fact]
    public void A_long_title_is_capped_so_no_filesystem_refuses_it()
    {
        var name = ReportFormats.FileName(new string('a', 400), ReportId, csv: false);

        Assert.Equal(64, name.Length);
        Assert.EndsWith(".pdf", name, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Fixtures -- built the way production builds them
    // ------------------------------------------------------------------

    private static ReportRenderContext Context(string healthyLocale = ContentLanguages.English)
        => new(ReportId, EnglishTitle, "Quarterly summary", "summary", GeneratedAt, Document(healthyLocale));

    /// <summary>
    /// The stored document: one measurable survey with a withheld department and a withheld
    /// demographic group, one survey below the whole-survey floor, one insight, one benchmark
    /// with a prior period.
    /// </summary>
    private static ReportOutputDocument Document(string healthyLocale = ContentLanguages.English)
        => new(
            "Sections not yet generated: period-over-period comparative analysis, report configuration/filters, "
            + "report templates. The stored `format` IS rendered on download: pdf and csv are produced from this document.",
            [
                ReportSurveySections.ToSection(
                    HealthySurvey,
                    "Clima anual",
                    SurveyStatuses.Active,
                    healthyLocale,
                    Aggregate(
                        respondentCount: 9,
                        invited: 13,
                        departments: [(Engineering, "Ingeniería", 20, 6), (Direction, "Dirección", 4, 3)],
                        demographics: [("nationality", "Costarricense", 7), ("nationality", "Venezolana", 2)])),
                // A second measurable survey, so "one row per question per survey" is a claim
                // about two surveys rather than about one.
                ReportSurveySections.ToSection(
                    SecondSurvey,
                    "Pulso de agosto",
                    SurveyStatuses.Closed,
                    ContentLanguages.English,
                    Aggregate(respondentCount: 7, invited: 10)),
                ReportSurveySections.ToSection(
                    ThinSurvey,
                    "Piloto",
                    SurveyStatuses.Active,
                    ContentLanguages.English,
                    Aggregate(respondentCount: 4, invited: 12)),
            ],
            [
                new ReportAIInsightItem(
                    InsightId,
                    "risk",
                    "recognition",
                    "Recognition is falling in Engineering",
                    "Recognition scores dropped for the third period running.",
                    82,
                    "high",
                    ["Engineering"],
                    ["Speak up more often", "Run a recognition retro"],
                    IsAcknowledged: false),
            ],
            [
                new ReportBenchmarkComparison(
                    BenchmarkId,
                    "Our Engagement",
                    "engagement",
                    "internal",
                    Guid.Parse("88888888-8888-8888-8888-888888888888"),
                    "linked",
                    [new BenchmarkMetricDto(Guid.Parse("99999999-0000-0000-0000-000000000001"), "engagement", 71d, "percent", 62d, 120)],
                    new BenchmarkPriorPeriodDto(
                        Guid.Parse("99999999-0000-0000-0000-000000000002"),
                        "Engagement 2025",
                        [new BenchmarkMetricChangeDto("engagement", 71d, "percent", 65d, "percent", 6d, 6d / 65d)])),
            ]);

    /// <summary>Computes a real aggregate from real response and answer rows.</summary>
    /// <param name="respondentCount">Complete responses. Everyone answers "remote".</param>
    /// <param name="departments">(id, name, headcount, respondents).</param>
    private static SurveyAggregate Aggregate(
        int respondentCount,
        int invited,
        IReadOnlyList<(Guid Id, string Name, int Headcount, int Respondents)>? departments = null,
        IReadOnlyList<(string Field, string Value, int Respondents)>? demographics = null)
    {
        var questions = new List<AggregationQuestion>
        {
            new(
                QuestionId,
                0,
                QuestionTypes.MultipleChoice,
                "¿Dónde trabajas?",
                "environment",
                null,
                null,
                null,
                null,
                [new AggregationOption(0, "remote", "Remoto"), new AggregationOption(1, "office", "Oficina")]),
        };

        var assignment = new List<Guid?>();
        foreach (var department in departments ?? [])
        {
            for (var i = 0; i < department.Respondents; i++)
            {
                assignment.Add(department.Id);
            }
        }

        // Demographics the way SurveyAggregateLoader hands them over, which is NOT the way they
        // read: `response_demographics.value` is a jsonb column written with
        // JsonSerializer.Serialize, and the raw payload goes straight into Compute, which
        // decodes it. A fixture putting a bare `Venezolana` in the dictionary would exercise a
        // shape no producer writes -- and would still pass, because the decoder tolerates it.
        var demographicAssignment = new List<Dictionary<string, string>>();
        for (var i = 0; i < respondentCount; i++)
        {
            demographicAssignment.Add(new Dictionary<string, string>(StringComparer.Ordinal));
        }

        var cursorByField = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (field, value, count) in demographics ?? [])
        {
            var cursor = cursorByField.GetValueOrDefault(field);
            for (var i = 0; i < count && cursor < respondentCount; i++, cursor++)
            {
                demographicAssignment[cursor][field] = JsonSerializer.Serialize(value);
            }

            cursorByField[field] = cursor;
        }

        var responses = new List<AggregationResponse>();
        var answers = new List<AggregationAnswer>();
        for (var i = 0; i < respondentCount; i++)
        {
            var id = Guid.Parse($"aaaaaaaa-0000-0000-0000-{i:D12}");
            responses.Add(new AggregationResponse(
                id,
                ContentLanguages.Spanish,
                i < assignment.Count ? assignment[i] : null,
                IsComplete: true,
                new DateTimeOffset(2026, 8, 1, 9, 0, 0, TimeSpan.Zero),
                new DateTimeOffset(2026, 8, 1, 9, 5, 0, TimeSpan.Zero),
                300,
                demographicAssignment[i]));

            answers.Add(new AggregationAnswer(id, QuestionId, JsonSerializer.Serialize("remote"), null));
        }

        return SurveyAggregation.Compute(
            questions,
            responses,
            answers,
            (departments ?? []).Select(d => new AggregationDepartment(d.Id, d.Name, d.Headcount)).ToList(),
            invited);
    }

    // ------------------------------------------------------------------
    // Reading the output back
    // ------------------------------------------------------------------

    /// <summary>
    /// Every string the content streams actually DRAW, decoded from the PDF literals.
    /// </summary>
    /// <remarks>
    /// A substring search over the whole file cannot express "no cell is the string 0", which is
    /// the one assertion the suppression branch is provable by: a PDF's cross-reference table,
    /// its object numbers and its coordinates are full of zeros. Reading the literals back also
    /// means an accented label is compared as the character rather than as the octal escape the
    /// serialiser emitted.
    /// </remarks>
    private static IReadOnlyList<string> DrawnStrings(PdfDocument document)
    {
        var content = Encoding.Latin1.GetString(document.ToBytes());

        // `Tm (` anchors on the text-positioning operator, so /Info's /Title -- a literal too,
        // and not drawn on any page -- is excluded by construction rather than by an index.
        return [.. TjPattern().Matches(content).Select(match => Unescape(match.Groups["literal"].Value))];
    }

    /// <summary>
    /// The drawn strings rejoined into prose.
    /// </summary>
    /// <remarks>
    /// <see cref="PdfDocument.WrapText"/> breaks a paragraph on whitespace, so rejoining the
    /// lines with a single space reconstructs the sentence exactly -- which is what lets a test
    /// assert on a sentence rather than on wherever the wrapper happened to break it. A test
    /// that searched one drawn line for a sentence would go green or red depending on the
    /// content width, which is not the guarantee.
    /// </remarks>
    private static string Prose(PdfDocument document) => string.Join(" ", DrawnStrings(document));

    /// <summary>Reverses <c>PdfDocument.LiteralString</c>: the escapes back into characters.</summary>
    private static string Unescape(string literal)
    {
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

    private sealed record CsvRow(
        string Section,
        string Survey,
        string Question,
        string Group,
        string Language,
        string Metric,
        string Value);

    private static string CsvText(ReportRenderContext context)
        // The BOM is three bytes CsvWriter prepends deliberately, and it is not part of the
        // document.
        => Encoding.UTF8.GetString(ReportRenderer.BuildCsv(context).ToBytes().AsSpan(3));

    private static IReadOnlyList<CsvRow> CsvRows(ReportRenderContext context)
    {
        return
        [
            .. CsvText(context)
                .Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
                .Skip(1)
                .Select(line =>
                {
                    // Every field is quoted unconditionally, so the fields are exactly what
                    // sits between the outer quotes. Good enough for a fixture whose values
                    // contain no embedded quotes; the escaping itself is CsvWriterTests'.
                    var fields = line[1..^1].Split("\",\"", StringSplitOptions.None);
                    return new CsvRow(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6]);
                }),
        ];
    }

    private static string Cell(
        IReadOnlyList<CsvRow> rows,
        string section,
        string group,
        string metric,
        string? survey = null)
        => rows.Single(r =>
            r.Section == section
            && r.Group == group
            && r.Metric == metric
            && (survey is null || r.Survey == survey)).Value;

    [GeneratedRegex(@"Tm \((?<literal>(?:\\.|[^\\)])*)\) Tj")]
    private static partial Regex TjPattern();
}
