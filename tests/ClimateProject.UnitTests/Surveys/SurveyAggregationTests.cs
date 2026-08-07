using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The aggregation is pure and takes plain records, so every property below is provable
/// without Postgres, without Docker and without an HTTP round trip. That is the reason
/// <see cref="SurveyAggregation"/> lives in Application rather than in the endpoint.
/// </summary>
public class SurveyAggregationTests
{
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid SecondQuestionId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Sales = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid Engineering = Guid.Parse("44444444-4444-4444-4444-444444444444");

    /// <summary>The jsonb payload a single answer is stored as. A bare string is not valid JSON.</summary>
    private static string Stored(string value) => JsonSerializer.Serialize(value);

    private static string StoredOrdered(params string[] values) => JsonSerializer.Serialize(values);

    private static AggregationQuestion Choice(
        Guid id = default,
        string type = QuestionTypes.MultipleChoice,
        params AggregationOption[] options)
        => new(id == default ? QuestionId : id, 0, type, "Where do you work?", "environment", null, null, options);

    private static AggregationResponse Response(
        Guid id,
        string language = "en",
        Guid? departmentId = null,
        bool isComplete = true,
        IReadOnlyDictionary<string, string>? demographics = null)
        => new(
            id,
            language,
            departmentId,
            isComplete,
            new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero),
            isComplete ? new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero) : null,
            isComplete ? 300 : null,
            demographics ?? new Dictionary<string, string>(StringComparer.Ordinal));

    private static Guid ResponseId(int n) => Guid.Parse($"aaaaaaaa-0000-0000-0000-{n:D12}");

    // ==================================================================
    // THE PROPERTY THIS LANE OWNS: group on the stable option value.
    // ==================================================================

    /// <summary>
    /// The headline requirement. Two respondents reading different languages who pick the
    /// same option must land in ONE bucket -- if a distribution splits by the reader's
    /// locale, every chart, benchmark and export halves its own signal while the row
    /// counts still reconcile exactly, which is why nobody notices.
    /// </summary>
    [Fact]
    public void Respondents_reading_different_locales_who_pick_the_same_option_form_one_bucket()
    {
        var question = Choice(options:
        [
            new AggregationOption(0, "remote", "Remote"),
            new AggregationOption(1, "office", "Office"),
        ]);

        // Three respondents were served English, two Spanish. All five stored the same
        // stable, locale-independent option value.
        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), "en"),
            Response(ResponseId(2), "en"),
            Response(ResponseId(3), "en"),
            Response(ResponseId(4), "es"),
            Response(ResponseId(5), "es"),
        };

        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], targetAudienceCount: 10);

        var result = Assert.Single(aggregate.Questions);
        var bucket = Assert.Single(result.Distribution);
        Assert.Equal("remote", bucket.Value);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(100d, bucket.Percentage);
        Assert.Equal(5, result.AnsweredCount);
    }

    /// <summary>
    /// The falsifiable half of the same property, and the one that actually fails if
    /// somebody groups on display text.
    ///
    /// Two options whose resolved labels COLLIDE in the request locale -- entirely
    /// possible, since labels are free text and nothing constrains them to be distinct --
    /// but whose stable values differ. Grouping on the value keeps two buckets; grouping
    /// on the label silently merges them into one bucket of five. The previous test
    /// cannot catch that, because by the time the aggregation sees a question each option
    /// already carries exactly one resolved label.
    /// </summary>
    [Fact]
    public void Options_whose_labels_collide_stay_separate_buckets()
    {
        var question = Choice(options:
        [
            new AggregationOption(0, "remote_full", "Remote"),
            new AggregationOption(1, "remote_hybrid", "Remote"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, Stored("remote_full"), null),
            new(ResponseId(2), QuestionId, Stored("remote_full"), null),
            new(ResponseId(3), QuestionId, Stored("remote_full"), null),
            new(ResponseId(4), QuestionId, Stored("remote_hybrid"), null),
            new(ResponseId(5), QuestionId, Stored("remote_hybrid"), null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        var result = Assert.Single(aggregate.Questions);
        Assert.Equal(2, result.Distribution.Count);
        Assert.Equal(["remote_full", "remote_hybrid"], result.Distribution.Select(b => b.Value));
        Assert.Equal([3, 2], result.Distribution.Select(b => b.Count));
        // Both still render as "Remote" -- the label is attached after grouping, never used as the key.
        Assert.All(result.Distribution, b => Assert.Equal("Remote", b.Label));
    }

    /// <summary>
    /// Buckets follow the question's own option order, not popularity. A likert scale
    /// rendered "agree, strongly disagree, neutral" because that is the count order is
    /// unreadable, and every chart downstream assumes a stable x-axis.
    /// </summary>
    [Fact]
    public void Buckets_follow_option_order_not_popularity()
    {
        var question = Choice(type: QuestionTypes.Likert, options:
        [
            new AggregationOption(0, "1", "Strongly disagree"),
            new AggregationOption(1, "2", "Disagree"),
            new AggregationOption(2, "3", "Agree"),
        ]);

        var responses = Enumerable.Range(1, 6).Select(n => Response(ResponseId(n))).ToList();
        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, Stored("3"), null),
            new(ResponseId(2), QuestionId, Stored("3"), null),
            new(ResponseId(3), QuestionId, Stored("3"), null),
            new(ResponseId(4), QuestionId, Stored("1"), null),
            new(ResponseId(5), QuestionId, Stored("2"), null),
            new(ResponseId(6), QuestionId, Stored("2"), null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        var result = Assert.Single(aggregate.Questions);
        Assert.Equal(["1", "2", "3"], result.Distribution.Select(b => b.Value));
    }

    // ==================================================================
    // Storage encoding
    // ==================================================================

    /// <summary>
    /// <c>question_responses.response_value</c> is jsonb, so a stored single answer is the
    /// JSON string <c>"remote"</c> -- quotes included. Grouping on the raw payload would
    /// work by accident here and break nothing visible, so the decode is pinned.
    /// </summary>
    [Fact]
    public void The_jsonb_quotes_are_not_part_of_the_group_key()
    {
        var question = Choice(options: [new AggregationOption(0, "remote", "Remote")]);
        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        var bucket = Assert.Single(Assert.Single(aggregate.Questions).Distribution);
        Assert.Equal("remote", bucket.Value);
        Assert.DoesNotContain('"', bucket.Value);
    }

    /// <summary>
    /// A row whose payload is not a shape this code models -- written by an earlier tool
    /// or by the ETL -- contributes nothing rather than 500ing the whole results page.
    /// </summary>
    [Fact]
    public void An_undecodable_payload_is_skipped_rather_than_thrown()
    {
        var question = Choice(options: [new AggregationOption(0, "remote", "Remote")]);
        var responses = Enumerable.Range(1, 6).Select(n => Response(ResponseId(n))).ToList();
        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, Stored("remote"), null),
            new(ResponseId(2), QuestionId, Stored("remote"), null),
            new(ResponseId(3), QuestionId, Stored("remote"), null),
            new(ResponseId(4), QuestionId, Stored("remote"), null),
            new(ResponseId(5), QuestionId, Stored("remote"), null),
            new(ResponseId(6), QuestionId, "this is not json", null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        var result = Assert.Single(aggregate.Questions);
        var bucket = Assert.Single(result.Distribution);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(5, result.AnsweredCount);
    }

    // ==================================================================
    // Open text -- bucketed by Response.Language
    // ==================================================================

    /// <summary>
    /// The live defect <c>Response.Language</c> was added for: a single frequency map
    /// counts "trabajo" and "work" as two unrelated words, each carrying half the weight
    /// of the sentiment they both express, and neither reaching the top of the cloud.
    /// </summary>
    [Fact]
    public void Word_frequencies_are_bucketed_by_the_language_the_respondent_answered_in()
    {
        var question = Choice(type: QuestionTypes.OpenEnded);

        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), "es"),
            Response(ResponseId(2), "es"),
            Response(ResponseId(3), "es"),
            Response(ResponseId(4), "en"),
            Response(ResponseId(5), "en"),
            Response(ResponseId(6), "en"),
        };

        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, Stored("trabajo flexible"), null),
            new(ResponseId(2), QuestionId, Stored("trabajo flexible"), null),
            new(ResponseId(3), QuestionId, Stored("trabajo flexible"), null),
            new(ResponseId(4), QuestionId, Stored("work flexible"), null),
            new(ResponseId(5), QuestionId, Stored("work flexible"), null),
            new(ResponseId(6), QuestionId, Stored("work flexible"), null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var words = Assert.Single(aggregate.Questions).Words;

        Assert.Equal(3, words.Single(w => w.Language == "es" && w.Word == "trabajo").Count);
        Assert.Equal(3, words.Single(w => w.Language == "en" && w.Word == "work").Count);

        // "flexible" is spelled identically in both languages and was written by six
        // people -- but it is still two rows, because they are two populations. Merging
        // them would be a translation decision, and an aggregation may not make one.
        var flexible = words.Where(w => w.Word == "flexible").ToList();
        Assert.Equal(2, flexible.Count);
        Assert.Equal(["en", "es"], flexible.Select(w => w.Language).Order());
        Assert.All(flexible, w => Assert.Equal(3, w.Count));
    }

    /// <summary>
    /// A word cloud leaks by distinctiveness, not by group size: "my visa renewal" names
    /// its author to anyone who knows the team. Words appearing in a single response are
    /// withheld -- and counted, so a reader can tell "nobody else wrote anything" from
    /// "something was withheld".
    /// </summary>
    [Fact]
    public void A_word_written_by_only_one_respondent_is_withheld_and_counted()
    {
        var question = Choice(type: QuestionTypes.OpenEnded);
        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, Stored("visa renewal"), null),
            new(ResponseId(2), QuestionId, Stored("pay"), null),
            new(ResponseId(3), QuestionId, Stored("pay"), null),
            new(ResponseId(4), QuestionId, Stored("pay"), null),
            new(ResponseId(5), QuestionId, Stored("pay"), null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        Assert.Equal(["pay"], result.Words.Select(w => w.Word));
        Assert.DoesNotContain(result.Words, w => w.Word == "visa");
        Assert.Equal(2, result.SuppressedWordCount);
    }

    /// <summary>Verbatim free text is never returned by this surface -- only counts.</summary>
    [Fact]
    public void Open_text_returns_no_verbatim_answers()
    {
        var question = Choice(type: QuestionTypes.OpenEnded);
        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("the pay is unfair"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        Assert.Empty(result.Distribution);
        Assert.All(result.Words, w => Assert.DoesNotContain(' ', w.Word));
    }

    // ==================================================================
    // Small-group disclosure control
    // ==================================================================

    /// <summary>
    /// Below the survey floor a per-question distribution is close to a verbatim readout:
    /// an admin who knows who was invited can line four answers up against four people.
    /// </summary>
    [Fact]
    public void Below_the_survey_floor_nothing_per_question_is_returned()
    {
        var question = Choice(options: [new AggregationOption(0, "remote", "Remote")]);
        var responses = Enumerable
            .Range(1, SurveyResultsPrivacy.MinimumRespondents - 1)
            .Select(n => Response(ResponseId(n)))
            .ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], targetAudienceCount: 40);

        Assert.True(aggregate.IsSuppressed);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, aggregate.SuppressionReason);
        Assert.Empty(aggregate.Questions);
        Assert.Empty(aggregate.Breakdowns);
    }

    /// <summary>
    /// The counters survive the floor. "4 of 40 so far" identifies nobody and is exactly
    /// the number that tells an admin whether to keep chasing responses.
    /// </summary>
    [Fact]
    public void Participation_counters_are_returned_even_below_the_survey_floor()
    {
        var responses = Enumerable
            .Range(1, SurveyResultsPrivacy.MinimumRespondents - 1)
            .Select(n => Response(ResponseId(n)))
            .ToList();

        var aggregate = SurveyAggregation.Compute([], responses, [], [], targetAudienceCount: 40);

        Assert.True(aggregate.IsSuppressed);
        Assert.Equal(4, aggregate.Summary.CompletedCount);
        Assert.Equal(40, aggregate.Summary.InvitedCount);
        Assert.Equal(10d, aggregate.Summary.ParticipationRate);
    }

    [Fact]
    public void At_the_survey_floor_results_are_returned()
    {
        var question = Choice(options: [new AggregationOption(0, "remote", "Remote")]);
        var responses = Enumerable
            .Range(1, SurveyResultsPrivacy.MinimumRespondents)
            .Select(n => Response(ResponseId(n)))
            .ToList();
        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        Assert.False(aggregate.IsSuppressed);
        Assert.Null(aggregate.SuppressionReason);
        Assert.Single(aggregate.Questions);
    }

    /// <summary>
    /// The disclosure surface that matters. A department of one means every answer
    /// attributed to it is one named person's answers.
    /// </summary>
    [Fact]
    public void A_department_below_the_segment_floor_is_suppressed_and_its_headcount_reported()
    {
        var question = Choice(options: [new AggregationOption(0, "remote", "Remote")]);

        // Five in Sales (at the floor), two in Engineering (below it).
        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), departmentId: Sales),
            Response(ResponseId(2), departmentId: Sales),
            Response(ResponseId(3), departmentId: Sales),
            Response(ResponseId(4), departmentId: Sales),
            Response(ResponseId(5), departmentId: Sales),
            Response(ResponseId(6), departmentId: Engineering),
            Response(ResponseId(7), departmentId: Engineering),
        };

        var answers = responses
            .Select(r => new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null))
            .ToList();

        var departments = new List<AggregationDepartment>
        {
            new(Sales, "Sales", 10),
            new(Engineering, "Engineering", 4),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, departments, null);
        var breakdown = aggregate.Breakdowns.Single(b => b.Dimension == "department");

        var engineering = breakdown.Segments.Single(s => s.Key == Engineering.ToString());
        Assert.True(engineering.IsSuppressed);
        Assert.Equal(0, engineering.RespondentCount);
        Assert.Empty(engineering.Questions);

        var sales = breakdown.Segments.Single(s => s.Key == Sales.ToString());
        Assert.False(sales.IsSuppressed);
        Assert.Equal(5, sales.RespondentCount);
        Assert.Equal(50d, sales.ParticipationRate);

        Assert.Equal(1, breakdown.SuppressedSegmentCount);
        Assert.Equal(2, breakdown.SuppressedRespondentCount);
    }

    /// <summary>
    /// Withheld counts exist so totals still reconcile. Kept + withheld + unsegmented must
    /// equal the completed count, or a reader silently loses people and cannot tell.
    /// </summary>
    [Fact]
    public void Kept_withheld_and_unsegmented_reconcile_against_the_completed_count()
    {
        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), departmentId: Sales),
            Response(ResponseId(2), departmentId: Sales),
            Response(ResponseId(3), departmentId: Sales),
            Response(ResponseId(4), departmentId: Sales),
            Response(ResponseId(5), departmentId: Sales),
            Response(ResponseId(6), departmentId: Engineering),
            Response(ResponseId(7), departmentId: Engineering),
            Response(ResponseId(8)), // anonymous: department stripped at write time by #118
        };

        var departments = new List<AggregationDepartment> { new(Sales, "Sales", 10), new(Engineering, "Engineering", 4) };
        var aggregate = SurveyAggregation.Compute([], responses, [], departments, null);
        var breakdown = aggregate.Breakdowns.Single(b => b.Dimension == "department");

        var kept = breakdown.Segments.Where(s => !s.IsSuppressed).Sum(s => s.RespondentCount);
        Assert.Equal(
            aggregate.Summary.CompletedCount,
            kept + breakdown.SuppressedRespondentCount + breakdown.UnsegmentedRespondentCount);
        Assert.Equal(1, breakdown.UnsegmentedRespondentCount);
    }

    /// <summary>
    /// The cross-tab that actually leaks. "Engineering + 10+ years" is one person in most
    /// companies, and unlike a user id nothing about it looks like an identifier.
    /// </summary>
    [Fact]
    public void A_demographic_segment_below_the_floor_is_suppressed()
    {
        static Dictionary<string, string> Tenure(string value)
            => new(StringComparer.Ordinal) { ["tenure"] = JsonSerializer.Serialize(value) };

        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), demographics: Tenure("1-2")),
            Response(ResponseId(2), demographics: Tenure("1-2")),
            Response(ResponseId(3), demographics: Tenure("1-2")),
            Response(ResponseId(4), demographics: Tenure("1-2")),
            Response(ResponseId(5), demographics: Tenure("1-2")),
            Response(ResponseId(6), demographics: Tenure("10+")),
        };

        var aggregate = SurveyAggregation.Compute([], responses, [], [], null);
        var breakdown = aggregate.Breakdowns.Single(b => b.Dimension == "tenure");

        var lone = breakdown.Segments.Single(s => s.Key == "10+");
        Assert.True(lone.IsSuppressed);
        Assert.Equal(0, lone.RespondentCount);

        var band = breakdown.Segments.Single(s => s.Key == "1-2");
        Assert.False(band.IsSuppressed);
        Assert.Equal(5, band.RespondentCount);

        Assert.Equal(1, breakdown.SuppressedSegmentCount);
        Assert.Equal(1, breakdown.SuppressedRespondentCount);
    }

    /// <summary>
    /// Demographic values are the stable locale-independent ones, decoded from jsonb. A
    /// bare quote surviving into the key would make "es"-served and "en"-served responses
    /// group apart, which is the same failure as grouping options on their labels.
    /// </summary>
    [Fact]
    public void Demographic_group_keys_are_decoded_from_jsonb()
    {
        var demographics = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["department_label"] = JsonSerializer.Serialize("sales"),
        };

        var responses = Enumerable
            .Range(1, 5)
            .Select(n => Response(ResponseId(n), demographics: demographics))
            .ToList();

        var aggregate = SurveyAggregation.Compute([], responses, [], [], null);
        var breakdown = aggregate.Breakdowns.Single(b => b.Dimension == "department_label");

        var segment = Assert.Single(breakdown.Segments);
        Assert.Equal("sales", segment.Key);
        Assert.DoesNotContain('"', segment.Key);
    }

    /// <summary>
    /// Deliberately NOT suppressed: a bucket of one inside a whole-survey distribution.
    /// Once the survey is over the floor, "one person strongly disagreed" says nothing
    /// about WHICH respondent, and deleting it deletes the single dissenting voice an
    /// honest climate survey exists to surface.
    /// </summary>
    [Fact]
    public void A_lone_dissenting_answer_survives_in_a_whole_survey_distribution()
    {
        var question = Choice(type: QuestionTypes.Likert, options:
        [
            new AggregationOption(0, "1", "Strongly disagree"),
            new AggregationOption(1, "5", "Strongly agree"),
        ]);

        var responses = Enumerable.Range(1, 6).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .Select((r, i) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(i == 0 ? "1" : "5"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        var dissent = result.Distribution.Single(b => b.Value == "1");
        Assert.Equal(1, dissent.Count);
    }

    // ==================================================================
    // Completion, ranking and numeric stats
    // ==================================================================

    /// <summary>
    /// Partial responses are counted but do not vote. Including them makes a published
    /// percentage move backwards between two polls, which reads as a bug in the numbers.
    /// </summary>
    [Fact]
    public void Partial_responses_are_counted_but_do_not_reach_a_distribution()
    {
        var question = Choice(options:
        [
            new AggregationOption(0, "remote", "Remote"),
            new AggregationOption(1, "office", "Office"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        responses.Add(Response(ResponseId(6), isComplete: false));

        var answers = responses
            .Select(r => new AggregationAnswer(
                r.ResponseId, QuestionId, Stored(r.IsComplete ? "remote" : "office"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);

        Assert.Equal(6, aggregate.Summary.ResponseCount);
        Assert.Equal(5, aggregate.Summary.CompletedCount);
        Assert.Equal(1, aggregate.Summary.PartialCount);

        var bucket = Assert.Single(Assert.Single(aggregate.Questions).Distribution);
        Assert.Equal("remote", bucket.Value);
        Assert.Equal(5, bucket.Count);
    }

    [Fact]
    public void Responses_are_counted_per_language()
    {
        var responses = new List<AggregationResponse>
        {
            Response(ResponseId(1), "es"),
            Response(ResponseId(2), "es"),
            Response(ResponseId(3), "en"),
        };

        var aggregate = SurveyAggregation.Compute([], responses, [], [], null);

        Assert.Equal(2, aggregate.Summary.ByLanguage.Single(l => l.Language == "es").Count);
        Assert.Equal(1, aggregate.Summary.ByLanguage.Single(l => l.Language == "en").Count);
    }

    /// <summary>
    /// A ranking groups on the same stable option value as everything else. Count is
    /// first-place votes; AverageRank is the mean 1-based position, which is the number
    /// that actually orders the options.
    /// </summary>
    [Fact]
    public void A_ranking_counts_first_places_and_averages_positions()
    {
        var question = Choice(type: QuestionTypes.Ranking, options:
        [
            new AggregationOption(0, "pay", "Pay"),
            new AggregationOption(1, "flexibility", "Flexibility"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = new List<AggregationAnswer>
        {
            new(ResponseId(1), QuestionId, StoredOrdered("pay", "flexibility"), null),
            new(ResponseId(2), QuestionId, StoredOrdered("pay", "flexibility"), null),
            new(ResponseId(3), QuestionId, StoredOrdered("pay", "flexibility"), null),
            new(ResponseId(4), QuestionId, StoredOrdered("flexibility", "pay"), null),
            new(ResponseId(5), QuestionId, StoredOrdered("flexibility", "pay"), null),
        };

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        var pay = result.Distribution.Single(b => b.Value == "pay");
        Assert.Equal(3, pay.Count);
        Assert.Equal(1.4d, pay.AverageRank);

        var flexibility = result.Distribution.Single(b => b.Value == "flexibility");
        Assert.Equal(2, flexibility.Count);
        Assert.Equal(1.6d, flexibility.AverageRank);
    }

    [Fact]
    public void A_scale_question_reports_mean_and_median()
    {
        var question = Choice(type: QuestionTypes.Likert, options:
        [
            new AggregationOption(0, "1", "One"),
            new AggregationOption(1, "2", "Two"),
            new AggregationOption(2, "5", "Five"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var values = new[] { "1", "2", "2", "5", "5" };
        var answers = responses
            .Select((r, i) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(values[i]), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        Assert.Equal(3d, result.Average);
        Assert.Equal(2d, result.Median);
    }

    /// <summary>
    /// A multiple_choice question whose stable values happen to be "1".."4" is a set of
    /// CODES. Averaging codes produces a number with no meaning that a chart will
    /// nonetheless plot on an axis.
    /// </summary>
    [Fact]
    public void Numeric_looking_choice_codes_are_never_averaged()
    {
        var question = Choice(type: QuestionTypes.MultipleChoice, options:
        [
            new AggregationOption(0, "1", "Remote"),
            new AggregationOption(1, "4", "Office"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .Select((r, i) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(i < 3 ? "1" : "4"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        Assert.Null(result.Average);
        Assert.Null(result.Median);
        Assert.Equal(2, result.Distribution.Count);
    }

    /// <summary>
    /// One unparseable value makes the mean ABSENT rather than quietly computed over the
    /// subset that happened to parse -- a mean over an unstated denominator is worse than
    /// no mean.
    /// </summary>
    [Fact]
    public void One_unparseable_scale_value_removes_the_mean_entirely()
    {
        var question = Choice(type: QuestionTypes.Likert, options:
        [
            new AggregationOption(0, "1", "One"),
            new AggregationOption(1, "n/a", "Not applicable"),
        ]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .Select((r, i) => new AggregationAnswer(r.ResponseId, QuestionId, Stored(i == 4 ? "n/a" : "1"), null))
            .ToList();

        var aggregate = SurveyAggregation.Compute([question], responses, answers, [], null);
        var result = Assert.Single(aggregate.Questions);

        Assert.Null(result.Average);
        Assert.Equal(5, result.AnsweredCount);
    }

    /// <summary>
    /// Every surface is a presentation over ONE aggregate. This is what makes "results
    /// says 62% and the report says 58%" impossible rather than merely unlikely.
    /// </summary>
    [Fact]
    public void Two_questions_are_ordered_and_summarised_independently()
    {
        var first = Choice(id: QuestionId, options: [new AggregationOption(0, "remote", "Remote")]);
        var second = new AggregationQuestion(
            SecondQuestionId, 1, QuestionTypes.MultipleChoice, "Second", null, null, null,
            [new AggregationOption(0, "yes", "Yes")]);

        var responses = Enumerable.Range(1, 5).Select(n => Response(ResponseId(n))).ToList();
        var answers = responses
            .SelectMany(r => new[]
            {
                new AggregationAnswer(r.ResponseId, QuestionId, Stored("remote"), null),
                new AggregationAnswer(r.ResponseId, SecondQuestionId, Stored("yes"), null),
            })
            .ToList();

        var aggregate = SurveyAggregation.Compute([second, first], responses, answers, [], null);

        Assert.Equal([QuestionId, SecondQuestionId], aggregate.Questions.Select(q => q.QuestionId));
        Assert.All(aggregate.Questions, q => Assert.Equal(5, q.AnsweredCount));
    }
}
