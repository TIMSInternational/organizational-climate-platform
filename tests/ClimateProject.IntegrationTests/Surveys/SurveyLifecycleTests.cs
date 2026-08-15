using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The crux of #104: legal transitions, refused illegal ones, and the point at which a
/// survey stops being editable. A survey that stays editable after responses arrive
/// silently corrupts its own results, so every rule here is asserted against a real
/// response row rather than against the status column alone.
/// </summary>
[Collection("Postgres")]
public class SurveyLifecycleTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyLifecycleTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"life-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Lifecycle Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private Task<SurveyDetail> CreateDraftAsync(HttpClient client)
        => SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));

    // ------------------------------------------------------------------
    // Transitions
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_survey_walks_the_whole_lifecycle()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        foreach (var status in new[] { SurveyStatuses.Scheduled, SurveyStatuses.Active, SurveyStatuses.Closed, SurveyStatuses.Archived })
        {
            var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, status);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(status, (await response.Content.ReadFromJsonAsync<SurveyDetail>())!.Status);
        }
    }

    [Theory]
    [InlineData(SurveyStatuses.Active, SurveyStatuses.Draft)]
    [InlineData(SurveyStatuses.Active, SurveyStatuses.Scheduled)]
    [InlineData(SurveyStatuses.Closed, SurveyStatuses.Active)]
    [InlineData(SurveyStatuses.Closed, SurveyStatuses.Draft)]
    [InlineData(SurveyStatuses.Archived, SurveyStatuses.Active)]
    public async Task An_illegal_transition_is_refused_with_the_transitions_that_would_have_been_legal(string from, string to)
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        await _harness.ForceStatusAsync(survey.Id, from);

        var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, to);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(from, body, StringComparison.Ordinal);
        Assert.Contains(to, body, StringComparison.Ordinal);

        var unchanged = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}");
        Assert.Equal(from, unchanged!.Status);
    }

    [Fact]
    public async Task Draft_can_be_archived_directly_so_an_abandoned_draft_can_be_filed_away()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Archived);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Archived_is_terminal()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Archived)).EnsureSuccessStatusCode();

        var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("final", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Scheduled_can_return_to_draft_which_is_the_only_route_back_to_an_editable_survey()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled)).EnsureSuccessStatusCode();

        var back = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Draft);
        Assert.Equal(HttpStatusCode.OK, back.StatusCode);

        var edit = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Fixed the typo")));
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
    }

    [Fact]
    public async Task Setting_the_status_a_survey_already_has_is_an_idempotent_no_op()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var repeated = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.OK, repeated.StatusCode);
        Assert.Equal(SurveyStatuses.Active, (await repeated.Content.ReadFromJsonAsync<SurveyDetail>())!.Status);
    }

    [Fact]
    public async Task A_status_outside_the_vocabulary_is_a_400()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, "published");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_survey_with_no_questions_cannot_be_published()
    {
        var client = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_companyId, questions: []));

        var response = await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no questions", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_detail_payload_advertises_exactly_the_transitions_the_server_will_accept()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        var draft = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}");
        Assert.Equal(
            [SurveyStatuses.Scheduled, SurveyStatuses.Active, SurveyStatuses.Archived],
            draft!.AllowedStatusTransitions);

        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var active = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}");
        Assert.Equal([SurveyStatuses.Closed], active!.AllowedStatusTransitions);
        Assert.False(active.IsContentEditable);
    }

    // ------------------------------------------------------------------
    // Immutability
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(SurveyStatuses.Scheduled)]
    [InlineData(SurveyStatuses.Active)]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public async Task Questions_cannot_be_rewritten_once_the_survey_has_left_draft(string status)
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        await _harness.ForceStatusAsync(survey.Id, status);

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("A different question"), "open_ended", Order: 0)]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var unchanged = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}");
        Assert.Equal("How are you feeling?", Assert.Single(unchanged!.Questions).Text);
    }

    [Theory]
    [InlineData(nameof(UpdateSurveyRequest.Title))]
    [InlineData(nameof(UpdateSurveyRequest.Description))]
    [InlineData(nameof(UpdateSurveyRequest.Type))]
    [InlineData(nameof(UpdateSurveyRequest.Language))]
    [InlineData(nameof(UpdateSurveyRequest.DepartmentIds))]
    [InlineData("Anonymous")]
    public async Task Every_content_field_is_frozen_once_the_survey_is_active(string field)
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var request = field switch
        {
            nameof(UpdateSurveyRequest.Title) => new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Rewritten")),
            nameof(UpdateSurveyRequest.Description) => new UpdateSurveyRequest(Description: LocalizedInput.FromBare("Rewritten")),
            nameof(UpdateSurveyRequest.Type) => new UpdateSurveyRequest(Type: "exit_interview"),
            nameof(UpdateSurveyRequest.Language) => new UpdateSurveyRequest(Language: ContentLanguages.Both),
            nameof(UpdateSurveyRequest.DepartmentIds) => new UpdateSurveyRequest(DepartmentIds: [_departmentId]),
            // Flipping Anonymous changes how every answer already collected may be
            // re-identified, which is why it is classed as content and not as a setting.
            _ => new UpdateSurveyRequest(Settings: new SurveySettingsInput(Anonymous: true)),
        };

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", request);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task A_draft_that_somehow_has_responses_is_still_frozen()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        // The status rule alone would allow this edit. The response guard is the belt to
        // its braces, and it is checked against the responses table rather than only the
        // denormalised counter.
        await _harness.SeedResponseAsync(survey.Id, _companyId, null);

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("Swapped out"), "open_ended", Order: 0)]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("already has responses", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_stale_response_counter_cannot_open_the_gate()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        await _harness.SeedResponseAsync(survey.Id, _companyId, null);

        // Counter says zero; the responses table disagrees. The table wins.
        await _harness.WithDbAsync(async db =>
        {
            var row = await db.Surveys.FirstAsync(s => s.Id == survey.Id);
            row.ResponseCount = 0;
            await db.SaveChangesAsync();
        });

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("Swapped out"), "open_ended", Order: 0)]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task The_response_window_can_still_be_extended_while_the_survey_is_running()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var extended = DateTimeOffset.UtcNow.AddDays(30);
        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            EndDate: extended,
            Settings: new SurveySettingsInput(NotificationSendReminders: false)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal(extended.ToUnixTimeSeconds(), updated.EndDate.ToUnixTimeSeconds());
        Assert.False(updated.Settings.NotificationSendReminders);
    }

    [Fact]
    public async Task A_running_surveys_start_date_cannot_be_rewritten()
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            StartDate: DateTimeOffset.UtcNow.AddDays(5),
            EndDate: DateTimeOffset.UtcNow.AddDays(40)));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Theory]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public async Task A_finished_survey_cannot_even_be_rescheduled(string status)
    {
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);
        await _harness.ForceStatusAsync(survey.Id, status);

        var response = await client.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            EndDate: DateTimeOffset.UtcNow.AddDays(60)));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task The_update_route_cannot_change_status_at_all()
    {
        // UpdateSurveyRequest has no Status member by design, so a client sending one gets
        // it ignored rather than smuggling a publish past the content-i18n gate. Asserted
        // over the wire because the compiler cannot catch a hand-rolled JSON body.
        var client = await AdminAsync();
        var survey = await CreateDraftAsync(client);

        var response = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new { status = SurveyStatuses.Active, title = "Still a draft" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(SurveyStatuses.Draft, (await response.Content.ReadFromJsonAsync<SurveyDetail>())!.Status);
    }
}
