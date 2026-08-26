using System.Globalization;
using System.Text;
using System.Text.Json;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// What leaves the building in a file, proved against the same aggregation the results screen
/// serves.
///
/// <para>
/// <b>The aggregate is computed, never assembled.</b> Every fixture below goes through
/// <see cref="SurveyAggregation.Compute"/> with response and answer rows, exactly as
/// <c>SurveyAggregateLoader</c> feeds it in production. Hand-building a
/// <see cref="SurveyAggregate"/> with <c>IsSuppressed: true</c> and empty questions would
/// prove that the exporter prints an empty list when handed an empty list -- which is not the
/// guarantee. The guarantee is that a survey with four complete responses produces a file with
/// no per-question content in it, and that can only be shown by starting from four responses.
/// </para>
/// </summary>
public class SurveyExportTests
{
    private static readonly Guid SurveyId = Guid.Parse("5e2b1d1a-0000-0000-0000-000000000001");
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Engineering = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Direction = Guid.Parse("55555555-5555-5555-5555-555555555555");

    private static readonly DateTimeOffset GeneratedAt = new(2026, 8, 26, 12, 0, 0, TimeSpan.Zero);

    // ==================================================================
    // THE PROPERTY THIS SLICE OWNS: the file cannot show what the screen withholds.
    // ==================================================================

