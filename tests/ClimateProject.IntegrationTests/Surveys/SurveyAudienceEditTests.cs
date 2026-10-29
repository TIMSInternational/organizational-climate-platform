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

    /// <summary>
    /// The defect this group was extended for. `TargetAudienceCount` is what every
    /// participation RATE divides by, and "Editar audiencia" sends `userIds` ALONE -- so
    /// before this, taking somebody off a survey left the rate dividing by the old audience
    /// for ever. October compensated by posting the number by hand from a shell script
    /// (`quitar-teletrabajo-6.sh`: "targetAudienceCount rides along ... so the results'
    /// response rate divides by 234, not 240").
    /// </summary>
    [Fact]
    public async Task Taking_one_person_off_a_live_survey_recounts_what_the_rate_divides_by()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                UserIds = [_personAId, _personBId],
                TargetAudienceCount = 2,
            });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        Assert.Equal(2, survey.TargetAudienceCount);

        // Exactly the body the dialog sends: the surviving ids and nothing else.
        var response = await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(UserIds: [_personAId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal(1, detail.TargetAudienceCount);
        Assert.Equal(
            1,
            await _harness.WithDbAsync(async db => (await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == survey.Id)).TargetAudienceCount));
        var entry = Assert.Single(await UpdatedEntriesAsync(survey.Id));
        Assert.Contains("targetAudienceCount", entry!.Fields ?? []);
    }

    /// <summary>
    /// The recount must be the audience RULE, not the length of the list it was handed.
    ///
    /// <para>
    /// Clearing both kinds of target makes a survey company-wide, so the correct denominator
    /// is the company's ACTIVE headcount while `userIds` is empty -- the two numbers cannot be
    /// confused for each other. `SurveyQueries.Audience` is where that rule lives, and its own
    /// remarks record that it had been written out four times and the fourth had already
    /// drifted; counting the request's ids here would have been a fifth copy.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_recount_is_the_audience_rule_not_the_length_of_the_list()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId], TargetAudienceCount = 1 });
        await _harness.WithDbAsync(async db =>
        {
            var person = await db.Users.FirstAsync(u => u.Id == _personBId);
            person.IsActive = false;
            return await db.SaveChangesAsync();
        });
        var (active, total) = await _harness.WithDbAsync(async db => (
            await db.Users.CountAsync(u => u.CompanyId == _companyId && u.IsActive),
            await db.Users.CountAsync(u => u.CompanyId == _companyId)));

        // No targets of either kind: the survey is now aimed at the whole company.
        var response = await admin.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new UpdateSurveyRequest(DepartmentIds: [], UserIds: []));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Empty(detail.UserIds);
        Assert.Equal(active, detail.TargetAudienceCount);
        // The deactivated person is on the roll and out of the audience, so the rule is doing
        // something the headcount alone would not -- without this the assertion above would
        // pass against a count that ignored `IsActive`.
        Assert.True(total > active, $"expected an inactive person to exist: {total} on the roll, {active} active");
    }

    /// <summary>
    /// The other half of the rule. `TargetAudienceCount` is genuinely nullable and `null` is a
    /// stored MEANING -- "there is nothing to measure against", which the list passes through
    /// as an em dash rather than printing a false 0 % (`surveyParticipationPercent`). Moving
    /// the audience of a survey that never declared a figure must not start declaring one:
    /// this corrects a denominator that has become wrong, it does not invent one.
    /// </summary>
    [Fact]
    public async Task A_survey_that_declared_no_audience_count_still_declares_none()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId, _personBId] });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        Assert.Null(survey.TargetAudienceCount);

        var response = await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(UserIds: [_personAId]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Null(detail.TargetAudienceCount);
        var entry = Assert.Single(await UpdatedEntriesAsync(survey.Id));
        Assert.DoesNotContain("targetAudienceCount", entry!.Fields ?? []);
    }

    /// <summary>
    /// An author who states the figure keeps it. A roster being imported in batches, or a
    /// cohort part of which answers on paper, has a denominator the resolved audience does
    /// not know -- which is why the recount only fills a number nobody sent.
    /// </summary>
    [Fact]
    public async Task An_explicitly_sent_audience_count_still_wins()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId, _personBId], TargetAudienceCount = 2 });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await admin.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new UpdateSurveyRequest(UserIds: [_personAId], TargetAudienceCount: 240));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal(240, detail.TargetAudienceCount);
    }

    /// <summary>
    /// A request that does not touch the targets does not touch the count. The three narrow
    /// settings PUTs the detail page sends (`setSurveySelfDeclaredDemographics` and its two
    /// siblings) are legal on a live survey, and a declared denominator must survive them.
    /// </summary>
    [Fact]
    public async Task A_settings_only_update_leaves_a_declared_audience_count_alone()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with { UserIds = [_personAId], TargetAudienceCount = 240 });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await admin.PutAsJsonAsync(
            $"/surveys/{survey.Id}",
            new UpdateSurveyRequest(Settings: new SurveySettingsInput(SelfDeclaredDemographics: true)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal(240, detail.TargetAudienceCount);
    }
}
