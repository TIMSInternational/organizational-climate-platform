using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// «Duplicar» → «Solo las preguntas» (asked by Federico, 2026-11-18): the copy keeps its questions
/// and settings and leaves the people behind -- and is then aimed at NOBODY, never at everyone.
/// An empty target set is the whole company (<c>SurveyQueries.Audience</c>), so a copy without
/// targets and without <c>surveys.audience_not_chosen</c> would be the 28 Oct 2026 incident
/// waiting to happen. Read off the rows the product wrote, the mail it captured and the codes
/// it answered.
/// </summary>
[Collection("Postgres")]
public class SurveyAudienceNotChosenTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"anc-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _comercio;
    private Guid _finanzas;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "PROCOMER DEMO",
            EmailDomain = _domain,
            CreatedAt = now,
            Settings = new CompanySettings { Language = "es", CredentialMode = CredentialModes.Shared },
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        _comercio = Guid.NewGuid();
        _finanzas = Guid.NewGuid();
        db.Departments.Add(new Department { Id = _comercio, CompanyId = _companyId, Name = "Comercio", IsActive = true, CreatedAt = now, UpdatedAt = now });
        db.Departments.Add(new Department { Id = _finanzas, CompanyId = _companyId, Name = "Finanzas", IsActive = true, CreatedAt = now, UpdatedAt = now });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------ helpers

    private async Task<HttpClient> ClientAsync(string role, Guid? department = null)
    {
        var client = _factory.CreateClient();
        var email = $"{role}-{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Persona", email, "A-good-passw0rd"))).EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = role == Roles.SuperAdmin ? null : _companyId;
            user.DepartmentId = department;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<(Guid Id, string Email)> SeedPersonAsync(Guid department)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), CompanyId = _companyId, DepartmentId = department, Email = email,
            Name = "Persona", Role = Roles.Employee, IsActive = true, CreatedAt = now, UpdatedAt = now,
        });
        await db.SaveChangesAsync();
        return (await WithDbAsync(d => d.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync()), email);
    }

    /// <summary>An ACTIVE source survey in <paramref name="mode"/>, aimed at Comercio and at <paramref name="named"/> by name.</summary>
    private async Task<SurveyDetail> SourceAsync(HttpClient admin, string mode, params Guid[] named)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId, departmentIds: [_comercio]) with
            {
                UserIds = [.. named],
                Settings = new SurveySettingsInput(Anonymous: true, CredentialMode: mode, RandomizeQuestions: true),
            });
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private static async Task<SurveyDetail> DuplicateAsync(HttpClient admin, Guid surveyId, string body)
    {
        var response = await admin.PostAsync(
            $"/surveys/{surveyId}/duplicate", new StringContent(body, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    private static Task<SurveyDetail> QuestionsOnlyAsync(HttpClient admin, Guid surveyId)
        => DuplicateAsync(admin, surveyId, """{"includeAudience":false}""");

    private static async Task AssertAudienceNotChosenAsync(HttpResponseMessage response, string route)
    {
        Assert.True(response.StatusCode == HttpStatusCode.Conflict, $"{route}: {(int)response.StatusCode}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("survey_audience_not_chosen", body.GetProperty("code").GetString());
    }

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = _factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private Task<List<Guid>> AudienceAsync(Guid surveyId) => WithDbAsync(db => SurveyQueries
        .Audience(db.Users.AsNoTracking(), db.Surveys.AsNoTracking(), db.SurveyDepartmentTargets, db.SurveyUserTargets, surveyId, _companyId)
        .Select(u => u.Id)
        .ToListAsync());

    private Task<List<SurveyAuditLog>> AuditAsync(Guid surveyId) => WithDbAsync(db => db.SurveyAuditLogs.AsNoTracking()
        .Where(l => l.SurveyId == surveyId)
        .OrderBy(l => l.Timestamp)
        .ToListAsync());

    // ------------------------------------------------------------------ the copy

    [Fact]
    public async Task A_questions_only_copy_has_no_targets_carries_the_marker_and_its_audience_is_nobody()
    {
        var admin = await ClientAsync(Roles.CompanyAdmin);
        var ana = await SeedPersonAsync(_finanzas);
        await SeedPersonAsync(_comercio);
        var source = await SourceAsync(admin, CredentialModes.PersonalLink, ana.Id);
        Assert.NotEmpty(await AudienceAsync(source.Id));

        var copy = await QuestionsOnlyAsync(admin, source.Id);

        Assert.True(copy.AudienceNotChosen);
        Assert.Empty(copy.DepartmentIds);
        Assert.Empty(copy.UserIds);
        Assert.Null(copy.TargetAudienceCount);
        Assert.Equal(SurveyStatuses.Draft, copy.Status);
        // The status buttons are driven by this list: the two moves the server refuses are not offered.
        Assert.DoesNotContain(SurveyStatuses.Active, copy.AllowedStatusTransitions);
        Assert.DoesNotContain(SurveyStatuses.Scheduled, copy.AllowedStatusTransitions);
        // Only the people differ: the mode and randomisation travel.
        Assert.Equal(CredentialModes.PersonalLink, copy.Settings.CredentialMode);
        Assert.True(copy.Settings.RandomizeQuestions);
        Assert.Equal(source.Questions.Count, copy.Questions.Count);

        Assert.False(await WithDbAsync(db => db.SurveyDepartmentTargets.AnyAsync(t => t.SurveyId == copy.Id)));
        Assert.False(await WithDbAsync(db => db.SurveyUserTargets.AnyAsync(t => t.SurveyId == copy.Id)));
        Assert.True(await WithDbAsync(db => db.Surveys.Where(s => s.Id == copy.Id).Select(s => s.AudienceNotChosen).SingleAsync()));

        // No targets of either kind, in a company with active people -- and nobody, not everyone.
        Assert.True(await WithDbAsync(db => db.Users.CountAsync(u => u.CompanyId == _companyId && u.IsActive)) > 2);
        Assert.Empty(await AudienceAsync(copy.Id));
        var roster = (await admin.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{copy.Id}/participation"))!;
        Assert.Empty(roster.Roster);

        // Its history starts by saying the audience was left unchosen.
        var created = Assert.Single(await AuditAsync(copy.Id), l => l.Action == SurveyAuditActions.Created);
        Assert.Equal(["audienceNotChosen"], SurveyAuditChangeSet.FromJson(created.Changes)!.Fields);
    }

    [Fact]
    public async Task Including_the_audience_or_saying_nothing_is_todays_copy()
    {
        var admin = await ClientAsync(Roles.CompanyAdmin);
        var ana = await SeedPersonAsync(_finanzas);
        var source = await SourceAsync(admin, CredentialModes.Shared, ana.Id);

        foreach (var body in new[] { "{}", """{"includeAudience":true}""" })
        {
            var copy = await DuplicateAsync(admin, source.Id, body);

            Assert.False(copy.AudienceNotChosen);
            Assert.Equal([_comercio], copy.DepartmentIds);
            Assert.Equal([ana.Id], copy.UserIds);
            Assert.Equal((await AudienceAsync(source.Id)).Order(), (await AudienceAsync(copy.Id)).Order());
            var created = Assert.Single(await AuditAsync(copy.Id), l => l.Action == SurveyAuditActions.Created);
            Assert.Null(created.Changes);
        }
    }

    // ------------------------------------------------------------------ nothing mails or admits

    /// <summary>
    /// Every route that mails or admits people refuses the copy with 409
    /// <c>survey_audience_not_chosen</c>, in every credential mode -- invitations to the whole
    /// audience or to one named person, a link resend, a key reissue, an in-person handover, a
    /// reminder -- and so does scheduling or activating it. Nothing is written and nothing is mailed.
    /// </summary>
    [Fact]
    public async Task Every_route_that_mails_or_admits_people_refuses_a_survey_whose_audience_was_not_chosen()
    {
        var admin = await ClientAsync(Roles.CompanyAdmin);
        var tims = await ClientAsync(Roles.SuperAdmin);
        var ana = await SeedPersonAsync(_comercio);

        foreach (var mode in new[] { CredentialModes.Shared, CredentialModes.PerSurvey, CredentialModes.PersonalLink })
        {
            var source = await SourceAsync(admin, mode, ana.Id);
            var copy = await QuestionsOnlyAsync(admin, source.Id);

            await AssertAudienceNotChosenAsync(
                await admin.PostAsJsonAsync($"/surveys/{copy.Id}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true)),
                $"{mode} invite everyone");
            await AssertAudienceNotChosenAsync(
                await admin.PostAsJsonAsync($"/surveys/{copy.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [ana.Id])),
                $"{mode} invite one");
            await AssertAudienceNotChosenAsync(
                await admin.PostAsJsonAsync($"/surveys/{copy.Id}/invitations", new CreateSurveyInvitationsRequest(DepartmentIds: [_comercio])),
                $"{mode} invite a department");
            await AssertAudienceNotChosenAsync(
                await admin.PostAsync($"/surveys/{copy.Id}/invitations/{Guid.NewGuid()}/resend", null),
                $"{mode} resend a link");
            await AssertAudienceNotChosenAsync(
                await admin.PostAsync($"/surveys/{copy.Id}/credentials/{ana.Id}/reissue", null),
                $"{mode} reissue a key");
            await AssertAudienceNotChosenAsync(
                await tims.PostAsJsonAsync(
                    $"/surveys/{copy.Id}/credentials/{ana.Id}/reissue",
                    new SurveyCredentialReissueRequest(SurveyCredentialDeliveries.Handover)),
                $"{mode} hand a key over");
            await AssertAudienceNotChosenAsync(
                await admin.PostAsync($"/surveys/{copy.Id}/credentials/{ana.Id}/remind", null),
                $"{mode} remind");
            await AssertAudienceNotChosenAsync(
                await SurveyTestHarness.SetStatusAsync(admin, copy.Id, SurveyStatuses.Scheduled), $"{mode} schedule");
            await AssertAudienceNotChosenAsync(
                await SurveyTestHarness.SetStatusAsync(admin, copy.Id, SurveyStatuses.Active), $"{mode} activate");

            Assert.Equal(SurveyStatuses.Draft, await WithDbAsync(db => db.Surveys.Where(s => s.Id == copy.Id).Select(s => s.Status).SingleAsync()));
            Assert.False(await WithDbAsync(db => db.SurveyInvitations.AnyAsync(i => i.SurveyId == copy.Id)));
            Assert.False(await WithDbAsync(db => db.SurveyCredentials.AnyAsync(c => c.SurveyId == copy.Id)));
        }

        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == ana.Email);
        Assert.DoesNotContain(_factory.Links, l => l.ToEmail == ana.Email);
        Assert.DoesNotContain(_factory.Reminders, r => r.ToEmail == ana.Email);
    }

    /// <summary>
    /// The marker cannot coexist with an active survey (the status change refuses), so this sets
    /// it directly on one to prove the respond gates read it: nobody signed in is admitted and
    /// nobody's inbox lists it -- not the whole company an empty target set would otherwise be.
    /// </summary>
    [Fact]
    public async Task A_survey_whose_audience_was_not_chosen_admits_and_lists_nobody()
    {
        var admin = await ClientAsync(Roles.CompanyAdmin);
        var created = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId));
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var employee = await ClientAsync(Roles.Employee, _comercio);
        Assert.Equal(HttpStatusCode.OK, (await employee.GetAsync($"/surveys/{created.Id}/respond")).StatusCode);
        Assert.Contains((await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my"))!.Surveys, s => s.Id == created.Id);

        await WithDbAsync(async db =>
        {
            var survey = await db.Surveys.SingleAsync(s => s.Id == created.Id);
            survey.AudienceNotChosen = true;
            return await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/{created.Id}/respond")).StatusCode);
        Assert.DoesNotContain((await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my"))!.Surveys, s => s.Id == created.Id);
        Assert.Empty(await AudienceAsync(created.Id));
    }

    // ------------------------------------------------------------------ choosing it

    /// <summary>
    /// «Editar audiencia» saving ANY selection clears the marker -- an explicit «Toda la empresa»
    /// (both lists empty) included -- and it is audited like every audience edit. A save that does
    /// not touch the targets leaves it set. Once chosen, the copy is a survey like any other.
    /// </summary>
    [Fact]
    public async Task Saving_any_audience_clears_the_marker_whole_company_included_and_is_audited()
    {
        var admin = await ClientAsync(Roles.CompanyAdmin);
        var ana = await SeedPersonAsync(_finanzas);
        var source = await SourceAsync(admin, CredentialModes.Shared, ana.Id);

        var everyone = await QuestionsOnlyAsync(admin, source.Id);
        var renamed = await admin.PutAsJsonAsync($"/surveys/{everyone.Id}", new UpdateSurveyRequest(Title: Spanish("Copia renombrada")));
        Assert.True((await renamed.Content.ReadFromJsonAsync<SurveyDetail>())!.AudienceNotChosen);

        var chosen = await admin.PutAsJsonAsync($"/surveys/{everyone.Id}", new UpdateSurveyRequest(DepartmentIds: [], UserIds: []));
        Assert.Equal(HttpStatusCode.OK, chosen.StatusCode);
        var chosenDetail = (await chosen.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.False(chosenDetail.AudienceNotChosen);
        Assert.Contains(SurveyStatuses.Active, chosenDetail.AllowedStatusTransitions);
        var companyPeople = await WithDbAsync(db => db.Users.Where(u => u.CompanyId == _companyId && u.IsActive).Select(u => u.Id).ToListAsync());
        Assert.Equal(companyPeople.Order(), (await AudienceAsync(everyone.Id)).Order());
        var updated = (await AuditAsync(everyone.Id)).Where(l => l.Action == SurveyAuditActions.Updated).ToList();
        Assert.Contains(updated, l => SurveyAuditChangeSet.FromJson(l.Changes)!.Fields!.Contains("audienceNotChosen"));
        Assert.Equal(HttpStatusCode.OK, (await SurveyTestHarness.SetStatusAsync(admin, everyone.Id, SurveyStatuses.Active)).StatusCode);

        var onePerson = await QuestionsOnlyAsync(admin, source.Id);
        var named = await admin.PutAsJsonAsync($"/surveys/{onePerson.Id}", new UpdateSurveyRequest(UserIds: [ana.Id]));
        Assert.False((await named.Content.ReadFromJsonAsync<SurveyDetail>())!.AudienceNotChosen);
        Assert.Equal([ana.Id], await AudienceAsync(onePerson.Id));
    }

    private static LocalizedInput Spanish(string text) => LocalizedInput.FromBare(text);
}
