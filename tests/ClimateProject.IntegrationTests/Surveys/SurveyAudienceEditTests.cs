using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// "Editar audiencia" on the survey detail page (G14 follow-up) rewrites a live survey's named
/// people with <c>PUT /surveys/{id} {userIds}</c>. The dialog states four things before it saves;
/// these tests pin each of them against the API rather than against the dialog's prose:
///
/// <list type="bullet">
/// <item>the change is RECORDED: <c>userIds</c> is not in the version snapshot, so until this lane
/// the content diff saw nothing and a live survey's audience could be rewritten with no history
/// entry at all;</item>
/// <item>a person taken off can no longer open the survey, and a person added can;</item>
/// <item>nobody is notified: no notification row and no invitation is written;</item>
/// <item>departments move only on a draft: on a live survey they are content (409).</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class SurveyAudienceEditTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private HttpClient _personA = null!;
    private Guid _personAId;
    private HttpClient _personB = null!;
    private Guid _personBId;

    public SurveyAudienceEditTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"audience-edit-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Audience Edit Co");
        (_personA, _personAId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        (_personB, _personBId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>An ACTIVE survey aimed at person A by name.</summary>
    private async Task<(HttpClient Admin, Guid SurveyId)> ActiveSurveyForAAsync()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId] });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return (admin, survey.Id);
    }

    private Task<List<SurveyAuditChangeSet?>> UpdatedEntriesAsync(Guid surveyId)
        => _harness.WithDbAsync(async db => (await db.SurveyAuditLogs
                .AsNoTracking()
                .Where(a => a.SurveyId == surveyId && a.Action == SurveyAuditActions.Updated)
                .Select(a => a.Changes)
                .ToListAsync())
            .Select(SurveyAuditChangeSet.FromJson)
            .ToList());

    [Fact]
    public async Task Changing_a_live_surveys_named_people_is_recorded_in_its_history()
    {
        var (admin, surveyId) = await ActiveSurveyForAAsync();

        var response = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(UserIds: [_personAId, _personBId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entry = Assert.Single(await UpdatedEntriesAsync(surveyId));
        Assert.NotNull(entry);
        Assert.Contains("userIds", entry!.Fields ?? []);
    }

    [Fact]
    public async Task Resending_the_same_people_in_another_order_records_nothing()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId, _personBId] });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await admin.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new UpdateSurveyRequest(UserIds: [_personBId, _personAId, _personBId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await UpdatedEntriesAsync(survey.Id));
    }

    [Fact]
    public async Task A_person_taken_off_a_live_survey_loses_it_and_a_person_added_gains_it()
    {
        var (admin, surveyId) = await ActiveSurveyForAAsync();
        Assert.Equal(HttpStatusCode.OK, (await _personA.GetAsync($"/surveys/{surveyId}/respond")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await _personB.GetAsync($"/surveys/{surveyId}/respond")).StatusCode);

        var response = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(UserIds: [_personBId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await _personA.GetAsync($"/surveys/{surveyId}/respond")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _personB.GetAsync($"/surveys/{surveyId}/respond")).StatusCode);
    }

    [Fact]
    public async Task Changing_a_live_surveys_people_notifies_nobody_and_invites_nobody()
    {
        var (admin, surveyId) = await ActiveSurveyForAAsync();
        var notificationsBefore = await _harness.WithDbAsync(db => db.Notifications.CountAsync(n => n.CompanyId == _companyId));
        var invitationsBefore = await _harness.WithDbAsync(db => db.SurveyInvitations.CountAsync(i => i.SurveyId == surveyId));

        var response = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(UserIds: [_personAId, _personBId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(notificationsBefore, await _harness.WithDbAsync(db => db.Notifications.CountAsync(n => n.CompanyId == _companyId)));
        Assert.Equal(invitationsBefore, await _harness.WithDbAsync(db => db.SurveyInvitations.CountAsync(i => i.SurveyId == surveyId)));
    }

    [Fact]
    public async Task A_live_surveys_departments_are_content_and_are_refused()
    {
        var department = await _harness.SeedDepartmentAsync(_companyId, "Ventas");
        var (admin, surveyId) = await ActiveSurveyForAAsync();

        var response = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(DepartmentIds: [department]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db => db.SurveyDepartmentTargets.Where(t => t.SurveyId == surveyId).ToListAsync()));
    }

    [Fact]
    public async Task A_drafts_departments_and_people_change_together_and_are_recorded()
    {
        var department = await _harness.SeedDepartmentAsync(_companyId, "Operaciones");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId] });

        var response = await admin.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new UpdateSurveyRequest(DepartmentIds: [department], UserIds: []));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal([department], detail.DepartmentIds);
        Assert.Empty(detail.UserIds);
        var entry = Assert.Single(await UpdatedEntriesAsync(survey.Id));
        Assert.Equal(new[] { "departmentIds", "userIds" }, (entry!.Fields ?? []).Order());
    }
}
