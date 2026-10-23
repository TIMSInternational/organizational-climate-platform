using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Audit G14, the update half: once a survey has ENDED (closed or archived), who it was sent
/// to (<c>userIds</c>) and which service it metered (<c>serviceType</c>) are history.
/// <c>PUT /surveys/{id}</c> accepted both with a 200 because neither is in
/// <c>touchesContent</c> nor in <c>touchesSchedule</c>; it now refuses with a 400 carrying
/// <c>survey_ended_audience_frozen</c>. A live survey keeps both, which the controls pin.
/// </summary>
[Collection("Postgres")]
public class SurveyEndedAudienceTests : IAsyncLifetime
{
    private const string FrozenCode = "survey_ended_audience_frozen";

    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _personA;
    private Guid _personB;

    public SurveyEndedAudienceTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"ended-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Ended Audience Co");
        (_, _personA) = await _harness.IdentifiedTokenAsync(Roles.Employee, _companyId);
        (_, _personB) = await _harness.IdentifiedTokenAsync(Roles.Employee, _companyId);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpClient Client, Guid SurveyId)> SurveyInAsync(string status)
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                UserIds = [_personA],
                ServiceType = ClimateServiceTypes.GeneralClimate,
            });

        foreach (var step in status switch
                 {
                     SurveyStatuses.Draft => Array.Empty<string>(),
                     SurveyStatuses.Active => [SurveyStatuses.Active],
                     SurveyStatuses.Closed => [SurveyStatuses.Active, SurveyStatuses.Closed],
                     SurveyStatuses.Archived => [SurveyStatuses.Active, SurveyStatuses.Closed, SurveyStatuses.Archived],
                     _ => throw new ArgumentOutOfRangeException(nameof(status)),
                 })
        {
            (await SurveyTestHarness.SetStatusAsync(client, survey.Id, step)).EnsureSuccessStatusCode();
        }

        return (client, survey.Id);
    }

    private static async Task AssertFrozenAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(FrozenCode, body.RootElement.GetProperty("code").GetString());
    }

    private Task<List<Guid>> TargetsAsync(Guid surveyId)
        => _harness.WithDbAsync(db => db.SurveyUserTargets
            .Where(t => t.SurveyId == surveyId)
            .Select(t => t.UserId)
            .ToListAsync());

    private Task<string?> ServiceTypeAsync(Guid surveyId)
        => _harness.WithDbAsync(db => db.Surveys.Where(s => s.Id == surveyId).Select(s => s.ServiceType).FirstAsync());

    [Theory]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public async Task An_ended_survey_refuses_a_new_set_of_named_people_and_keeps_its_own(string status)
    {
        var (client, surveyId) = await SurveyInAsync(status);

        var response = await client.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(UserIds: [_personB]));

        await AssertFrozenAsync(response);
        Assert.Equal([_personA], await TargetsAsync(surveyId));
    }

    [Theory]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public async Task An_ended_survey_refuses_an_empty_list_which_would_widen_it_to_the_whole_company(string status)
    {
        var (client, surveyId) = await SurveyInAsync(status);

        var response = await client.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(UserIds: []));

        await AssertFrozenAsync(response);
        Assert.Equal([_personA], await TargetsAsync(surveyId));
    }

    [Theory]
    [InlineData(SurveyStatuses.Closed, ClimateServiceTypes.OrganizationalCulture)]
    [InlineData(SurveyStatuses.Closed, "")]
    [InlineData(SurveyStatuses.Archived, ClimateServiceTypes.OrganizationalCulture)]
    public async Task An_ended_survey_refuses_a_change_of_service_including_clearing_it(string status, string serviceType)
    {
        var (client, surveyId) = await SurveyInAsync(status);

        var response = await client.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(ServiceType: serviceType));

        await AssertFrozenAsync(response);
        Assert.Equal(ClimateServiceTypes.GeneralClimate, await ServiceTypeAsync(surveyId));
    }

    // ------------------------------------------------------------------
    // Controls: the guard is scoped to ended surveys, not to the fields.
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(SurveyStatuses.Draft)]
    [InlineData(SurveyStatuses.Active)]
    public async Task A_survey_that_has_not_ended_still_takes_new_named_people_and_a_service(string status)
    {
        var (client, surveyId) = await SurveyInAsync(status);

        var response = await client.PutAsJsonAsync(
            $"/surveys/{surveyId}",
            new UpdateSurveyRequest(UserIds: [_personA, _personB], ServiceType: ClimateServiceTypes.OrganizationalCulture));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new[] { _personA, _personB }.Order(), (await TargetsAsync(surveyId)).Order());
        Assert.Equal(ClimateServiceTypes.OrganizationalCulture, await ServiceTypeAsync(surveyId));
    }
}
