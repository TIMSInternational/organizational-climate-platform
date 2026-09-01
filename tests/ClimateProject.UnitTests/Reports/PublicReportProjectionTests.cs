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
    /// The same tripwire one level down, at the FIELD.
    ///
    /// <para>
    /// If you are reading this because it just went red: you added a property to a type the
    /// public share document reaches, and whether an anonymous holder of a share URL may read
    /// it is now your decision to make. It is currently WITHHELD, which is the safe answer and
    /// may well be the right one. To keep it withheld, name it in that type's
    /// <see cref="PublicShapeRuling.Withheld"/> set and say why. To publish it, declare it on
    /// the public record and carry it in <c>PublicReportProjection.ToPublic</c>.
    /// </para>
    /// <para>
    /// <b>Why this test exists.</b> <see cref="Every_stored_section_has_been_ruled_on"/> holds
    /// at the section level and held nowhere below it, because the four admitted sections were
    /// typed as the INTERNAL records -- so every field on
    /// <see cref="ReportBenchmarkComparison"/> and the sixteen other types they reach published
    /// itself, then and in future, with nobody deciding and nothing going red. That was not
    /// hypothetical: <c>ReportBenchmarkComparison.CompanyId</c> is the tenant GUID and it was
    /// reaching an anonymous reader that way.
    /// </para>
    /// </summary>
    [Fact]
    public void Every_admitted_field_has_been_ruled_on()
    {
        foreach (var ruling in PublicReportProjection.ShapeRulings)
        {
            var stored = PropertiesOf(ruling.Stored);
            var published = PropertiesOf(ruling.Public);

            var unruled = stored.Except(published, StringComparer.Ordinal)
                .Except(ruling.Withheld, StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();
            Assert.True(
                unruled.Count == 0,
                $"{ruling.Stored.Name} field(s) nobody has ruled on: {string.Join(", ", unruled)}. "
                + $"They are withheld from the public share link until either declared on {ruling.Public.Name} "
                + "(which PUBLISHES them to every anonymous holder of a share URL) or named in that type's "
                + "withhold set -- see PublicReportProjection.ShapeRulings.");

            // A withheld name that no longer exists on the stored type is a ruling that has
            // stopped protecting anything and would not trip on the next real addition.
            var stale = ruling.Withheld.Except(stored, StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();
            Assert.True(
                stale.Count == 0,
                $"Withheld but no longer part of {ruling.Stored.Name}: {string.Join(", ", stale)}.");

            // And a public field with no stored source: either the projection derives it and
            // somebody said so, or nobody can say where the value on the wire comes from.
            var unexplained = published.Except(stored, StringComparer.Ordinal)
                .Except(ruling.Derived, StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();
            Assert.True(
                unexplained.Count == 0,
                $"{ruling.Public.Name} publishes field(s) with no source on {ruling.Stored.Name} and no "
                + $"Derived ruling: {string.Join(", ", unexplained)}.");

            var notDerived = ruling.Derived.Intersect(stored, StringComparer.Ordinal)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();
            Assert.True(
                notDerived.Count == 0,
                $"Declared derived but {ruling.Stored.Name} now carries it: {string.Join(", ", notDerived)}. "
                + "Carry it across or withhold it; do not compute a second version of a stored field.");
        }
    }

    /// <summary>
    /// The last hole in the field tripwire: a whole new nested record, added to the public
    /// document with no ruling at all, would leave every one of ITS fields unchecked.
    /// </summary>
    /// <remarks>
    /// Walks the public document's own type graph rather than a hand-kept list, because a
    /// hand-kept list is the thing that goes stale. Every public record reachable from
    /// <see cref="PublicReportDocument"/> must be the <see cref="PublicShapeRuling.Public"/>
    /// half of exactly one ruling, and every ruling must be reachable -- a ruling for a record
    /// nothing reaches is checking a type nobody publishes.
    /// </remarks>
    [Fact]
    public void Every_public_type_reaches_a_ruling()
    {
        var reachable = PublicTypeGraph(typeof(PublicReportDocument)).ToList();
        var ruled = PublicReportProjection.ShapeRulings.Select(r => r.Public).ToList();

        var unruled = reachable.Except(ruled).Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
        Assert.True(
            unruled.Count == 0,
            $"Public record(s) the share document reaches with no PublicShapeRuling: {string.Join(", ", unruled)}. "
            + "Every field on them is unchecked until one is added.");

        var unreachable = ruled.Except(reachable).Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
        Assert.True(
            unreachable.Count == 0,
            $"Ruled on but not reachable from PublicReportDocument: {string.Join(", ", unreachable)}.");

        Assert.Equal(ruled.Count, ruled.Distinct().Count());
    }

    /// <summary>
    /// The leak this whole field-level pass was for: the <b>tenant GUID</b> reached an
    /// anonymous reader inside every benchmark row, and now does not.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>SharedReportResponse</c> already calls <c>companyId</c> one of "the two identifiers
    /// that would let a holder join this document to another tenant surface" and keeps it off
    /// the envelope. It was arriving one level down, inside the document, because the admitted
    /// <c>Benchmarks</c> section was the internal type.
    /// </para>
    /// <para>
    /// Both rows are asserted, because the replacement has to mean the same thing it replaced:
    /// <c>isGlobal</c> is true on exactly the rows <c>companyId === null</c> was true on, which
    /// is what keeps the page's "Global" chip on the same benchmarks.
    /// </para>
    /// </remarks>
    [Fact]
    public void A_benchmark_says_whether_it_is_global_and_never_which_tenant_it_belongs_to()
    {
        var tenant = Guid.Parse("cccccccc-0000-0000-0000-00000000000c");
        var priorPeriodId = Guid.Parse("dddddddd-0000-0000-0000-00000000000d");
        var document = new ReportOutputDocument(
            "a note",
            [],
            [],
            [
                new ReportBenchmarkComparison(
                    BenchmarkId, "Sector engagement", "engagement", "industry", null, "no_prior_period",
                    [new BenchmarkMetricDto(Guid.Empty, "engagement", 70, "score", null, 4000)],
                    null),
                new ReportBenchmarkComparison(
                    BenchmarkId, "Our engagement", "engagement", "internal", tenant, "linked",
                    [new BenchmarkMetricDto(Guid.Empty, "engagement", 72.5, "score", null, 400)],
                    new BenchmarkPriorPeriodDto(
                        priorPeriodId,
                        "Our engagement 2024",
                        [new BenchmarkMetricChangeDto("engagement", 72.5, "score", 70, "score", 2.5, 0.0357)])),
            ]);

        var published = PublicReportProjection.ToPublicJson(JsonSerializer.Serialize(document, JsonSerializerOptions.Web));

        // The tenant GUID, in any casing, anywhere in the bytes: gone. So is the prior period's
        // own row id, which the page never read -- BenchmarkDetail withholds that same pointer
        // from an AUTHENTICATED caller who may not read the row.
        Assert.DoesNotContain(tenant.ToString(), published!, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(priorPeriodId.ToString(), published!, StringComparison.OrdinalIgnoreCase);

        using var parsed = JsonDocument.Parse(published!);
        var benchmarks = parsed.RootElement.GetProperty("benchmarks").EnumerateArray().ToList();
        var names = PropertyNames(parsed.RootElement).ToHashSet(StringComparer.Ordinal);
        Assert.DoesNotContain("companyId", names);

        var global = benchmarks.Single(b => b.GetProperty("name").GetString() == "Sector engagement");
        Assert.True(global.GetProperty("isGlobal").GetBoolean());

        var ours = benchmarks.Single(b => b.GetProperty("name").GetString() == "Our engagement");
        Assert.False(ours.GetProperty("isGlobal").GetBoolean());

        // The row is otherwise intact -- a projection that dropped the comparison would satisfy
        // every assertion above and ship a benchmarks section with nothing to compare.
        var prior = ours.GetProperty("priorPeriod");
        Assert.Equal("Our engagement 2024", prior.GetProperty("name").GetString());
        Assert.Equal(2.5, prior.GetProperty("metrics").EnumerateArray().Single().GetProperty("delta").GetDouble());
    }

    /// <summary>
    /// The three other field-level withholdings, asserted on the bytes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>affectedSegments</c> is a free list of segment names the insight generator wrote,
    /// which passes through none of the aggregation that applies the anonymity floor -- so a
    /// department too small to keep its row in the tables above can be named beside a finding
    /// about it. <c>SharedReportSections.tsx</c> refuses to render it and pins the refusal; the
    /// server was publishing it in the bytes regardless, where not rendering is no protection.
    /// </para>
    /// <para>
    /// The two <c>suppressedRespondentCount</c> fields are the withheld HEADCOUNT behind the
    /// suppressed departments and groups -- the exact number the floor exists to hide, which
    /// <c>SegmentBreakdownPanel</c> will not print even to an administrator inside the tenant.
    /// The counts of withheld GROUPS stay, because they name nobody, and they are asserted here
    /// so this test cannot pass by emptying the section.
    /// </para>
    /// </remarks>
    [Fact]
    public void Unfloored_segment_names_and_withheld_headcounts_do_not_reach_an_anonymous_reader()
    {
        var published = PublicReportProjection.ToPublicJson(Serialize(DocumentWith(ScaleQuestion())))!;

        using var parsed = JsonDocument.Parse(published);
        var names = PropertyNames(parsed.RootElement).ToHashSet(StringComparer.Ordinal);
        Assert.DoesNotContain("affectedSegments", names);
        Assert.DoesNotContain("suppressedRespondentCount", names);

        // The fixture's affected segment is a department name, and it is the ONLY place that
        // string appears in the document -- the department rows below carry their own names, so
        // a hit here is the unfloored list and nothing else.
        Assert.DoesNotContain("Sales", published, StringComparison.Ordinal);

        // What stays: the counts of withheld groups, which name nobody, and the recommended
        // actions, which are the platform's own prose.
        var section = parsed.RootElement.GetProperty("surveys").EnumerateArray().Single();
        Assert.Equal(1, section.GetProperty("suppressedDepartmentCount").GetInt32());
        Assert.Equal(2, section.GetProperty("demographics").EnumerateArray().Single().GetProperty("suppressedSegmentCount").GetInt32());
        Assert.Equal(
            "Talk to them",
            parsed.RootElement.GetProperty("aiInsights").EnumerateArray().Single()
                .GetProperty("recommendedActions").EnumerateArray().Single().GetString());
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
            // The affected segment is deliberately a name that appears NOWHERE else in this
            // fixture, so `DoesNotContain("Sales")` can only be failed by the unfloored
            // `affectedSegments` list itself and not by a department row that legitimately
            // carries its own name.
            new ReportAIInsightItem(InsightId, "risk", "retention", "Rotation is up", "Two teams", 80, "high", ["Sales"], ["Talk to them"], false),
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

    /// <summary>Public instance property names of a record, minus the compiler's own.</summary>
    private static IReadOnlyCollection<string> PropertiesOf(Type type) => type
        .GetProperties()
        .Select(p => p.Name)
        .Where(name => name != "EqualityContract")
        .ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// Every public record the share document reaches, found by walking property types rather
    /// than by keeping a list -- a list is what goes stale.
    /// </summary>
    private static IEnumerable<Type> PublicTypeGraph(Type root)
    {
        var seen = new HashSet<Type>();
        var pending = new Queue<Type>();
        pending.Enqueue(root);

        while (pending.Count > 0)
        {
            var type = pending.Dequeue();
            if (!seen.Add(type)) continue;

            foreach (var property in type.GetProperties())
            {
                foreach (var candidate in ElementTypes(property.PropertyType))
                {
                    if (candidate.Namespace == typeof(PublicReportDocument).Namespace
                        && candidate.Name.StartsWith("Public", StringComparison.Ordinal))
                    {
                        pending.Enqueue(candidate);
                    }
                }
            }
        }

        return seen;
    }

    /// <summary>A property's own type and, for a list or a nullable, the types inside it.</summary>
    private static IEnumerable<Type> ElementTypes(Type type)
    {
        var inner = Nullable.GetUnderlyingType(type) ?? type;
        if (inner.IsGenericType)
        {
            foreach (var argument in inner.GetGenericArguments())
            {
                foreach (var nested in ElementTypes(argument)) yield return nested;
            }
        }

        yield return inner;
    }

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
