using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>POST /surveys/{id}/credentials/{userId}/remind</c> -- the chase that mints nothing, asked
/// for by ESPH on 2026-10-30: *"hay forma de enviar recordatorio? no otro usuario o contraseña
/// solo recordatorio?"*.
///
/// <para>
/// The population this route exists for is the one <c>reissue</c> REFUSES: somebody who has
/// already signed in and is part-way through. So the central test signs in first, reminds, and
/// then signs in AGAIN with the same password -- the proof that the reminder disturbed nothing
/// is that the original pair still opens the survey, which a hash comparison could not establish
/// and which is the whole reason the client could not be served before.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyCredentialRemindTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"rem-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        await WithDbAsync(async db =>
        {
            var company = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Servicio Público de Heredia",
                EmailDomain = _domain,
                CreatedAt = DateTimeOffset.UtcNow,
                Settings = new CompanySettings
                {
                    Language = "es",
                    CredentialMode = CredentialModes.PerSurvey,
                    Timezone = "America/Costa_Rica",
                },
            };
            db.Companies.Add(company);
            _companyId = company.Id;
            await db.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        });

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client, string? credentialMode = null)
    {
        var request = SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both("Clima", "Clima"));
        if (credentialMode is not null)
        {
            request = request with { Settings = new SurveySettingsInput(CredentialMode: credentialMode) };
        }

        var created = await SurveyTestHarness.CreateSurveyAsync(client, request);
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private async Task<(Guid Id, string Email)> SeedEmployeeAsync()
    {
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var id = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                Id = id,
                CompanyId = _companyId,
                Email = email,
                Name = "Persona",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        return (id, email);
    }

    private static async Task InviteAsync(HttpClient admin, Guid surveyId, Guid userId)
        => (await admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(UserIds: [userId])))
            .EnsureSuccessStatusCode();

    private static Task<HttpResponseMessage> RemindAsync(HttpClient admin, Guid surveyId, Guid userId)
        => admin.PostAsync($"/surveys/{surveyId}/credentials/{userId}/remind", content: null);

    private async Task<HttpStatusCode> SignInAsync(string username, string password)
        => (await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(username, password))).StatusCode;

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(code, body.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("message").GetString()));
    }

    private async Task<(HttpClient Admin, SurveyDetail Survey, Guid UserId, string Email, SentCredentials Key)> InvitedAsync()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var (userId, email) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, userId);
        return (admin, survey, userId, email, Assert.Single(_factory.Sent, m => m.ToEmail == email));
    }

    // ---------------------------------------------------------------- the point of the route

    [Fact]
    public async Task Reminding_somebody_mid_survey_leaves_the_password_they_are_using_working()
    {
        var (admin, survey, userId, email, key) = await InvitedAsync();

        // They sign in, which is what makes reissue refuse them from here on.
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(key.Username, key.Password));

        var response = await RemindAsync(admin, survey.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialRemindResult>())!;
        Assert.True(result.Delivered);
        Assert.Null(result.FailureReason);
        Assert.Equal(key.Username, result.Username);

        // The proof, and the whole requirement: the pair in their inbox still opens the survey.
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(key.Username, key.Password));

        // And no second credentials mail went out -- the reminder is not a reissue in disguise.
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task Reissue_refuses_the_very_person_this_route_serves()
    {
        // The contrast that says why the route had to exist. Not a restatement of the reissue
        // suite: it asserts the two routes disagree about ONE person in ONE state.
        var (admin, survey, userId, _, key) = await InvitedAsync();
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(key.Username, key.Password));

        await AssertRefusedAsync(
            await admin.PostAsync($"/surveys/{survey.Id}/credentials/{userId}/reissue", content: null),
            HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.AlreadySignedIn);

        Assert.Equal(HttpStatusCode.OK, (await RemindAsync(admin, survey.Id, userId)).StatusCode);
    }

    [Fact]
    public async Task The_reminder_names_the_survey_and_carries_the_username_but_no_password_field()
    {
        var (admin, survey, userId, email, key) = await InvitedAsync();

        (await RemindAsync(admin, survey.Id, userId)).EnsureSuccessStatusCode();

        var reminder = Assert.Single(_factory.Reminders, r => r.ToEmail == email);
        Assert.Equal(key.Username, reminder.Username);
        Assert.Equal("Clima", reminder.SurveyName);
        Assert.Equal("es", reminder.Language);
        Assert.Equal("Servicio Público de Heredia", reminder.CompanyName);
    }

    // ---------------------------------------------------------------- refusals

    [Fact]
    public async Task Somebody_who_already_finished_is_refused()
    {
        // Two of ESPH's seven had finished between the report being read and the request
        // arriving. Saying so beats a silent no-op, and beats chasing somebody who complied.
        var (admin, survey, userId, _, _) = await InvitedAsync();
        await WithDbAsync(async db =>
        {
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                UserId = userId,
                CompanyId = _companyId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "es",
                IsComplete = true,
                StartTime = DateTimeOffset.UtcNow.AddMinutes(-10),
                CompletionTime = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        await AssertRefusedAsync(
            await RemindAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRemindRefusals.AlreadyCompleted);
    }

    [Fact]
    public async Task A_part_finished_response_is_NOT_a_refusal()
    {
        // The difference between `has_responses` (revoke's bar) and `already_completed` (this
        // one's). Somebody half-way through is precisely who gets reminded.
        var (admin, survey, userId, _, _) = await InvitedAsync();
        await WithDbAsync(async db =>
        {
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                UserId = userId,
                CompanyId = _companyId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "es",
                IsComplete = false,
                StartTime = DateTimeOffset.UtcNow.AddMinutes(-10),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.OK, (await RemindAsync(admin, survey.Id, userId)).StatusCode);
    }

    [Fact]
    public async Task Somebody_who_holds_no_key_is_refused()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var (userId, _) = await SeedEmployeeAsync();

        await AssertRefusedAsync(
            await RemindAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRemindRefusals.NoCredential);
    }

    [Fact]
    public async Task A_deactivated_account_is_refused()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();
        await WithDbAsync(async db =>
        {
            var person = await db.Users.FirstAsync(u => u.Id == userId);
            person.IsActive = false;
            await db.SaveChangesAsync();
        });

        await AssertRefusedAsync(
            await RemindAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRemindRefusals.UserInactive);
    }

    [Fact]
    public async Task A_survey_that_is_no_longer_collecting_is_refused()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();
        // `closed`, not `completed`: the statuses are draft/scheduled/active/closed/archived,
        // and RespondentVisible is [Scheduled, Active] -- so closed is what the endpoint refuses.
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        await AssertRefusedAsync(
            await RemindAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRemindRefusals.SurveyNotOpen);
    }

    [Fact]
    public async Task A_shared_mode_survey_is_refused()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var (userId, _) = await SeedEmployeeAsync();

        await AssertRefusedAsync(
            await RemindAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRemindRefusals.NotPerSurvey);
    }

    [Fact]
    public async Task A_failed_send_is_reported_without_changing_anything()
    {
        var (admin, survey, userId, email, key) = await InvitedAsync();
        _factory.FailFor.Add(email);

        var response = await RemindAsync(admin, survey.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialRemindResult>())!;
        Assert.False(result.Delivered);
        Assert.False(string.IsNullOrWhiteSpace(result.FailureReason));

        // Nothing to restore, because nothing was written: their key still works.
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(key.Username, key.Password));
    }
}
