using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// The allow-list that decides what <c>GET /shared/reports/{token}</c> publishes to a caller
/// with no account.
///
/// <para>
/// These are unit tests because the property being defended is a property of the projection,
/// not of the route: what an anonymous reader may have is decided in
/// <see cref="PublicReportProjection"/> and nowhere else, so it can be proved without Docker
/// and it stays proved when someone moves the endpoint. The integration suite carries the
/// other half -- that the endpoint actually goes through here.
/// </para>
/// <para>
/// Every assertion below is on the SERIALISED public document, the bytes the browser gets, for
/// the reason <see cref="ReportSurveySectionsTests"/> gives: "the projection dropped it" is not
/// the guarantee anybody needs.
/// </para>
/// </summary>
public class PublicReportProjectionTests
{
    private static readonly Guid SurveyId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid ScaleQuestionId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly Guid OpenQuestionId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");
    private static readonly Guid BenchmarkId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000004");
    private static readonly Guid InsightId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000005");

    // ------------------------------------------------------------------
    // The fail-closed property itself
    // ------------------------------------------------------------------

    /// <summary>
    /// The tripwire described on <see cref="PublicReportProjection.StoredSectionsRuledOn"/>.
    ///
    /// <para>
    /// If you are reading this because it just went red: you added a section to
    /// <see cref="ReportOutputDocument"/>, and whether an anonymous holder of a share URL may
    /// read it is now your decision to make. It is currently WITHHELD, which is the safe
    /// answer and may well be the right one. To keep it withheld, name it in
    /// <c>StoredSectionsRuledOn</c> and stop. To publish it, name it there AND add it to
    /// <see cref="PublicReportDocument"/> and <c>PublicReportProjection.ToPublic</c>.
    /// </para>
    /// </summary>
    [Fact]
    public void Every_stored_section_has_been_ruled_on()
    {
        var stored = typeof(ReportOutputDocument)
            .GetProperties()
            .Select(p => p.Name)
            .Where(name => name != "EqualityContract")
            .ToHashSet(StringComparer.Ordinal);

        var unruled = stored.Except(PublicReportProjection.StoredSectionsRuledOn, StringComparer.Ordinal).ToList();
        Assert.True(
            unruled.Count == 0,
            $"ReportOutputDocument section(s) nobody has ruled on: {string.Join(", ", unruled)}. "
            + "They are withheld from the public share link until named in "
            + "PublicReportProjection.StoredSectionsRuledOn -- see that member's remarks.");

        // And the reverse, so the set cannot rot into a list of sections that no longer exist
        // and quietly stop tripping on the next real addition.
        var stale = PublicReportProjection.StoredSectionsRuledOn.Except(stored, StringComparer.Ordinal).ToList();
        Assert.True(stale.Count == 0, $"Ruled on but no longer part of ReportOutputDocument: {string.Join(", ", stale)}.");
    }

