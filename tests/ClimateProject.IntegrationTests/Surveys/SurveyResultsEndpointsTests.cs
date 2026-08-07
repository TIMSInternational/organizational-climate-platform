using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// End-to-end cover for <c>/results</c>, <c>/statistics</c>, <c>/analytics</c> and
/// <c>/real-time-stats</c>.
///
/// The aggregation itself is proved in <c>SurveyAggregationTests</c> without Docker --
/// it is a pure function, so nothing about grouping, suppression or averaging needs a
/// database. What genuinely needs Postgres, and is therefore what lives here, is the
/// part the unit tests structurally cannot reach: that <c>response_value</c> really is
/// jsonb and round-trips through Npgsql, that the four routes really are four
/// presentations of one aggregate, and that a CompanyAdmin really is refused another
/// tenant's results.
/// </summary>
[Collection("Postgres")]
public class SurveyResultsEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;
    private Guid _salesId;

    public SurveyResultsEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"res-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        _companyAId = await _harness.SeedCompanyAsync("Results Co A");
        _companyBId = await _harness.SeedCompanyAsync("Results Co B");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyAId, "Engineering");
        _salesId = await _harness.SeedDepartmentAsync(_companyAId, "Sales");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    private Task<HttpClient> AdminBAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);

    private Task<HttpClient> SuperAdminAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    /// <summary>
    /// A bilingual survey with one choice question. The option labels differ per locale
    /// and the option VALUES do not -- which is the whole point of the fixture.
    /// </summary>
    private async Task<SurveyDetail> SeedBilingualSurveyAsync()
    {
        var client = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            title: SurveyTestHarness.Both("Q3 Climate", "Clima Q3"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("Where do you work?", "¿Dónde trabajas?"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("remote", SurveyTestHarness.Both("Remote", "Remoto")),
                        new CreateSurveyQuestionOptionInput("office", SurveyTestHarness.Both("Office", "Oficina")),
                    ],
                    Order: 0),
            ]));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);
        return survey;
    }

    /// <summary>
    /// Writes one complete response with one answer. <paramref name="optionValue"/> is
    /// stored the way <c>question_responses.response_value</c> requires: as a serialised
    /// JSON string. The column is jsonb, and a bare <c>remote</c> is not valid JSON --
    /// Postgres rejects it with 22P02.
    /// </summary>
    private Task<Guid> SeedAnswerAsync(
        Guid surveyId,
        Guid questionId,
        string optionValue,
        string language,
        Guid? departmentId = null,
        string? openText = null,
        IReadOnlyDictionary<string, string>? demographics = null)
        => _harness.WithDbAsync(async db =>
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = surveyId,
                CompanyId = _companyAId,
                UserId = null,
                DepartmentId = departmentId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = language,
                IsComplete = true,
                IsAnonymous = true,
                StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                CompletionTime = DateTimeOffset.UtcNow,
                TotalTimeSeconds = 300,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            db.QuestionResponses.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = questionId,
                ResponseValue = JsonSerializer.Serialize(openText ?? optionValue),
                ResponseText = null,
            });

            foreach (var (field, value) in demographics ?? new Dictionary<string, string>())
            {
                // response_demographics.value is jsonb too, same rule.
                db.ResponseDemographics.Add(new ResponseDemographic
                {
                    ResponseId = responseId,
                    Field = field,
                    Value = JsonSerializer.Serialize(value),
                });
            }

            await db.SaveChangesAsync();
            return responseId;
        });

    private static Guid QuestionIdOf(SurveyDetail survey) => survey.Questions.Single().Id;

    // ==================================================================
    // THE PROPERTY THIS LANE OWNS, end to end
    // ==================================================================

    /// <summary>
    /// The headline requirement, through the real jsonb column and the real endpoint:
    /// respondents reading different locales who pick the same option produce ONE bucket.
    ///
    /// The unit test proves the grouping logic; this proves the plumbing around it --
    /// that the stable value survives the jsonb round trip and that the resolved label
    /// attached afterwards does not become the key.
    /// </summary>
    [Fact]
    public async Task Respondents_in_two_locales_who_pick_the_same_option_form_one_bucket()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);

        // Three English readers and two Spanish readers, all choosing "remote".
        for (var i = 0; i < 3; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en");
        }

        for (var i = 0; i < 2; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "es");
        }

        var client = await AdminAAsync();
        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results?lang=en");

        Assert.False(results!.IsSuppressed);
        var question = Assert.Single(results.Questions);
        var bucket = Assert.Single(question.Distribution);
        Assert.Equal("remote", bucket.Value);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(100d, bucket.Percentage);

        // The label is display only, resolved for the request locale.
        Assert.Equal("Remote", bucket.Label);
    }

    /// <summary>
    /// The same responses read in Spanish: the same single bucket with the same key and
    /// count, only the label changes. A distribution that changed shape with the reader's
    /// language would make every chart and export locale-dependent.
    /// </summary>
    [Fact]
    public async Task The_same_bucket_is_returned_whichever_locale_reads_it()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 3; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en");
        }

        for (var i = 0; i < 2; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "office", "es");
        }

        var client = await AdminAAsync();
        var english = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results?lang=en");
        var spanish = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results?lang=es");

        var englishBuckets = english!.Questions.Single().Distribution;
        var spanishBuckets = spanish!.Questions.Single().Distribution;

        Assert.Equal(
            englishBuckets.Select(b => (b.Value, b.Count)),
            spanishBuckets.Select(b => (b.Value, b.Count)));

        Assert.Equal(["Remote", "Office"], englishBuckets.Select(b => b.Label));
        Assert.Equal(["Remoto", "Oficina"], spanishBuckets.Select(b => b.Label));
    }

    /// <summary>
    /// ResolvedLocale names the language the caller is actually READING, not the one they
    /// asked for. A Spanish-only survey fetched with <c>?lang=en</c> comes back in
    /// Spanish and must say so -- reporting "en" is the silent substitution #195 forbids,
    /// and is the exact bug that shipped in #104 and was caught.
    /// </summary>
    [Fact]
    public async Task A_spanish_only_survey_read_as_english_reports_the_locale_it_is_actually_in()
    {
        var client = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            title: LocalizedInput.FromBare("Clima Q3"),
            language: "es"));

        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results?lang=en");

        Assert.Equal("es", results!.ResolvedLocale);
        Assert.Equal("Clima Q3", results.Title);
    }

    // ==================================================================
    // Open text bucketed by Response.Language
    // ==================================================================

    /// <summary>
    /// The live defect <c>Response.Language</c> exists for: without bucketing, a word
    /// cloud counts "trabajo" and "work" as unrelated entries.
    /// </summary>
    [Fact]
    public async Task Open_text_word_frequencies_are_bucketed_by_response_language()
    {
        var client = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("What would you change?", "¿Qué cambiarías?"),
                    "open_ended",
                    Order: 0),
            ]));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 3; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, string.Empty, "es", openText: "trabajo flexible");
        }

        for (var i = 0; i < 3; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, string.Empty, "en", openText: "work flexible");
        }

        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results");
        var question = Assert.Single(results!.Questions);

        Assert.Equal(3, question.Words.Single(w => w.Language == "es" && w.Word == "trabajo").Count);
        Assert.Equal(3, question.Words.Single(w => w.Language == "en" && w.Word == "work").Count);

        // Spelled identically in both languages, still two rows: two populations.
        Assert.Equal(2, question.Words.Count(w => w.Word == "flexible"));

        // Verbatim free text never leaves this surface.
        Assert.Empty(question.Distribution);
        Assert.All(question.Words, w => Assert.DoesNotContain(' ', w.Word));
    }

    // ==================================================================
    // Small-group disclosure
    // ==================================================================

    /// <summary>
    /// Below the survey floor no per-question result is returned at all -- but the
    /// participation counters are, because "4 of 40 so far" identifies nobody and is the
    /// number that tells an admin whether to keep chasing.
    /// </summary>
    [Fact]
    public async Task Below_the_survey_floor_only_counters_are_returned()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < SurveyResultsPrivacy.MinimumRespondents - 1; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en");
        }

        var client = await AdminAAsync();
        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results");

        Assert.True(results!.IsSuppressed);
        Assert.Equal(SurveyResultsPrivacy.BelowMinimumRespondents, results.SuppressionReason);
        Assert.Empty(results.Questions);
        Assert.Equal(4, results.Summary.CompletedCount);
    }

    /// <summary>
    /// A department below the segment floor is withheld, and its headcount is reported so
    /// the breakdown still reconciles against the completed count rather than appearing
    /// to lose people.
    /// </summary>
    [Fact]
    public async Task A_department_below_the_segment_floor_is_withheld_and_counted()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);

        for (var i = 0; i < 5; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en", departmentId: _salesId);
        }

        for (var i = 0; i < 2; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "office", "en", departmentId: _engineeringId);
        }

        var client = await AdminAAsync();
        var stats = await client.GetFromJsonAsync<SurveyStatisticsResponse>($"/surveys/{survey.Id}/statistics");

        var breakdown = stats!.Breakdowns.Single(b => b.Dimension == "department");
        var engineering = breakdown.Segments.Single(s => s.Key == _engineeringId.ToString());
        Assert.True(engineering.IsSuppressed);
        Assert.Equal(0, engineering.RespondentCount);
        Assert.Empty(engineering.Questions);

        Assert.Equal(1, breakdown.SuppressedSegmentCount);
        Assert.Equal(2, breakdown.SuppressedRespondentCount);

        var kept = breakdown.Segments.Where(s => !s.IsSuppressed).Sum(s => s.RespondentCount);
        Assert.Equal(
            stats.Summary.CompletedCount,
            kept + breakdown.SuppressedRespondentCount + breakdown.UnsegmentedRespondentCount);
    }

    /// <summary>
    /// Demographic cross-tabs are the surface that actually leaks: "Engineering + 10+
    /// years" is one person in most companies. The lone band must not be rendered.
    /// </summary>
    [Fact]
    public async Task A_demographic_segment_of_one_is_never_rendered()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);

        for (var i = 0; i < 5; i++)
        {
            await SeedAnswerAsync(
                survey.Id, questionId, "remote", "en",
                demographics: new Dictionary<string, string> { ["tenure"] = "1-2" });
        }

        await SeedAnswerAsync(
            survey.Id, questionId, "office", "en",
            demographics: new Dictionary<string, string> { ["tenure"] = "10+" });

        var client = await AdminAAsync();
        var stats = await client.GetFromJsonAsync<SurveyStatisticsResponse>($"/surveys/{survey.Id}/statistics");

        var breakdown = stats!.Breakdowns.Single(b => b.Dimension == "tenure");
        var lone = breakdown.Segments.Single(s => s.Key == "10+");
        Assert.True(lone.IsSuppressed);
        Assert.Equal(0, lone.RespondentCount);
        Assert.Empty(lone.Questions);

        // Decoded from jsonb: the key is the stable value, not a quoted payload.
        Assert.DoesNotContain(breakdown.Segments, s => s.Key.Contains('"'));
    }

    // ==================================================================
    // One aggregation, four presentations
    // ==================================================================

    /// <summary>
    /// The boundary settled with #88: every surface is a presentation over one
    /// aggregate. This is what makes "results says 62% and analytics says 58%"
    /// impossible rather than merely unlikely.
    /// </summary>
    [Fact]
    public async Task Results_statistics_and_analytics_agree_because_they_are_one_aggregation()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 6; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, i < 4 ? "remote" : "office", "en", departmentId: _salesId);
        }

        var client = await AdminAAsync();
        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results");
        var stats = await client.GetFromJsonAsync<SurveyStatisticsResponse>($"/surveys/{survey.Id}/statistics");
        var analytics = await client.GetFromJsonAsync<SurveyAnalyticsResponse>($"/surveys/{survey.Id}/analytics");

        Assert.Equal(results!.Summary.CompletedCount, stats!.Summary.CompletedCount);
        Assert.Equal(results.Summary.CompletedCount, analytics!.Summary.CompletedCount);
        Assert.Equal(results.Summary.ParticipationRate, analytics.Summary.ParticipationRate);

        Assert.Equal(
            results.Questions.Select(q => (q.QuestionId, q.AnsweredCount)),
            analytics.Questions.Select(q => (q.QuestionId, q.AnsweredCount)));

        Assert.Equal(
            stats.Breakdowns.Select(b => (b.Dimension, b.Segments.Count)),
            analytics.Breakdowns.Select(b => (b.Dimension, b.Segments.Count)));
    }

    // ==================================================================
    // Real-time stats
    // ==================================================================

    /// <summary>
    /// The poll endpoint returns counters and a server-chosen cadence, and never touches
    /// <c>question_responses</c>. Its cost is constant in the number of questions and
    /// options -- which is the reason it is a separate route rather than <c>/results</c>
    /// fetched repeatedly.
    /// </summary>
    [Fact]
    public async Task Real_time_stats_returns_counters_and_a_poll_interval()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 5; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en", departmentId: _salesId);
        }

        var client = await AdminAAsync();
        var live = await client.GetFromJsonAsync<SurveyRealTimeStatsResponse>($"/surveys/{survey.Id}/real-time-stats");

        Assert.Equal(SurveyStatuses.Active, live!.Status);
        Assert.True(live.IsLive);
        Assert.Equal(5, live.CompletedCount);
        Assert.Equal(5, live.ResponseCount);
        Assert.Equal(0, live.InProgressCount);
        Assert.True(live.PollIntervalSeconds > 0);

        var sales = Assert.Single(live.ByDepartment);
        Assert.Equal(_salesId, sales.DepartmentId);
        Assert.Equal(5, sales.CompletedCount);
    }

    /// <summary>
    /// A live dashboard is a WIDER audience than a report, not a narrower one.
    /// Suppressing a two-person department on <c>/statistics</c> and not here would
    /// defeat both.
    /// </summary>
    [Fact]
    public async Task Real_time_stats_applies_the_same_segment_floor()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 2; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en", departmentId: _engineeringId);
        }

        var client = await AdminAAsync();
        var live = await client.GetFromJsonAsync<SurveyRealTimeStatsResponse>($"/surveys/{survey.Id}/real-time-stats");

        Assert.Empty(live!.ByDepartment);
        Assert.Equal(1, live.SuppressedDepartmentCount);
        Assert.Equal(2, live.SuppressedRespondentCount);
        Assert.Equal(2, live.CompletedCount);
    }

    /// <summary>
    /// Once the survey stops accepting responses the client is told to stop polling,
    /// rather than being left asking a closed survey forever.
    /// </summary>
    [Fact]
    public async Task Real_time_stats_reports_a_closed_survey_as_not_live()
    {
        var survey = await SeedBilingualSurveyAsync();
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);

        var client = await AdminAAsync();
        var live = await client.GetFromJsonAsync<SurveyRealTimeStatsResponse>($"/surveys/{survey.Id}/real-time-stats");

        Assert.False(live!.IsLive);
    }

    /// <summary>
    /// Partial responses are counted as in-progress but do not vote -- including them in
    /// a distribution makes a published percentage move backwards between two polls.
    /// </summary>
    [Fact]
    public async Task Partial_responses_count_as_in_progress_but_do_not_vote()
    {
        var survey = await SeedBilingualSurveyAsync();
        var questionId = QuestionIdOf(survey);
        for (var i = 0; i < 5; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, "remote", "en");
        }

        await _harness.WithDbAsync(async db =>
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = survey.Id,
                CompanyId = _companyAId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "en",
                IsComplete = false,
                IsAnonymous = true,
                StartTime = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            db.QuestionResponses.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = questionId,
                ResponseValue = JsonSerializer.Serialize("office"),
            });
            await db.SaveChangesAsync();
        });

        var client = await AdminAAsync();
        var live = await client.GetFromJsonAsync<SurveyRealTimeStatsResponse>($"/surveys/{survey.Id}/real-time-stats");
        Assert.Equal(1, live!.InProgressCount);
        Assert.Equal(5, live.CompletedCount);
        Assert.Equal(6, live.ResponseCount);

        var results = await client.GetFromJsonAsync<SurveyResultsResponse>($"/surveys/{survey.Id}/results");
        var bucket = Assert.Single(results!.Questions.Single().Distribution);
        Assert.Equal("remote", bucket.Value);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(1, results.Summary.PartialCount);
    }

    // ==================================================================
    // Multi-tenancy
    // ==================================================================

    [Theory]
    [InlineData("results")]
    [InlineData("statistics")]
    [InlineData("analytics")]
    [InlineData("real-time-stats")]
    public async Task A_company_admin_is_denied_another_tenants_results(string route)
    {
        var survey = await SeedBilingualSurveyAsync();

        var intruder = await AdminBAsync();
        var response = await intruder.GetAsync($"/surveys/{survey.Id}/{route}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("results")]
    [InlineData("statistics")]
    [InlineData("analytics")]
    [InlineData("real-time-stats")]
    public async Task A_super_admin_reads_any_tenants_results(string route)
    {
        var survey = await SeedBilingualSurveyAsync();

        var client = await SuperAdminAsync();
        var response = await client.GetAsync($"/surveys/{survey.Id}/{route}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("results")]
    [InlineData("statistics")]
    [InlineData("analytics")]
    [InlineData("real-time-stats")]
    public async Task An_unknown_survey_is_a_404(string route)
    {
        var client = await AdminAAsync();
        var response = await client.GetAsync($"/surveys/{Guid.NewGuid()}/{route}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("results")]
    [InlineData("statistics")]
    [InlineData("analytics")]
    [InlineData("real-time-stats")]
    public async Task Anonymous_callers_are_refused(string route)
    {
        var survey = await SeedBilingualSurveyAsync();

        var client = _factory.CreateClient();
        var response = await client.GetAsync($"/surveys/{survey.Id}/{route}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