    /// <summary>
    /// Four complete responses is below <see cref="SurveyResultsPrivacy.MinimumRespondents"/>,
    /// and an export is exactly where that gets bypassed by accident -- different code from
    /// the screen, read by people the screen never reached.
    /// </summary>
    [Fact]
    public async Task Below_the_survey_floor_the_csv_carries_no_per_question_content()
    {
        var rows = await CsvRowsAsync(Context(Aggregate(respondentCount: 4)));

        // Not "the flag is set" -- the CONTENT is absent. A test that only asserted
        // is_suppressed would pass on a file that set the flag and printed the answers anyway,
        // which is the exact defect this is here to catch.
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.QuestionSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.OptionSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.WordSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.DimensionSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.SegmentSection);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.SegmentQuestionSection);

        // The participation counters ARE still there. "3 of 40 so far" identifies nobody and
        // is the number that tells an admin whether to keep chasing responses.
        Assert.Equal("4", Summary(rows, "completed_count"));
        Assert.Equal("true", Summary(rows, "is_suppressed"));
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, Summary(rows, "suppression_reason"));
    }

    /// <summary>The same survey, one response later: the floor is met and the content appears.</summary>
    /// <remarks>
    /// The control on the test above. Without it, an exporter that emitted nothing at all --
    /// for every survey, always -- would pass the suppression test perfectly.
    /// </remarks>
    [Fact]
    public async Task At_the_floor_the_csv_carries_the_distribution()
    {
        var rows = await CsvRowsAsync(Context(Aggregate(respondentCount: SurveyResultsPrivacy.MinimumRespondents)));

        Assert.Equal("false", Summary(rows, "is_suppressed"));
        Assert.Contains(rows, r => r.Section == SurveyExport.QuestionSection && r.Metric == "text");

        var remote = rows.Single(r =>
            r.Section == SurveyExport.OptionSection && r.Group == "remote" && r.Metric == "count");
        Assert.Equal(SurveyResultsPrivacy.MinimumRespondents.ToString(CultureInfo.InvariantCulture), remote.Value);
    }

    /// <summary>
    /// A department below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/> gets no
    /// answers in the file.
    /// </summary>
    /// <remarks>
    /// The demographic breakdown is the other half of the export risk the issue names: a survey
    /// can clear its own floor while a slice of it does not, and the slice is what identifies
    /// people. Engineering has six respondents here and Direction has three, so one segment must
    /// carry per-question rows and the other must carry none.
    /// </remarks>
    [Fact]
    public async Task A_segment_below_the_floor_contributes_no_answers_to_the_file()
    {
        var rows = await CsvRowsAsync(Context(Aggregate(
            respondentCount: 9,
            departments: [(Engineering, "Ingeniería", 20, 6), (Direction, "Dirección", 4, 3)])));

        var engineering = $"department:{Engineering}";
        var direction = $"department:{Direction}";

        Assert.Equal("false", SegmentMetric(rows, engineering, "is_suppressed"));
        Assert.Equal("true", SegmentMetric(rows, direction, "is_suppressed"));

        // The one that matters: no per-question row for the small group, in any metric.
        Assert.Contains(rows, r => r.Section == SurveyExport.SegmentQuestionSection && r.Group == engineering);
        Assert.DoesNotContain(rows, r => r.Section == SurveyExport.SegmentQuestionSection && r.Group == direction);

        // Nor its participation rate, which with a headcount beside it is a respondent count
        // by another name.
        Assert.Equal(string.Empty, SegmentMetric(rows, direction, "participation_rate"));
        Assert.Equal(string.Empty, SegmentMetric(rows, direction, "headcount"));
        Assert.Equal("0", SegmentMetric(rows, direction, "respondent_count"));

        // Withheld visibly, so a reader can tell a suppressed group from an absent one and the
        // totals still reconcile against completed_count.
        var breakdown = rows.Where(r => r.Section == SurveyExport.BreakdownSection && r.Group == "department").ToList();
        Assert.Equal("1", breakdown.Single(r => r.Metric == "suppressed_segment_count").Value);
        Assert.Equal("3", breakdown.Single(r => r.Metric == "suppressed_respondent_count").Value);
    }

    [Fact]
    public async Task The_floors_themselves_travel_with_the_file()
    {
        // A reader holding a spreadsheet of withheld rows has to be able to see what the
        // threshold was without opening the app. Bound to the constants, not to literals, so
        // tuning the floor moves the file and this assertion together.
        var rows = await CsvRowsAsync(Context(Aggregate(respondentCount: 6)));

        Assert.Equal(
            SurveyResultsPrivacy.MinimumRespondents.ToString(CultureInfo.InvariantCulture),
            Summary(rows, "minimum_respondents"));
        Assert.Equal(
            SurveyResultsPrivacy.MinimumSegmentRespondents.ToString(CultureInfo.InvariantCulture),
            Summary(rows, "minimum_segment_respondents"));
        Assert.Equal(
            SurveyResultsPrivacy.MinimumWordRespondents.ToString(CultureInfo.InvariantCulture),
            Summary(rows, "minimum_word_respondents"));
    }

    // ==================================================================
    // The CSV as a file
    // ==================================================================

    [Fact]
    public async Task A_title_that_would_be_a_formula_is_neutralised()
    {
        // The survey title is admin-entered text that lands in cell A-something of a
        // spreadsheet opened by a CompanyAdmin. Quoting it does not stop Excel evaluating it.
        var bytes = await CsvBytesAsync(Context(Aggregate(respondentCount: 6), title: "=cmd|'/c calc'!A1"));
        var text = Encoding.UTF8.GetString(bytes.AsSpan(3));

        Assert.Contains("\"'=cmd|'/c calc'!A1\"", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_csv_is_utf8_with_a_bom_and_keeps_its_accents()
    {
        var bytes = await CsvBytesAsync(Context(Aggregate(respondentCount: 6), title: "Clima Q3 — Dirección"));

        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        Assert.Contains("Clima Q3 — Dirección", Encoding.UTF8.GetString(bytes.AsSpan(3)), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Every_row_has_exactly_the_declared_columns()
    {
        // The arity guard fires on a ragged row, so this is really a statement that the
        // exporter never trips it -- across every section, including the ones a small fixture
        // would not reach.
        var bytes = await CsvBytesAsync(Context(Aggregate(
            respondentCount: 9,
            departments: [(Engineering, "Ingeniería", 20, 6), (Direction, "Dirección", 4, 3)],
            openText: true)));

        var lines = Encoding.UTF8.GetString(bytes.AsSpan(3))
            .Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

        Assert.All(lines, line => Assert.Equal(
            SurveyExport.Columns.Length,
            line.Split("\",\"", StringSplitOptions.None).Length));

        Assert.Equal(
            string.Join(",", SurveyExport.Columns.Select(c => $"\"{c}\"")),
            lines[0]);
    }

    // ==================================================================
    // The PDF
    // ==================================================================

    [Fact]
    public void The_pdf_says_why_it_is_empty_rather_than_being_silently_empty()
    {
        // A reader of a FILE cannot ask anyone why a section is missing. An export that simply
        // omitted the results would read as "the survey got no answers", which is a different
        // and materially wrong statement about a workforce.
        var document = SurveyExport.BuildPdf(Context(Aggregate(respondentCount: 4), locale: ContentLanguages.Spanish));
        var drawn = DrawnText(document);

        Assert.Contains("Resultados reservados", drawn, StringComparison.Ordinal);
        Assert.Contains("4 respuestas completas", drawn, StringComparison.Ordinal);

        // And no answer content anywhere in the document.
        Assert.DoesNotContain("remote", drawn, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_pdf_never_names_a_withheld_group()
    {
        // Stricter than the CSV on purpose: the CSV carries the suppressed segment's row with
        // is_suppressed=true because the machine surface has to reconcile, while the PDF is
        // read by a human who would take a named row with a blank rate as a data-entry gap.
        var document = SurveyExport.BuildPdf(Context(Aggregate(
            respondentCount: 9,
            departments: [(Engineering, "Ingeniería", 20, 6), (Direction, "Dirección", 4, 3)])));

        var drawn = DrawnText(document);

        Assert.Contains("Ingenier", drawn, StringComparison.Ordinal);
        Assert.DoesNotContain("Direcci\\363n", drawn, StringComparison.Ordinal);

        // Counted, though, so the reader knows a group exists and was withheld.
        Assert.Contains("Withheld groups: 1", drawn, StringComparison.Ordinal);
    }

    [Fact]
    public void The_pdf_states_the_floor_it_was_produced_under()
    {
        var drawn = DrawnText(SurveyExport.BuildPdf(Context(Aggregate(respondentCount: 6))));

        Assert.Contains("Confidentiality", drawn, StringComparison.Ordinal);
        Assert.Contains(
            SurveyResultsPrivacy.MinimumRespondents.ToString(CultureInfo.InvariantCulture),
            drawn,
            StringComparison.Ordinal);
    }

    [Fact]
    public void The_pdf_chrome_follows_the_locale_the_reader_is_actually_reading()
    {
        // ResolvedLocale, not the requested one: a Spanish-only survey fetched with ?lang=en
        // comes back in Spanish, and a document whose chrome said "Participation" over Spanish
        // question text would be the silent substitution #195 forbids, in print.
        // 6 of 7 invited: a participation rate with decimals, which is what makes the
        // separator observable at all. 6 of 12 is exactly 50 and would prove nothing.
        var spanish = DrawnText(SurveyExport.BuildPdf(Context(Aggregate(respondentCount: 6, invited: 7), locale: ContentLanguages.Spanish)));
        var english = DrawnText(SurveyExport.BuildPdf(Context(Aggregate(respondentCount: 6, invited: 7), locale: ContentLanguages.English)));

        Assert.Contains("Participaci\\363n", spanish, StringComparison.Ordinal);
        Assert.Contains("Participation", english, StringComparison.Ordinal);

        // And the decimal separator with it. A Spanish report writing 64.00 is as wrong as an
        // English one writing 64,00, and it is decided here rather than by the host's ICU.
        Assert.Contains("85,71", spanish, StringComparison.Ordinal);
        Assert.Contains("85.71", english, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_two_formats_report_the_same_numbers()
    {
        // The reason both come from one projection. "The CSV says 62% and the PDF says 58%" is
        // the failure that makes an export untrustworthy, and it is only impossible if
        // something asserts it.
        var context = Context(Aggregate(
            respondentCount: 9,
            departments: [(Engineering, "Ingeniería", 20, 6), (Direction, "Dirección", 4, 3)]));

        var rows = await CsvRowsAsync(context);
        var drawn = DrawnText(SurveyExport.BuildPdf(context));

        var completed = Summary(rows, "completed_count");
        var engineeringRespondents = SegmentMetric(rows, $"department:{Engineering}", "respondent_count");

        Assert.Equal("9", completed);
        Assert.Equal("6", engineeringRespondents);

        // Both figures appear in the document, drawn as text rather than inferred.
        Assert.Contains($"({completed})", drawn, StringComparison.Ordinal);
        Assert.Contains($"({engineeringRespondents})", drawn, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Fixtures -- built the way production builds them
    // ------------------------------------------------------------------

    /// <summary>
    /// Computes a real aggregate from real response and answer rows.
    /// </summary>
    /// <param name="respondentCount">Complete responses. Everyone answers "remote".</param>
    /// <param name="departments">(id, name, headcount, respondents) -- respondents must sum to at most <paramref name="respondentCount"/>.</param>
    /// <param name="openText">Adds a second, open-ended question so the word sections are reached.</param>
    private static SurveyAggregate Aggregate(
        int respondentCount,
        IReadOnlyList<(Guid Id, string Name, int Headcount, int Respondents)>? departments = null,
        bool openText = false,
        int invited = 12)
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

        var openId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        if (openText)
        {
            questions.Add(new AggregationQuestion(openId, 1, QuestionTypes.OpenEnded, "¿Qué mejorarías?", "environment", null, null, null, null, []));
        }

        var responses = new List<AggregationResponse>();
        var answers = new List<AggregationAnswer>();

        var assignment = new List<Guid?>();
        foreach (var department in departments ?? [])
        {
            for (var i = 0; i < department.Respondents; i++)
            {
                assignment.Add(department.Id);
            }
        }

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
                new Dictionary<string, string>(StringComparer.Ordinal)));

            answers.Add(new AggregationAnswer(id, QuestionId, JsonSerializer.Serialize("remote"), null));

            if (openText)
            {
                answers.Add(new AggregationAnswer(id, openId, JsonSerializer.Serialize("mejor comunicación"), null));
            }
        }

        var aggregationDepartments = (departments ?? [])
            .Select(d => new AggregationDepartment(d.Id, d.Name, d.Headcount))
            .ToList();

        // Invited is non-null so participation is a number rather than null, and the two
        // formats have something to disagree about if they can.
        return SurveyAggregation.Compute(questions, responses, answers, aggregationDepartments, invited);
    }

    private static SurveyExportContext Context(
        SurveyAggregate aggregate,
        string? title = "Clima Q3",
        string locale = ContentLanguages.English)
        => new(
            SurveyId,
            title,
            SurveyStatuses.Active,
            ContentLanguages.Both,
            locale,
            [],
            aggregate,
            GeneratedAt);

    // ------------------------------------------------------------------
    // Reading the output back
    // ------------------------------------------------------------------

    private sealed record CsvRow(string Section, string Question, string Group, string Language, string Metric, string Value);

    private static async Task<byte[]> CsvBytesAsync(SurveyExportContext context)
    {
        using var stream = new MemoryStream();
        await using (var csv = new CsvStreamWriter(stream, SurveyExport.Columns))
        {
            await SurveyExport.WriteCsvAsync(csv, context);
        }

        return stream.ToArray();
    }

    private static async Task<IReadOnlyList<CsvRow>> CsvRowsAsync(SurveyExportContext context)
    {
        var text = Encoding.UTF8.GetString((await CsvBytesAsync(context)).AsSpan(3));

        return
        [
            .. text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
                .Skip(1)
                .Select(line =>
                {
                    // Every field is quoted unconditionally, so the fields are exactly what
                    // sits between the outer quotes. Good enough for a fixture whose values
                    // contain no embedded quotes; the escaping itself is CsvWriterTests'.
                    var fields = line[1..^1].Split("\",\"", StringSplitOptions.None);
                    return new CsvRow(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]);
                }),
        ];
    }

    private static string Summary(IReadOnlyList<CsvRow> rows, string key)
        => rows.Single(r => r.Section == SurveyExport.SummarySection && r.Group == key).Value;

    private static string SegmentMetric(IReadOnlyList<CsvRow> rows, string key, string metric)
        => rows.Single(r => r.Section == SurveyExport.SegmentSection && r.Group == key && r.Metric == metric).Value;

    /// <summary>Everything the document actually draws, as it appears in the content streams.</summary>
    private static string DrawnText(PdfDocument document)
        => Encoding.Latin1.GetString(document.ToBytes());
}
