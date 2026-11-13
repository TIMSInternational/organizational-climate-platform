using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Taking one person's response out of the results (ruled 2026-11-08): ESPH's 28 Oct case, where
/// someone outside the Clima population answered Clima and the only remedy was a note telling the
/// results generator to subtract her by hand.
/// </summary>
[Collection("Postgres")]
public class ResponseExclusionTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public ResponseExclusionTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"exclude-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Exclusion Co");

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>An active identified survey on which <c>finished</c> answered and <c>other</c> answered too.</summary>
    private async Task<(HttpClient Operator, SurveyDetail Survey, Guid Finished, HttpClient FinishedClient, Guid Other)> AnsweredAsync()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var (finishedClient, finished) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var (_, other) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(operatorClient, SurveyTestHarness.MinimalRequest(_companyId));
        (await SurveyTestHarness.SetStatusAsync(operatorClient, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await _harness.SeedResponseAsync(survey.Id, _companyId, finished);
        await _harness.SeedResponseAsync(survey.Id, _companyId, other);
        return (operatorClient, survey, finished, finishedClient, other);
    }

    private static Task<HttpResponseMessage> ExcludeAsync(HttpClient client, Guid surveyId, Guid userId, string? reason = "No está en la población del cliente")
        => client.PostAsJsonAsync($"/surveys/{surveyId}/response-exclusions", new ExcludeResponseRequest(userId, reason));

    private static Task<HttpResponseMessage> RestoreAsync(HttpClient client, Guid surveyId, Guid userId)
        => client.PostAsJsonAsync($"/surveys/{surveyId}/response-exclusions/restore", new RestoreResponseRequest(userId));

    private static async Task<(int Completed, int ResponseCount)> CountsAsync(HttpClient client, Guid surveyId)
    {
        using var stats = JsonDocument.Parse(await client.GetStringAsync($"/surveys/{surveyId}/real-time-stats"));
        using var detail = JsonDocument.Parse(await client.GetStringAsync($"/surveys/{surveyId}"));
        return (stats.RootElement.GetProperty("completedCount").GetInt32(), detail.RootElement.GetProperty("responseCount").GetInt32());
    }

    private static async Task<JsonElement> RosterRowAsync(HttpClient client, Guid surveyId, Guid userId)
    {
        using var view = JsonDocument.Parse(await client.GetStringAsync($"/surveys/{surveyId}/participation"));
        return view.RootElement.GetProperty("roster").EnumerateArray()
            .Single(row => row.GetProperty("userId").GetGuid() == userId)
            .Clone();
    }

    [Fact]
    public async Task An_excluded_response_leaves_the_counts_and_a_restore_puts_it_back()
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();
        Assert.Equal((2, 2), await CountsAsync(operatorClient, survey.Id));

        var excluded = await ExcludeAsync(operatorClient, survey.Id, finished);

        Assert.Equal(HttpStatusCode.OK, excluded.StatusCode);
        Assert.Equal((1, 1), await CountsAsync(operatorClient, survey.Id));

        // The row is still there -- excluded, not deleted.
        var stored = await _harness.WithDbAsync(db => db.Responses
            .IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .CountAsync(r => r.SurveyId == survey.Id && r.UserId == finished && r.ExcludedAt != null));
        Assert.Equal(1, stored);

        (await RestoreAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();

        Assert.Equal((2, 2), await CountsAsync(operatorClient, survey.Id));
    }

    [Fact]
    public async Task Excluding_twice_changes_the_counts_once()
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();

        (await ExcludeAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();
        var again = await ExcludeAsync(operatorClient, survey.Id, finished);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.False(JsonDocument.Parse(await again.Content.ReadAsStringAsync()).RootElement.GetProperty("changed").GetBoolean());
        Assert.Equal((1, 1), await CountsAsync(operatorClient, survey.Id));
    }

    /// <summary>
    /// The person DID answer. Leaving the results must not put the survey back on their list, or
    /// they would be asked to answer something they already answered.
    /// </summary>
    [Fact]
    public async Task The_excluded_person_still_reads_as_finished_and_is_not_offered_the_survey_again()
    {
        var (operatorClient, survey, finished, finishedClient, _) = await AnsweredAsync();

        (await ExcludeAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();

        var row = await RosterRowAsync(operatorClient, survey.Id, finished);
        Assert.Equal(SurveyParticipantStatuses.Completed, row.GetProperty("status").GetString());
        Assert.True(row.GetProperty("excludedFromResults").GetBoolean());

        var mine = await finishedClient.GetStringAsync("/surveys/my");
        Assert.DoesNotContain(survey.Id.ToString(), mine);
    }

    /// <summary>
    /// For the respondent nothing changes: a submit after the exclusion is answered exactly as one
    /// before it, and no second response appears beside the excluded one.
    /// </summary>
    [Fact]
    public async Task An_excluded_person_who_submits_again_gets_the_same_answer_and_no_new_response()
    {
        var (operatorClient, survey, finished, finishedClient, _) = await AnsweredAsync();
        var before = await finishedClient.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(Answers: [], IsComplete: true));
        var beforeBody = await before.Content.ReadAsStringAsync();

        (await ExcludeAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();
        var after = await finishedClient.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(Answers: [], IsComplete: true));

        Assert.Equal(before.StatusCode, after.StatusCode);
        Assert.Equal(beforeBody, await after.Content.ReadAsStringAsync());
        var rows = await _harness.WithDbAsync(db => db.Responses
            .IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .CountAsync(r => r.SurveyId == survey.Id && r.UserId == finished));
        Assert.Equal(1, rows);
    }

    /// <summary>
    /// A client administrator who knew whose response left, and compared results before and
    /// after, could work out that person's answers by subtraction.
    /// </summary>
    [Fact]
    public async Task Only_a_super_admin_is_told_whose_response_was_excluded()
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();
        var clientAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        (await ExcludeAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();

        var seenByClient = await RosterRowAsync(clientAdmin, survey.Id, finished);

        Assert.False(seenByClient.GetProperty("excludedFromResults").GetBoolean());
        Assert.Equal(SurveyParticipantStatuses.Completed, seenByClient.GetProperty("status").GetString());
    }

    [Fact]
    public async Task The_audit_row_keeps_the_reason_and_the_survey_but_never_the_person()
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();

        (await ExcludeAsync(operatorClient, survey.Id, finished, "Recibió la clave por error el 28/10")).EnsureSuccessStatusCode();

        await _harness.WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.AsNoTracking()
                .SingleAsync(a => a.CompanyId == _companyId && a.Action.Contains("exclusion"));
            Assert.Equal(survey.Id.ToString(), row.ResourceId);
            Assert.Contains("Recibió la clave por error el 28/10", row.Details!);
            Assert.DoesNotContain(finished.ToString(), row.Details!);
            Assert.DoesNotContain(finished.ToString(), row.ResourceId!);
        });
    }

    [Fact]
    public async Task A_company_admin_cannot_exclude_a_response()
    {
        var (_, survey, finished, _, _) = await AnsweredAsync();
        var clientAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await ExcludeAsync(clientAdmin, survey.Id, finished);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    [InlineData("no")]
    public async Task An_exclusion_without_a_reason_is_refused(string? reason)
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();

        var response = await ExcludeAsync(operatorClient, survey.Id, finished, reason);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("exclusion_reason_required", await response.Content.ReadAsStringAsync());
        Assert.Equal((2, 2), await CountsAsync(operatorClient, survey.Id));
    }

    [Fact]
    public async Task Somebody_who_has_not_finished_has_nothing_to_exclude()
    {
        var (operatorClient, survey, _, _, _) = await AnsweredAsync();
        var (_, halfway) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await _harness.SeedResponseAsync(survey.Id, _companyId, halfway, isComplete: false);

        var response = await ExcludeAsync(operatorClient, survey.Id, halfway);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("exclusion_no_response", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// An excluded answer is still a stored answer, and deleting the survey would delete it.
    /// </summary>
    [Fact]
    public async Task A_survey_whose_only_response_is_excluded_still_cannot_be_deleted()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var (_, person) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(operatorClient, SurveyTestHarness.MinimalRequest(_companyId));
        (await SurveyTestHarness.SetStatusAsync(operatorClient, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await _harness.SeedResponseAsync(survey.Id, _companyId, person);
        (await ExcludeAsync(operatorClient, survey.Id, person)).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(operatorClient, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        var response = await operatorClient.DeleteAsync($"/surveys/{survey.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("survey_delete_has_responses", await response.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// An anonymous survey's answers carry no user id. A signed-in respondent's response is
    /// written under the derived resume id, and that is how it is found -- the same key the roster
    /// reads their state by.
    /// </summary>
    [Fact]
    public async Task On_an_anonymous_survey_the_response_is_found_by_the_derived_resume_id()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var (_, person) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var request = SurveyTestHarness.MinimalRequest(_companyId) with { Settings = new SurveySettingsInput(Anonymous: true) };
        var survey = await SurveyTestHarness.CreateSurveyAsync(operatorClient, request);
        (await SurveyTestHarness.SetStatusAsync(operatorClient, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var key = SurveyResumeSessionConfiguration.KeyFrom(_harness.Factory.Services.GetRequiredService<IConfiguration>());
        var derived = SurveyResumeSession.IdFor(survey.Id, person, key)!;
        await _harness.WithDbAsync(async db =>
        {
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                CompanyId = _companyId,
                UserId = null,
                SessionId = derived,
                IsComplete = true,
                IsAnonymous = true,
                StartTime = DateTimeOffset.UtcNow,
                CompletionTime = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            var stored = await db.Surveys.FirstAsync(s => s.Id == survey.Id);
            stored.ResponseCount += 1;
            await db.SaveChangesAsync();
        });

        var response = await ExcludeAsync(operatorClient, survey.Id, person);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((0, 0), await CountsAsync(operatorClient, survey.Id));
        Assert.True((await RosterRowAsync(operatorClient, survey.Id, person)).GetProperty("excludedFromResults").GetBoolean());
    }

    /// <summary>
    /// Erasure must reach every response a person has, excluded or not: the query filter would
    /// otherwise hide exactly the row a subject asked to have anonymised.
    /// </summary>
    [Fact]
    public async Task An_erasure_still_anonymises_an_excluded_response()
    {
        var (operatorClient, survey, finished, _, _) = await AnsweredAsync();
        var clientAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        (await ExcludeAsync(operatorClient, survey.Id, finished)).EnsureSuccessStatusCode();

        var erased = await clientAdmin.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(finished, true));

        Assert.Equal(HttpStatusCode.OK, erased.StatusCode);
        var stillLinked = await _harness.WithDbAsync(db => db.Responses
            .IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .CountAsync(r => r.SurveyId == survey.Id && r.UserId == finished));
        Assert.Equal(0, stillLinked);
    }
}