    /// <summary>
    /// The structural half: a key sitting in <c>report_output</c> that the allow-list does not
    /// name never reaches the public payload -- at the top level, and nested inside a section
    /// that IS admitted.
    /// </summary>
    /// <remarks>
    /// This is the test the whole change exists for. The endpoint used to hand back the stored
    /// string, so the public payload was defined by whatever the last writer of that column
    /// put in it. Here the stored document carries three keys nobody allow-listed, one of them
    /// holding a respondent's sentence, and none of them survives.
    /// </remarks>
    [Fact]
    public void A_stored_key_that_is_not_on_the_allow_list_does_not_reach_the_public_payload()
    {
        const string sentinel = "I-am-a-respondent-and-I-wrote-this";

        var storedJson = """
            {
              "generationNote": "a note",
              "surveys": [
                {
                  "surveyId": "aaaaaaaa-0000-0000-0000-000000000001",
                  "title": "Kept",
                  "status": "closed",
                  "resolvedLocale": "en",
                  "questions": [],
                  "dimensions": [],
                  "departments": [],
                  "demographics": [],
                  "isSuppressed": false,
                  "minimumGroupSize": 5,
                  "rawResponses": ["I-am-a-respondent-and-I-wrote-this"]
                }
              ],
              "aiInsights": [],
              "benchmarks": [],
              "verbatimAppendix": ["I-am-a-respondent-and-I-wrote-this"],
              "createdBy": "22222222-2222-2222-2222-222222222222"
            }
            """;

        var published = PublicReportProjection.ToPublicJson(storedJson);
        Assert.NotNull(published);

        // The admitted sections came through, so this is not passing by returning nothing.
        using var document = JsonDocument.Parse(published!);
        Assert.Equal("a note", document.RootElement.GetProperty("generationNote").GetString());
        Assert.Equal("Kept", document.RootElement.GetProperty("surveys").EnumerateArray().Single().GetProperty("title").GetString());

        // The three keys nobody named: gone, top-level and nested alike.
        var names = PropertyNames(document.RootElement).ToHashSet(StringComparer.Ordinal);
        Assert.DoesNotContain("verbatimAppendix", names);
        Assert.DoesNotContain("createdBy", names);
        Assert.DoesNotContain("rawResponses", names);
        Assert.DoesNotContain(sentinel, published, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("22222222-2222-2222-2222-222222222222", published, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// A document this projection cannot read is withheld, not forwarded. The alternative --
    /// pass the bytes through when parsing fails -- is exactly the verbatim behaviour the
    /// allow-list replaced, and it would be reachable by writing junk into the column.
    /// </summary>
    [Fact]
    public void An_unreadable_or_absent_stored_document_publishes_nothing()
    {
        Assert.Null(PublicReportProjection.ToPublicJson(null));
        Assert.Null(PublicReportProjection.ToPublicJson(""));
        Assert.Null(PublicReportProjection.ToPublicJson("   "));
        Assert.Null(PublicReportProjection.ToPublicJson("not json at all"));
        Assert.Null(PublicReportProjection.ToPublicJson("""{"generationNote": "unterminated"""));
        Assert.Null(PublicReportProjection.ToPublicJson("null"));
    }

    // ------------------------------------------------------------------
    // The one subtraction: open-text word frequencies
    // ------------------------------------------------------------------

    /// <summary>
    /// The words themselves never leave, and the reader is told they were withheld rather than
    /// left to read an empty list as "nobody wrote anything".
    /// </summary>
    [Fact]
    public void Word_frequencies_are_emptied_and_reported_as_withheld()
    {
        var document = Serialize(DocumentWith(OpenQuestion(
            words: [new SurveyWordFrequency("en", "restructuring", 9, 3), new SurveyWordFrequency("es", "reestructuración", 4, 2)],
            suppressedWordCount: 7)));

        var published = PublicReportProjection.ToPublicJson(document);
        using var parsed = JsonDocument.Parse(published!);
        var question = parsed.RootElement.GetProperty("surveys").EnumerateArray().Single()
            .GetProperty("questions").EnumerateArray().Single();

        Assert.Empty(question.GetProperty("words").EnumerateArray());
        Assert.DoesNotContain("restructuring", published, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("reestructuraci", published, StringComparison.OrdinalIgnoreCase);

        // 7 already withheld under the word floor + the 2 withheld here. Non-zero is the load
        // bearing part: SharedReportSections.tsx renders its "words withheld" line only when
        // this is above zero, so a zero here would publish "there were none".
        Assert.Equal(9, question.GetProperty("suppressedWordCount").GetInt32());
    }

    /// <summary>
    /// The counterpart, and the reason the count is a sum rather than a constant: a question
    /// nobody answered has nothing to withhold, and saying "withheld" there would be its own
    /// false statement.
    /// </summary>
    [Fact]
    public void A_question_with_no_words_at_all_still_reports_nothing_withheld()
    {
        var document = Serialize(DocumentWith(OpenQuestion(words: [], suppressedWordCount: 0)));

        using var parsed = JsonDocument.Parse(PublicReportProjection.ToPublicJson(document)!);
        var question = parsed.RootElement.GetProperty("surveys").EnumerateArray().Single()
            .GetProperty("questions").EnumerateArray().Single();

        Assert.Empty(question.GetProperty("words").EnumerateArray());
        Assert.Equal(0, question.GetProperty("suppressedWordCount").GetInt32());
    }

    /// <summary>
    /// Words and only words. Distributions, dimension scores, department and demographic
    /// participation and the benchmark comparisons are aggregates the platform has already
    /// floored, and the public page exists to show them -- a projection that quietly emptied
    /// them would ship a blank page and nobody would notice until a client did.
    /// </summary>
    [Fact]
    public void Distributions_breakdowns_and_benchmarks_survive_the_projection()
    {
        var document = Serialize(DocumentWith(
            ScaleQuestion(),
            OpenQuestion(words: [new SurveyWordFrequency("en", "pay", 3, 3)], suppressedWordCount: 1)));

        using var parsed = JsonDocument.Parse(PublicReportProjection.ToPublicJson(document)!);
        var section = parsed.RootElement.GetProperty("surveys").EnumerateArray().Single();

        var scale = section.GetProperty("questions").EnumerateArray()
            .Single(q => q.GetProperty("questionId").GetString() == ScaleQuestionId.ToString());
        var buckets = scale.GetProperty("distribution").EnumerateArray().ToList();
        Assert.Equal(2, buckets.Count);
        Assert.Equal(4, buckets.Single(b => b.GetProperty("value").GetString() == "5").GetProperty("count").GetInt32());
        Assert.Equal(3.5, scale.GetProperty("average").GetDouble());

        Assert.Equal("leadership", section.GetProperty("dimensions").EnumerateArray().Single().GetProperty("dimension").GetString());
        Assert.Equal("Engineering", section.GetProperty("departments").EnumerateArray().Single().GetProperty("name").GetString());

        var tenure = section.GetProperty("demographics").EnumerateArray().Single();
        Assert.Equal("tenure", tenure.GetProperty("dimension").GetString());
        Assert.Equal(2, tenure.GetProperty("suppressedSegmentCount").GetInt32());

        var benchmark = parsed.RootElement.GetProperty("benchmarks").EnumerateArray().Single();
        Assert.Equal("Engagement 2025", benchmark.GetProperty("name").GetString());
        Assert.Equal(72.5, benchmark.GetProperty("metrics").EnumerateArray().Single().GetProperty("value").GetDouble());

        Assert.Equal("Rotation is up", parsed.RootElement.GetProperty("aiInsights").EnumerateArray().Single().GetProperty("title").GetString());
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static string Serialize(ReportOutputDocument document)
        => JsonSerializer.Serialize(document, JsonSerializerOptions.Web);

    private static ReportOutputDocument DocumentWith(params SurveyQuestionResult[] questions) => new(
        "a note",
        [
            new ReportSurveySection(
                SurveyId,
                "Clima Q3",
                SurveyStatuses.Closed,
                "en",
                new SurveyResultsSummary(10, 8, 8, 0, 80, 100, 120, null, null, [new SurveyLanguageCount("en", 8)]),
                questions,
                [new SurveyDimensionResult("leadership", 1, 8, 3.5)],
                [new ReportDepartmentParticipation("d1", "Engineering", 8, 80, false)],
                SuppressedDepartmentCount: 1,
                SuppressedRespondentCount: 3,
                UnsegmentedRespondentCount: 0,
                [
                    new ReportDemographicBreakdown(
                        "tenure",
                        [new ReportSegmentParticipation("0-1", "Under a year", 6, false, [new ReportSegmentDimensionScore("leadership", 3.2)])],
                        SuppressedSegmentCount: 2,
                        SuppressedRespondentCount: 4,
                        UnsegmentedRespondentCount: 1),
                ],
                IsSuppressed: false,
                SuppressionReason: null,
                MinimumGroupSize: SurveyResultsPrivacy.MinimumSegmentRespondents),
        ],
        [
            new ReportAIInsightItem(InsightId, "risk", "retention", "Rotation is up", "Two teams", 80, "high", ["Engineering"], ["Talk to them"], false),
        ],
        [
            new ReportBenchmarkComparison(
                BenchmarkId, "Engagement 2025", "engagement", "internal", null, "no_prior_period",
                [new BenchmarkMetricDto(Guid.Empty, "engagement", 72.5, "score", null, 400)],
                null),
        ]);

    private static SurveyQuestionResult ScaleQuestion() => new(
        ScaleQuestionId, 0, QuestionTypes.Likert, "How supported do you feel?", "leadership", 8,
        [new SurveyDistributionBucket("2", "Option 2", 4, 50, null), new SurveyDistributionBucket("5", "Option 5", 4, 50, null)],
        3.5, 3.5, 1, 5, "Never", "Always", [], 0);

    private static SurveyQuestionResult OpenQuestion(IReadOnlyList<SurveyWordFrequency> words, int suppressedWordCount) => new(
        OpenQuestionId, 1, QuestionTypes.OpenEnded, "What would you change?", null, 8,
        [], null, null, null, null, null, null, words, suppressedWordCount);

    private static IEnumerable<string> PropertyNames(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    yield return property.Name;
                    foreach (var nested in PropertyNames(property.Value)) yield return nested;
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var nested in PropertyNames(item)) yield return nested;
                }

                break;
        }
    }
}
