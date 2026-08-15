using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// #106 over the wire: version snapshots taken at publish, and the survey-domain audit
/// trail.
///
/// The acceptance criterion these tests exist for is not "a row was written". It is that
/// <b>every response is resolvable to the exact question wording it answered</b>. That
/// property is the conjunction of three things, and each is asserted here against a real
/// response row rather than against a counter:
/// <list type="number">
/// <item>a snapshot exists before any response can arrive (publish is the only way into a
/// status that collects, and publish snapshots);</item>
/// <item>the content cannot move afterwards (no edit, and no path back to a status where
/// one would be allowed);</item>
/// <item>the snapshot keeps the stable option value that the stored answer joins on.</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class SurveyVersionHistoryTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public SurveyVersionHistoryTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"vers-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Versioning Co");
        _otherCompanyId = await _harness.SeedCompanyAsync("Other Co");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>A survey whose one question has stable-valued options -- the join key a stored answer carries.</summary>
    private static CreateSurveyRequest WithOptions(Guid companyId, string questionText = "How supported do you feel?")
        => SurveyTestHarness.MinimalRequest(
            companyId,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare(questionText),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("very", LocalizedInput.FromBare("Very supported")),
                        new CreateSurveyQuestionOptionInput("not_at_all", LocalizedInput.FromBare("Not at all")),
                    ],
                    Order: 0),
            ]);

    private static async Task<SurveyVersionListResponse> ListVersionsAsync(HttpClient client, Guid surveyId, string? lang = null)
    {
        var suffix = lang is null ? string.Empty : $"?lang={lang}";
        var response = await client.GetAsync($"/surveys/{surveyId}/versions{suffix}");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyVersionListResponse>())!;
    }

    private static async Task<SurveyHistoryResponse> HistoryAsync(HttpClient client, Guid surveyId, string? action = null)
    {
        var suffix = action is null ? string.Empty : $"?action={action}";
        var response = await client.GetAsync($"/surveys/{surveyId}/history{suffix}");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyHistoryResponse>())!;
    }

    // ------------------------------------------------------------------
    // Snapshots are taken at publish
    // ------------------------------------------------------------------

    [Fact]
    public async Task Publishing_snapshots_version_one_and_points_the_survey_at_it()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        // A draft that has never been published has no snapshots: its version number is
        // what the NEXT publish will be, not a row that exists.
        var beforePublish = await ListVersionsAsync(client, survey.Id);
        Assert.Empty(beforePublish.Versions);
        Assert.Equal(1, beforePublish.CurrentVersion);

        var published = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        Assert.Equal(1, (await published.Content.ReadFromJsonAsync<SurveyDetail>())!.Version);

        var versions = await ListVersionsAsync(client, survey.Id);
        var version = Assert.Single(versions.Versions);
        Assert.Equal(1, version.VersionNumber);
        Assert.Equal(SurveyVersionReasons.Publish, version.Reason);
        Assert.Empty(version.Changes);
        Assert.True(version.IsCurrent);
        Assert.False(version.CollectedResponses);
        Assert.Equal(1, version.QuestionCount);
    }

    [Fact]
    public async Task Scheduled_to_active_does_not_snapshot_a_second_time()
    {
        // The gate already ran on the way into scheduled and content has been frozen ever
        // since, so a second row would be a duplicate of the first with a later timestamp.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled);
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        Assert.Single((await ListVersionsAsync(client, survey.Id)).Versions);
    }

    [Fact]
    public async Task Re_publishing_after_an_edit_snapshots_version_two_naming_what_changed()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled);

        // scheduled -> draft is the ONE sanctioned route back, and it is safe precisely
        // because a scheduled survey has no responses yet.
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);

        var edit = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Q3 Climate Survey (revised)")));
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var versions = await ListVersionsAsync(client, survey.Id);
        Assert.Equal(2, versions.CurrentVersion);
        Assert.Equal([2, 1], versions.Versions.Select(v => v.VersionNumber));

        var latest = versions.Versions[0];
        Assert.Equal(SurveyVersionReasons.Republish, latest.Reason);
        Assert.Equal(["title"], latest.Changes);
        Assert.True(latest.IsCurrent);
        Assert.False(versions.Versions[1].IsCurrent);
    }

    [Fact]
    public async Task A_publish_that_the_translation_gate_rejects_snapshots_nothing()
    {
        // The snapshot is taken AFTER the gate. A version row for content that never became
        // visible would be a history of something that did not happen.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(
                _companyId,
                title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
                language: ContentLanguages.Both));

        // Clearing one half of a pair is an explicit empty string, and it is savable --
        // a half-translated draft must be savable in order to translate the other half.
        var untranslate = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["es"] = "" })));
        Assert.Equal(HttpStatusCode.OK, untranslate.StatusCode);

        var publish = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);
        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);

        Assert.Empty((await ListVersionsAsync(client, survey.Id)).Versions);
    }

    // ------------------------------------------------------------------
    // THE PROPERTY: content cannot move under a response
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_response_resolves_to_the_exact_wording_it_answered()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId, "How supported do you feel?"));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var questionId = survey.Questions[0].Id;
        await _harness.SeedResponseAsync(survey.Id, _companyId, userId: null);

        // Stored exactly as a respond endpoint would: the option's STABLE VALUE, serialised
        // as JSON because question_responses.response_value is jsonb and a bare token is
        // not valid JSON (Postgres 22P02).
        await _harness.WithDbAsync(async db =>
        {
            var responseId = await db.Responses.Where(r => r.SurveyId == survey.Id).Select(r => r.Id).FirstAsync();
            db.QuestionResponses.Add(new Domain.Entities.QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = questionId,
                ResponseValue = JsonSerializer.Serialize("very"),
            });
            await db.SaveChangesAsync();
        });

        var reloaded = await ListVersionsAsync(client, survey.Id);
        var summary = Assert.Single(reloaded.Versions);
        Assert.True(summary.CollectedResponses);

        // survey.Version -> that version's snapshot -> the wording. This is the whole
        // resolution path, and it is single-valued because content froze at publish.
        var detailResponse = await client.GetAsync($"/surveys/{survey.Id}/versions/{summary.Id}");
        detailResponse.EnsureSuccessStatusCode();
        var detail = (await detailResponse.Content.ReadFromJsonAsync<SurveyVersionDetail>())!;

        Assert.Equal(reloaded.CurrentVersion, detail.VersionNumber);
        var question = Assert.Single(detail.Questions);
        Assert.Equal(questionId, question.Id);
        Assert.Equal("How supported do you feel?", question.Text);

        var answered = Assert.Single(question.Options!, o => o.Value == "very");
        Assert.Equal("Very supported", answered.Label);
    }

    [Fact]
    public async Task Once_a_response_exists_the_content_cannot_move_and_no_new_version_appears()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);
        await _harness.SeedResponseAsync(survey.Id, _companyId, userId: null);

        var edit = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Rewritten after the fact")));
        Assert.Equal(HttpStatusCode.Conflict, edit.StatusCode);

        foreach (var target in new[] { SurveyStatuses.Draft, SurveyStatuses.Scheduled })
        {
            var back = await SurveyTestHarness.SetStatusAsync(client, survey.Id, target);
            Assert.Equal(HttpStatusCode.Conflict, back.StatusCode);
        }

        var versions = await ListVersionsAsync(client, survey.Id);
        Assert.Single(versions.Versions);
        Assert.Equal(1, versions.CurrentVersion);

        var detail = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}");
        Assert.Equal("Q3 Climate Survey", detail!.Title);
    }

    [Fact]
    public async Task A_row_whose_status_and_responses_disagree_still_cannot_become_editable()
    {
        // The lifecycle map makes 'draft' unreachable from anything that accepts responses,
        // so this can only arise from a legacy import, a manual UPDATE, or a future edge
        // added to the map. It is the guard that survives someone deciding 'active -> draft'
        // would be convenient.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);
        await _harness.SeedResponseAsync(survey.Id, _companyId, userId: null);
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Scheduled);

        var back = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);

        Assert.Equal(HttpStatusCode.Conflict, back.StatusCode);
        var body = await back.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("responses", body.GetProperty("message").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------
    // Content i18n on the history surface
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_spanish_only_version_read_as_english_comes_back_in_spanish_and_says_so()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(
                _companyId,
                title: LocalizedInput.FromBare("Encuesta de clima"),
                questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("¿Cómo te sientes?"), "open_ended", Order: 0)],
                language: ContentLanguages.Spanish));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var versions = await ListVersionsAsync(client, survey.Id, lang: "en");
        var summary = Assert.Single(versions.Versions);

        // Reporting "en" here would be the silent substitution #195 forbids -- the exact
        // bug that shipped in #104 and was caught.
        Assert.Equal(ContentLanguages.Spanish, summary.ResolvedLocale);
        Assert.Equal("Encuesta de clima", summary.Title);
        Assert.Contains("title", summary.FallbackFields);

        var detail = await client.GetFromJsonAsync<SurveyVersionDetail>($"/surveys/{survey.Id}/versions/{summary.Id}?lang=en");
        Assert.Equal(ContentLanguages.Spanish, detail!.ResolvedLocale);
        Assert.Equal("¿Cómo te sientes?", Assert.Single(detail.Questions).Text);
    }

    [Fact]
    public async Task A_version_keeps_its_own_language_when_the_survey_is_later_re_authored()
    {
        // A survey re-authored from Spanish-only to 'both' must not make its earlier
        // snapshots claim a second translation they never had.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(
                _companyId,
                title: LocalizedInput.FromBare("Encuesta de clima"),
                questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("¿Cómo te sientes?"), "open_ended", Order: 0)],
                language: ContentLanguages.Spanish));

        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled);
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);

        await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Language: ContentLanguages.Both,
            Title: SurveyTestHarness.Both("Climate survey", "Encuesta de clima"),
            Questions: [new CreateSurveyQuestionInput(SurveyTestHarness.Both("How are you?", "¿Cómo te sientes?"), "open_ended", Order: 0)]));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var versions = await ListVersionsAsync(client, survey.Id, lang: "en");

        var first = versions.Versions.Single(v => v.VersionNumber == 1);
        Assert.Equal(ContentLanguages.Spanish, first.Language);
        Assert.Equal(ContentLanguages.Spanish, first.ResolvedLocale);

        var second = versions.Versions.Single(v => v.VersionNumber == 2);
        Assert.Equal(ContentLanguages.Both, second.Language);
        Assert.Equal(ContentLanguages.English, second.ResolvedLocale);
        Assert.Contains("language", second.Changes);
    }

    [Fact]
    public async Task No_version_payload_exposes_an_en_or_es_shaped_field()
    {
        // The load-bearing #195 constraint: a third language must stay one migration
        // instead of a rewrite of every page that renders a survey. Asserted over the raw
        // JSON because the compiler cannot see a leak that the serialiser introduces.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var versions = await ListVersionsAsync(client, survey.Id);
        var versionId = Assert.Single(versions.Versions).Id;

        foreach (var path in new[] { $"/surveys/{survey.Id}/versions", $"/surveys/{survey.Id}/versions/{versionId}" })
        {
            var payload = await client.GetFromJsonAsync<JsonElement>(path);
            AssertNoLocaleShapedProperty(payload, path);
        }
    }

    private static void AssertNoLocaleShapedProperty(JsonElement element, string path)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    Assert.False(
                        property.Name.EndsWith("En", StringComparison.Ordinal)
                        || property.Name.EndsWith("Es", StringComparison.Ordinal),
                        $"{path} exposes '{property.Name}', which is an En/Es-shaped read field.");
                    AssertNoLocaleShapedProperty(property.Value, path);
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    AssertNoLocaleShapedProperty(item, path);
                }

                break;
        }
    }

    // ------------------------------------------------------------------
    // Comparison
    // ------------------------------------------------------------------

    [Fact]
    public async Task Two_versions_compare_to_the_field_paths_that_differ()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled);
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);

        await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("How supported do you feel?"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("very", LocalizedInput.FromBare("Very supported")),
                        new CreateSurveyQuestionOptionInput("somewhat", LocalizedInput.FromBare("Somewhat")),
                        new CreateSurveyQuestionOptionInput("not_at_all", LocalizedInput.FromBare("Not at all")),
                    ],
                    Order: 0),
            ]));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var comparison = await client.GetFromJsonAsync<SurveyVersionComparison>(
            $"/surveys/{survey.Id}/versions/compare?from=1&to=2");

        Assert.Equal(["questions[0].options"], comparison!.Changes);
        Assert.Equal(1, comparison.From.VersionNumber);
        Assert.Equal(2, comparison.To.VersionNumber);
        Assert.Equal(2, comparison.From.Questions[0].Options!.Count);
        Assert.Equal(3, comparison.To.Questions[0].Options!.Count);

        // The stable values survive, which is why answers to version 1 still aggregate
        // with answers to version 2 for the options both versions have.
        Assert.Equal(["very", "not_at_all"], comparison.From.Questions[0].Options!.Select(o => o.Value));
        Assert.Equal(["very", "somewhat", "not_at_all"], comparison.To.Questions[0].Options!.Select(o => o.Value));
    }

    [Theory]
    [InlineData("?from=1", HttpStatusCode.BadRequest)]
    [InlineData("?from=1&to=1", HttpStatusCode.BadRequest)]
    [InlineData("?from=1&to=9", HttpStatusCode.NotFound)]
    public async Task A_malformed_comparison_is_refused(string query, HttpStatusCode expected)
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var response = await client.GetAsync($"/surveys/{survey.Id}/versions/compare{query}");

        Assert.Equal(expected, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Audit history
    // ------------------------------------------------------------------

    [Fact]
    public async Task History_records_the_actor_the_time_and_the_change()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        var history = await HistoryAsync(client, survey.Id);

        Assert.Equal(
            [SurveyAuditActions.Created, SurveyAuditActions.StatusChanged, SurveyAuditActions.VersionCreated],
            history.Entries.Select(e => e.Action).Order());

        // Creation predates the publish. Asserted as an ordering rather than as an exact
        // sequence because version_created and status_changed are written microseconds
        // apart within one request, and a test that depends on which lands first is a test
        // that fails for no reason.
        Assert.True(
            history.Entries.Single(e => e.Action == SurveyAuditActions.Created).Timestamp
            < history.Entries.Single(e => e.Action == SurveyAuditActions.StatusChanged).Timestamp);

        Assert.All(history.Entries, entry =>
        {
            Assert.NotEqual(Guid.Empty, entry.UserId);
            Assert.False(string.IsNullOrWhiteSpace(entry.UserName));
            Assert.False(string.IsNullOrWhiteSpace(entry.UserEmail));
            Assert.Equal(Roles.CompanyAdmin, entry.UserRole);
            Assert.NotEqual(default, entry.Timestamp);
        });

        var statusChange = history.Entries.Single(e => e.Action == SurveyAuditActions.StatusChanged);
        Assert.Equal(SurveyStatuses.Draft, statusChange.Changes!.From);
        Assert.Equal(SurveyStatuses.Active, statusChange.Changes.To);

        var versionCreated = history.Entries.Single(e => e.Action == SurveyAuditActions.VersionCreated);
        Assert.Equal(1, versionCreated.Changes!.VersionNumber);
        Assert.Equal(SurveyAuditEntityTypes.Version, versionCreated.EntityType);
    }

    [Fact]
    public async Task An_update_records_the_fields_that_actually_changed()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Q4 Climate Survey"),
            EndDate: survey.EndDate.AddDays(7)));

        var updated = Assert.Single((await HistoryAsync(client, survey.Id, SurveyAuditActions.Updated)).Entries);

        Assert.Equal(["endDate", "title"], updated.Changes!.Fields!.Order());
    }

    [Fact]
    public async Task A_no_op_update_records_nothing()
    {
        // An audit history full of "nothing changed" entries is a history nobody reads.
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Q3 Climate Survey")));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Empty((await HistoryAsync(client, survey.Id, SurveyAuditActions.Updated)).Entries);
    }

    [Fact]
    public async Task Duplicating_writes_one_entry_on_each_side()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        var duplicate = await client.PostAsJsonAsync($"/surveys/{survey.Id}/duplicate", new DuplicateSurveyRequest());
        duplicate.EnsureSuccessStatusCode();
        var copy = (await duplicate.Content.ReadFromJsonAsync<SurveyDetail>())!;

        var sourceEntry = Assert.Single((await HistoryAsync(client, survey.Id, SurveyAuditActions.Duplicated)).Entries);
        Assert.Equal(copy.Id.ToString(), sourceEntry.EntityId);

        var copyEntry = Assert.Single((await HistoryAsync(client, copy.Id, SurveyAuditActions.Created)).Entries);
        Assert.Equal(survey.Id.ToString(), copyEntry.EntityId);

        // The copy starts its own history at version zero-snapshots, like any other draft.
        Assert.Empty((await ListVersionsAsync(client, copy.Id)).Versions);
    }

    [Fact]
    public async Task A_bulk_action_audits_every_survey_it_touched()
    {
        // Bulk is a loop over the same helper, never a bypass -- including for the audit.
        var client = await AdminAsync();
        var first = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        var second = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        var response = await client.PostAsJsonAsync("/surveys/bulk", new BulkSurveyActionRequest(
            "archive", [first.Id, second.Id]));
        response.EnsureSuccessStatusCode();

        foreach (var id in new[] { first.Id, second.Id })
        {
            var entry = Assert.Single((await HistoryAsync(client, id, SurveyAuditActions.StatusChanged)).Entries);
            Assert.Equal(SurveyStatuses.Draft, entry.Changes!.From);
            Assert.Equal(SurveyStatuses.Archived, entry.Changes.To);
        }
    }

    [Fact]
    public async Task A_historical_entry_keeps_the_actor_name_it_was_written_with_after_a_rename()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        var before = Assert.Single((await HistoryAsync(client, survey.Id, SurveyAuditActions.Created)).Entries);
        Assert.Equal("Test User", before.UserName);

        await _harness.WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == before.UserId);
            user.Name = "Renamed Since";
            await db.SaveChangesAsync();
        });

        var after = Assert.Single((await HistoryAsync(client, survey.Id, SurveyAuditActions.Created)).Entries);

        // The RESTRICT foreign key on user_id stops the actor being deleted out from under
        // the history; it does not stop an UPDATE. The name is copied onto the row, so this
        // also proves the endpoint does not join back to users -- which is the regression
        // that would quietly rewrite every historical entry.
        Assert.Equal("Test User", after.UserName);
        Assert.NotEqual("Renamed Since", after.UserName);
    }

    [Fact]
    public async Task An_unknown_history_action_is_refused_rather_than_silently_returning_everything()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));

        var response = await client.GetAsync($"/surveys/{survey.Id}/history?action=deleted");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Scoping
    // ------------------------------------------------------------------

    [Fact]
    public async Task Another_tenants_admin_cannot_read_version_or_audit_history()
    {
        var owner = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(owner, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(owner, survey.Id, SurveyStatuses.Active);

        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

        foreach (var path in new[] { $"/surveys/{survey.Id}/versions", $"/surveys/{survey.Id}/history" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync(path)).StatusCode);
        }
    }

    [Fact]
    public async Task An_employee_of_the_owning_company_cannot_read_the_authoring_history()
    {
        // Version and audit history expose who authored what and when. That is a
        // company-administration surface; a respondent's view of a survey is /surveys/my.
        var owner = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(owner, WithOptions(_companyId));

        var employee = await _harness.ClientAsync(Roles.Employee, _companyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/{survey.Id}/versions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/{survey.Id}/history")).StatusCode);
    }

    [Fact]
    public async Task A_version_of_another_survey_is_not_reachable_through_this_ones_path()
    {
        var client = await AdminAsync();
        var mine = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        var theirs = await SurveyTestHarness.CreateSurveyAsync(client, WithOptions(_companyId));
        await SurveyTestHarness.SetStatusAsync(client, theirs.Id, SurveyStatuses.Active);

        var theirVersionId = Assert.Single((await ListVersionsAsync(client, theirs.Id)).Versions).Id;

        var response = await client.GetAsync($"/surveys/{mine.Id}/versions/{theirVersionId}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_survey_is_a_404_on_every_history_route()
    {
        var client = await AdminAsync();
        var unknown = Guid.NewGuid();

        foreach (var path in new[]
                 {
                     $"/surveys/{unknown}/versions",
                     $"/surveys/{unknown}/versions/{Guid.NewGuid()}",
                     $"/surveys/{unknown}/versions/compare?from=1&to=2",
                     $"/surveys/{unknown}/history",
                 })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
        }
    }
}
