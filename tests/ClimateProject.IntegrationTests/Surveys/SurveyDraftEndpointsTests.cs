using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// #105 end to end: autosave, recovery, privacy, concurrency and retention.
///
/// The bias of this file is deliberate. Autosave is easy to test and almost impossible to
/// get wrong; **recovery** is the point of the feature and the thing that is only ever
/// exercised at the worst possible moment, so the round-trip that matters -- write, lose
/// the tab, come back, get every byte of state back -- is tested explicitly rather than
/// inferred from a successful save.
/// </summary>
[Collection("Postgres")]
public class SurveyDraftEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public SurveyDraftEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"drafts-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        _companyId = await _harness.SeedCompanyAsync("Acme", language: ContentLanguages.English);
        _otherCompanyId = await _harness.SeedCompanyAsync("Globex", language: ContentLanguages.English);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private static async Task<SurveyDraftDetail> CreateDraftAsync(
        HttpClient client,
        CreateSurveyDraftRequest? request = null)
    {
        var response = await client.PostAsJsonAsync("/surveys/drafts", request ?? new CreateSurveyDraftRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyDraftDetail>())!;
    }

    private static Task<HttpResponseMessage> AutosaveAsync(HttpClient client, Guid id, SaveSurveyDraftRequest request)
        => client.PostAsJsonAsync($"/surveys/drafts/{id}/autosave", request);

    private Task ForceExpiryAsync(Guid draftId, DateTimeOffset expiresAt)
        => _harness.WithDbAsync(async db =>
        {
            var draft = await db.SurveyDrafts.FirstAsync(d => d.Id == draftId);
            draft.ExpiresAt = expiresAt;
            await db.SaveChangesAsync();
        });

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    [Fact]
    public async Task Creating_a_draft_starts_it_at_version_one_with_no_autosaves()
    {
        var client = await AdminAsync();

        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        Assert.Equal("tab-1", draft.SessionId);
        Assert.Equal(_companyId, draft.CompanyId);
        Assert.Equal(1, draft.Version);
        Assert.Equal(0, draft.AutoSaveCount);
        Assert.Equal(1, draft.CurrentStep);
        Assert.False(draft.IsRecovered);
        Assert.Null(draft.LastAutosaveAt);
        // The company's own language, so 'both' stays an opt-in.
        Assert.Equal(ContentLanguages.English, draft.Language);
    }

    [Fact]
    public async Task A_draft_is_keyed_on_the_session_so_reopening_the_same_tab_does_not_fork_it()
    {
        var client = await AdminAsync();
        var first = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        var again = await client.PostAsJsonAsync("/surveys/drafts", new CreateSurveyDraftRequest(SessionId: "tab-1"));

        // 200 rather than 201: nothing was created.
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(first.Id, (await again.Content.ReadFromJsonAsync<SurveyDraftDetail>())!.Id);
    }

    [Fact]
    public async Task Different_sessions_get_different_drafts()
    {
        var client = await AdminAsync();

        var one = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));
        var two = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-2"));

        Assert.NotEqual(one.Id, two.Id);
    }

    [Fact]
    public async Task An_omitted_session_id_is_minted_rather_than_rejected()
    {
        var client = await AdminAsync();

        var draft = await CreateDraftAsync(client);

        Assert.False(string.IsNullOrWhiteSpace(draft.SessionId));
    }

    // ------------------------------------------------------------------
    // Recovery -- the actual point
    // ------------------------------------------------------------------

    /// <summary>
    /// The whole feature in one test: author, autosave, lose the tab, come back with
    /// nothing but a session id, and get every field back -- including the opaque wizard
    /// state, byte for byte. A draft that survives as a row but not as restorable state is
    /// just a write.
    /// </summary>
    [Fact]
    public async Task Recovery_restores_the_full_draft_state_including_opaque_wizard_content()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        const string wizardState =
            """{"step":3,"questions":[{"id":"q1","type":"likert"},{"id":"q2"}],"scroll":420,"touched":true}""";
        var saved = await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version,
            Title: LocalizedInput.FromBare("Half-built survey"),
            Content: Json(wizardState),
            CurrentStep: 3,
            LastEditedField: "questions[1].text"));
        saved.EnsureSuccessStatusCode();

        // The tab dies here. All the browser has left is its session id.
        var freshClient = _factory.CreateClient();
        freshClient.DefaultRequestHeaders.Authorization = client.DefaultRequestHeaders.Authorization;

        var latest = await freshClient.GetFromJsonAsync<SurveyDraftLatestResponse>(
            "/surveys/drafts/latest?sessionId=tab-1");
        Assert.NotNull(latest!.Draft);
        Assert.Equal(draft.Id, latest.Draft!.Id);

        var recovered = await freshClient.PostAsync($"/surveys/drafts/{draft.Id}/recover", content: null);
        recovered.EnsureSuccessStatusCode();
        var restored = (await recovered.Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.True(restored.IsRecovered);
        Assert.Equal("Half-built survey", restored.Title);
        Assert.Equal(3, restored.CurrentStep);
        Assert.Equal("questions[1].text", restored.LastEditedField);
        Assert.NotNull(restored.Content);

        // Compared as JSON, not as text. draft_data is jsonb: Postgres reparses and re-renders
        // it on storage rather than preserving the bytes it was handed, so what comes back is
        // semantically identical and textually different (notably a space after each colon).
        // "Opaque wizard state survives a recovery intact" is a statement about the value, and
        // asserting it on the raw text instead makes the test fail on the storage engine's
        // formatting rather than on the behaviour it is guarding.
        Assert.Equal(CanonicalJson(wizardState), CanonicalJson(restored.Content!.Value.GetRawText()));
    }

    /// <summary>
    /// A rendering that depends on nothing but the JSON's content — no whitespace, and no key
    /// order.
    ///
    /// Postgres <c>jsonb</c> preserves neither. It reparses on storage and re-renders with a
    /// space after each colon, and it orders object keys by length then bytewise, so
    /// <c>{"step":…,"questions":…,"scroll":…,"touched":…}</c> comes back as
    /// <c>step, scroll, touched, questions</c>. Both are round-trip artefacts of the storage
    /// engine, and neither says anything about whether the draft survived intact — which is the
    /// only thing these tests are asserting.
    /// </summary>
    private static string CanonicalJson(string json)
    {
        using var document = JsonDocument.Parse(json);
        return Canonicalise(document.RootElement);
    }

    private static string Canonicalise(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => "{"
            + string.Join(",", element.EnumerateObject()
                .OrderBy(property => property.Name, StringComparer.Ordinal)
                .Select(property => $"{JsonSerializer.Serialize(property.Name)}:{Canonicalise(property.Value)}"))
            + "}",
        // Array order is meaningful — question order is the survey's order — so it is preserved.
        JsonValueKind.Array => "[" + string.Join(",", element.EnumerateArray().Select(Canonicalise)) + "]",
        _ => element.GetRawText(),
    };

    [Fact]
    public async Task Latest_returns_the_most_recently_touched_draft_across_sessions()
    {
        var client = await AdminAsync();
        var older = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));
        var newer = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-2"));

        (await AutosaveAsync(client, older.Id, new SaveSurveyDraftRequest(Content: Json("""{"a":1}"""))))
            .EnsureSuccessStatusCode();

        var latest = await client.GetFromJsonAsync<SurveyDraftLatestResponse>("/surveys/drafts/latest");

        // tab-1 was touched last, so it wins even though tab-2 was created later.
        Assert.Equal(older.Id, latest!.Draft!.Id);
        Assert.NotEqual(newer.Id, latest.Draft.Id);
    }

    /// <summary>
    /// "Nothing to recover" is the normal answer -- it is what the recovery banner asks on
    /// every wizard open -- so it is a 200 with a null draft, not a 404 the client has to
    /// learn to ignore.
    /// </summary>
    [Fact]
    public async Task Latest_with_nothing_to_recover_is_a_null_draft_not_an_error()
    {
        var client = await AdminAsync();

        var response = await client.GetAsync("/surveys/drafts/latest");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null((await response.Content.ReadFromJsonAsync<SurveyDraftLatestResponse>())!.Draft);
    }

    /// <summary>
    /// Recovering must not invalidate the caller's concurrency token: bumping the version
    /// here would make the first autosave after every single recovery a spurious 409,
    /// i.e. it would break the flow it exists to serve.
    /// </summary>
    [Fact]
    public async Task Recovering_does_not_move_the_version_so_the_next_autosave_is_not_a_conflict()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client);

        var recovered = (await (await client.PostAsync($"/surveys/drafts/{draft.Id}/recover", content: null))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;
        Assert.Equal(draft.Version, recovered.Version);

        var next = await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version, Content: Json("""{"resumed":true}""")));

        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
    }

    [Fact]
    public async Task A_recovered_draft_can_be_recovered_again_after_a_second_crash()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        (await client.PostAsync($"/surveys/drafts/{draft.Id}/recover", content: null)).EnsureSuccessStatusCode();

        // IsRecovered is reported so the client can decide whether to re-prompt; it is
        // never used to hide work that was recovered once and abandoned again.
        var latest = await client.GetFromJsonAsync<SurveyDraftLatestResponse>("/surveys/drafts/latest");
        Assert.Equal(draft.Id, latest!.Draft!.Id);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PostAsync($"/surveys/drafts/{draft.Id}/recover", content: null)).StatusCode);
    }

    // ------------------------------------------------------------------
    // Concurrency
    // ------------------------------------------------------------------

    [Fact]
    public async Task Autosave_advances_the_version_and_the_autosave_count()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client);

        var first = (await (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version, Content: Json("""{"n":1}"""))))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.Equal(draft.Version + 1, first.Version);
        Assert.Equal(1, first.AutoSaveCount);
        Assert.NotNull(first.LastAutosaveAt);
    }

    /// <summary>
    /// An explicit save is not an autosave: it moves the concurrency token like every
    /// other write, but it must not inflate the counter the AutosaveIndicator renders.
    /// </summary>
    [Fact]
    public async Task An_explicit_put_bumps_the_version_but_not_the_autosave_count()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client);

        var response = await client.PutAsJsonAsync(
            $"/surveys/drafts/{draft.Id}",
            new SaveSurveyDraftRequest(ExpectedVersion: draft.Version, Content: Json("""{"n":1}""")));
        response.EnsureSuccessStatusCode();
        var saved = (await response.Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.Equal(draft.Version + 1, saved.Version);
        Assert.Equal(0, saved.AutoSaveCount);
        Assert.Null(saved.LastAutosaveAt);
    }

    /// <summary>
    /// The acceptance criterion, run for real rather than argued: two tabs autosaving the
    /// same draft at the same instant, both holding the same version.
    /// </summary>
    [Fact]
    public async Task Two_concurrent_autosaves_holding_the_same_version_cannot_both_win()
    {
        var token = await _harness.TokenAsync(Roles.CompanyAdmin, _companyId);
        var tabOne = _factory.CreateClient();
        var tabTwo = _factory.CreateClient();
        tabOne.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");
        tabTwo.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");

        var draft = await CreateDraftAsync(tabOne, new CreateSurveyDraftRequest(SessionId: "shared"));

        var results = await Task.WhenAll(
            AutosaveAsync(tabOne, draft.Id, new SaveSurveyDraftRequest(
                ExpectedVersion: draft.Version, Content: Json("""{"from":"tab-one"}"""))),
            AutosaveAsync(tabTwo, draft.Id, new SaveSurveyDraftRequest(
                ExpectedVersion: draft.Version, Content: Json("""{"from":"tab-two"}"""))));

        var statuses = results.Select(r => r.StatusCode).ToList();
        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.Conflict));

        // Whichever lost gets the state that actually won, so it can reconcile without a
        // second round trip.
        var loser = results.First(r => r.StatusCode == HttpStatusCode.Conflict);
        var conflict = (await loser.Content.ReadFromJsonAsync<SurveyDraftConflict>())!;
        Assert.Equal(draft.Version + 1, conflict.Current.Version);

        // Exactly one write landed: no interleaving, no double increment.
        var stored = await _harness.WithDbAsync(db => db.SurveyDrafts.AsNoTracking().FirstAsync(d => d.Id == draft.Id));
        Assert.Equal(draft.Version + 1, stored.Version);
        Assert.Equal(1, stored.AutoSaveCount);
        Assert.Contains("tab-", stored.DraftData!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_stale_expected_version_is_refused_with_the_current_state()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client);

        (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version, Content: Json("""{"n":1}""")))).EnsureSuccessStatusCode();

        var stale = await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version, Content: Json("""{"n":2}""")));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var conflict = (await stale.Content.ReadFromJsonAsync<SurveyDraftConflict>())!;
        Assert.Equal(draft.Version + 1, conflict.Current.Version);

        // The refused write left nothing behind.
        var stored = await _harness.WithDbAsync(db => db.SurveyDrafts.AsNoTracking().FirstAsync(d => d.Id == draft.Id));
        Assert.DoesNotContain("\"n\":2", stored.DraftData!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Last-writer-wins is the documented behaviour when no version is supplied -- the
    /// right default for a single-tab autosave loop, where every write is a superset of
    /// the last and demanding a token would turn a dropped response into a false conflict.
    /// The counters still have to be exact, because they are incremented by the database
    /// rather than by whatever number the client last saw.
    /// </summary>
    [Fact]
    public async Task Without_an_expected_version_the_last_writer_wins_and_no_increment_is_lost()
    {
        var token = await _harness.TokenAsync(Roles.CompanyAdmin, _companyId);
        var tabOne = _factory.CreateClient();
        var tabTwo = _factory.CreateClient();
        tabOne.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");
        tabTwo.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");

        var draft = await CreateDraftAsync(tabOne, new CreateSurveyDraftRequest(SessionId: "shared"));

        var results = await Task.WhenAll(
            AutosaveAsync(tabOne, draft.Id, new SaveSurveyDraftRequest(Content: Json("""{"from":"one"}"""))),
            AutosaveAsync(tabTwo, draft.Id, new SaveSurveyDraftRequest(Content: Json("""{"from":"two"}"""))));

        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));

        var stored = await _harness.WithDbAsync(db => db.SurveyDrafts.AsNoTracking().FirstAsync(d => d.Id == draft.Id));
        Assert.Equal(draft.Version + 2, stored.Version);
        Assert.Equal(2, stored.AutoSaveCount);

        // One of the two payloads survived whole. Neither half-applied nor merged.
        //
        // Asserted structurally rather than by substring. draft_data is jsonb, and Postgres
        // reparses and re-renders jsonb on storage rather than keeping the bytes it was given
        // -- so the row comes back as {"content": {"from": "two"}}, with a space after the
        // colon, and a search for "from":"two" finds neither payload. That made this report
        // "interleaved" for a row that was in fact perfectly intact.
        using var document = JsonDocument.Parse(stored.DraftData!);
        var from = document.RootElement.GetProperty("content").GetProperty("from").GetString();
        Assert.Contains(from, new[] { "one", "two" });
    }

    [Fact]
    public async Task Content_is_replaced_wholesale_so_a_deleted_question_stays_deleted()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            Content: Json("""{"questions":[{"id":"q1"},{"id":"q2"}]}""")));

        var saved = (await (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            Content: Json("""{"questions":[{"id":"q1"}]}"""))))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.Equal("""{"questions":[{"id":"q1"}]}""", saved.Content!.Value.GetRawText());
    }

    [Fact]
    public async Task An_omitted_content_leaves_the_stored_snapshot_alone()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            Content: Json("""{"step":4}""")));

        var saved = (await (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            CurrentStep: 5)))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.Equal(5, saved.CurrentStep);
        Assert.Equal("""{"step":4}""", saved.Content!.Value.GetRawText());
    }

    // ------------------------------------------------------------------
    // Privacy -- drafts belong to their author and nobody else
    // ------------------------------------------------------------------

    /// <summary>
    /// The issue is explicit that a CompanyAdmin must not see another's draft. 404 rather
    /// than 403 on purpose: a 403 against a specific id confirms the id exists and that
    /// the colleague is drafting something, which is itself the leak.
    /// </summary>
    [Fact]
    public async Task A_colleague_in_the_same_company_cannot_touch_my_draft()
    {
        var mine = await AdminAsync();
        var colleague = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var draft = await CreateDraftAsync(mine, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        Assert.Equal(HttpStatusCode.NotFound, (await colleague.GetAsync($"/surveys/drafts/{draft.Id}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await colleague.PutAsJsonAsync($"/surveys/drafts/{draft.Id}", new SaveSurveyDraftRequest())).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await AutosaveAsync(colleague, draft.Id, new SaveSurveyDraftRequest())).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await colleague.PostAsync($"/surveys/drafts/{draft.Id}/recover", content: null)).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await colleague.DeleteAsync($"/surveys/drafts/{draft.Id}")).StatusCode);

        var listed = await colleague.GetFromJsonAsync<SurveyDraftListResponse>("/surveys/drafts");
        Assert.Empty(listed!.Drafts);

        var latest = await colleague.GetFromJsonAsync<SurveyDraftLatestResponse>("/surveys/drafts/latest");
        Assert.Null(latest!.Draft);
    }

    /// <summary>
    /// No super-admin override either. Reading a colleague's half-written survey is not a
    /// product feature, and the one elevated route (the retention sweep) deletes strictly
    /// by expiry and reads no draft content at all.
    /// </summary>
    [Fact]
    public async Task Not_even_a_super_admin_can_read_someone_elses_draft()
    {
        var mine = await AdminAsync();
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, _companyId);

        var draft = await CreateDraftAsync(mine);

        Assert.Equal(HttpStatusCode.NotFound, (await superAdmin.GetAsync($"/surveys/drafts/{draft.Id}")).StatusCode);
        Assert.Empty((await superAdmin.GetFromJsonAsync<SurveyDraftListResponse>("/surveys/drafts"))!.Drafts);
    }

    [Fact]
    public async Task An_admin_in_another_company_cannot_see_the_draft_either()
    {
        var mine = await AdminAsync();
        var stranger = await _harness.ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

        var draft = await CreateDraftAsync(mine);

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/surveys/drafts/{draft.Id}")).StatusCode);
    }

    /// <summary>
    /// Drafting is survey-authoring surface, so it takes the same roles as POST /surveys.
    /// An employee has no wizard to autosave from.
    /// </summary>
    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task A_non_admin_cannot_draft_a_survey(string role)
    {
        var client = await _harness.ClientAsync(role, _companyId);

        var response = await client.PostAsJsonAsync("/surveys/drafts", new CreateSurveyDraftRequest());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// survey_drafts.company_id is NOT NULL while User.CompanyId has been Guid? since
    /// #191, where NULL means "outside every tenant". Such a user has no company whose
    /// surveys they would be drafting, so this is a 400 with a reason rather than an
    /// opaque foreign-key 500.
    /// </summary>
    [Fact]
    public async Task A_global_super_admin_with_no_company_gets_a_reason_not_a_500()
    {
        var client = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var response = await client.PostAsJsonAsync("/surveys/drafts", new CreateSurveyDraftRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_challenged()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/surveys/drafts/latest");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Content i18n
    // ------------------------------------------------------------------

    /// <summary>
    /// The load-bearing #195 constraint, applied to drafts. <c>content</c> is excluded
    /// because it is the wizard's own opaque state -- the server never resolves or renders
    /// it, and it is precisely to keep the fields the server DOES own out of that blob
    /// that title and description are lifted into the envelope.
    /// </summary>
    [Fact]
    public async Task No_draft_read_payload_carries_an_En_or_Es_shaped_property()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            SessionId: "tab-1",
            Language: ContentLanguages.Both,
            Title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            Description: SurveyTestHarness.Both("How we are doing", "Cómo vamos")));

        foreach (var url in new[]
                 {
                     $"/surveys/drafts/{draft.Id}", "/surveys/drafts", "/surveys/drafts/latest",
                 })
        {
            using var document = JsonDocument.Parse(await client.GetStringAsync(url));
            AssertNoLocaleSuffixedProperties(document.RootElement, url);
        }
    }

    private static void AssertNoLocaleSuffixedProperties(JsonElement element, string path)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.NameEquals("content"))
                    {
                        // Client-owned scratchpad, never interpreted by the server.
                        continue;
                    }

                    Assert.False(
                        property.Name.EndsWith("En", StringComparison.Ordinal)
                        || property.Name.EndsWith("Es", StringComparison.Ordinal)
                        || property.Name.EndsWith("_en", StringComparison.Ordinal)
                        || property.Name.EndsWith("_es", StringComparison.Ordinal),
                        $"{path}: read payload exposes locale-shaped property '{property.Name}'");
                    AssertNoLocaleSuffixedProperties(property.Value, $"{path}.{property.Name}");
                }

                break;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    AssertNoLocaleSuffixedProperties(item, path);
                }

                break;
        }
    }

    /// <summary>
    /// Attributing an unlabelled string to one language column is the silent
    /// content-mangling the paired storage exists to prevent, and a draft is content too.
    /// </summary>
    [Fact]
    public async Task A_bare_string_title_is_rejected_on_a_draft_authored_in_both_languages()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync("/surveys/drafts", new CreateSurveyDraftRequest(
            Language: ContentLanguages.Both,
            Title: LocalizedInput.FromBare("Team pulse")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_bare_string_title_is_attributed_to_a_single_language_draft()
    {
        var client = await AdminAsync();

        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            Language: ContentLanguages.Spanish,
            Title: LocalizedInput.FromBare("Pulso semanal")));

        Assert.Equal("Pulso semanal", draft.Title);
        Assert.Equal(ContentLanguages.Spanish, draft.ResolvedLocale);
    }

    /// <summary>
    /// ResolvedLocale is the locale the text is ACTUALLY in, not the one requested. The
    /// exact bug #104 shipped and had caught.
    /// </summary>
    [Fact]
    public async Task A_spanish_only_draft_read_as_english_comes_back_in_spanish_and_says_so()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            Language: ContentLanguages.Spanish,
            Title: LocalizedInput.FromBare("Pulso semanal")));

        var read = await client.GetFromJsonAsync<SurveyDraftDetail>($"/surveys/drafts/{draft.Id}?lang=en");

        Assert.Equal("Pulso semanal", read!.Title);
        Assert.Equal(ContentLanguages.Spanish, read.ResolvedLocale);
        Assert.Contains("title", read.FallbackFields);
    }

    /// <summary>
    /// Draft-time translation gaps are a warning, never a gate --
    /// <c>ContentPublishValidation</c> says so in its own words, and a blocking validator
    /// would fight an autosave loop that runs every few seconds. You have to be able to
    /// save a half-translated title in order to go and write the other half.
    /// </summary>
    [Fact]
    public async Task A_half_translated_both_draft_saves_and_reports_what_is_missing()
    {
        var client = await AdminAsync();

        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(
            Language: ContentLanguages.Both,
            Title: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Team pulse" })));

        Assert.False(draft.IsTranslationComplete);
        Assert.Contains(draft.MissingTranslations, m => m is { Field: "title", Locale: "es" });

        var completed = (await (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            ExpectedVersion: draft.Version,
            Title: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["es"] = "Pulso de equipo" }))))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.True(completed.IsTranslationComplete);
        Assert.Empty(completed.MissingTranslations);
        // The English half was not clobbered by a partial save.
        Assert.Equal("Team pulse", (await client.GetFromJsonAsync<SurveyDraftDetail>(
            $"/surveys/drafts/{draft.Id}?lang=en"))!.Title);
    }

    [Fact]
    public async Task An_invalid_language_is_rejected_rather_than_silently_defaulted()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync(
            "/surveys/drafts", new CreateSurveyDraftRequest(Language: "pt"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Retention
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_new_draft_expires_a_full_retention_window_out()
    {
        var client = await AdminAsync();

        var draft = await CreateDraftAsync(client);

        Assert.InRange(
            draft.ExpiresAt,
            DateTimeOffset.UtcNow + SurveyDraftRetention.Ttl - TimeSpan.FromMinutes(5),
            DateTimeOffset.UtcNow + SurveyDraftRetention.Ttl + TimeSpan.FromMinutes(5));
    }

    /// <summary>
    /// The sliding half of the policy, and the reason the sweep can never take live work.
    /// </summary>
    [Fact]
    public async Task Every_save_pushes_the_expiry_back_out()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client);

        await ForceExpiryAsync(draft.Id, DateTimeOffset.UtcNow.AddMinutes(5));

        var saved = (await (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest(
            Content: Json("""{"n":1}"""))))
            .Content.ReadFromJsonAsync<SurveyDraftDetail>())!;

        Assert.True(saved.ExpiresAt > DateTimeOffset.UtcNow.AddDays(29));
    }

    /// <summary>
    /// Expiry is enforced by the read filters, not by the sweep -- so the retention policy
    /// holds even if nothing ever runs the sweep. A rule that depends on a scheduler
    /// existing is a rule that quietly stops applying the first time it is down.
    /// </summary>
    [Fact]
    public async Task An_expired_draft_is_invisible_even_before_it_is_swept()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        await ForceExpiryAsync(draft.Id, DateTimeOffset.UtcNow.AddSeconds(-1));

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/surveys/drafts/{draft.Id}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<SurveyDraftListResponse>("/surveys/drafts"))!.Drafts);
        Assert.Null((await client.GetFromJsonAsync<SurveyDraftLatestResponse>("/surveys/drafts/latest"))!.Draft);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await AutosaveAsync(client, draft.Id, new SaveSurveyDraftRequest())).StatusCode);

        // And it does not resurrect: creating for the same session starts fresh.
        var replacement = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));
        Assert.NotEqual(draft.Id, replacement.Id);
    }

    [Fact]
    public async Task The_sweep_reclaims_expired_rows_and_leaves_live_ones()
    {
        var client = await AdminAsync();
        var expired = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-old"));
        var live = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-new"));
        await ForceExpiryAsync(expired.Id, DateTimeOffset.UtcNow.AddSeconds(-1));

        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, _companyId);
        var response = await superAdmin.DeleteAsync("/surveys/drafts/expired");
        response.EnsureSuccessStatusCode();

        Assert.True((await response.Content.ReadFromJsonAsync<PurgeExpiredDraftsResponse>())!.Deleted >= 1);

        await _harness.WithDbAsync(async db =>
        {
            Assert.False(await db.SurveyDrafts.AnyAsync(d => d.Id == expired.Id));
            Assert.True(await db.SurveyDrafts.AnyAsync(d => d.Id == live.Id));
        });
    }

    [Fact]
    public async Task The_sweep_is_super_admin_only()
    {
        var client = await AdminAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await client.DeleteAsync("/surveys/drafts/expired")).StatusCode);
    }

    // ------------------------------------------------------------------
    // Discard
    // ------------------------------------------------------------------

    [Fact]
    public async Task Discarding_a_draft_removes_it_from_recovery()
    {
        var client = await AdminAsync();
        var draft = await CreateDraftAsync(client, new CreateSurveyDraftRequest(SessionId: "tab-1"));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/surveys/drafts/{draft.Id}")).StatusCode);

        Assert.Null((await client.GetFromJsonAsync<SurveyDraftLatestResponse>("/surveys/drafts/latest"))!.Draft);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/surveys/drafts/{draft.Id}")).StatusCode);
    }
}
