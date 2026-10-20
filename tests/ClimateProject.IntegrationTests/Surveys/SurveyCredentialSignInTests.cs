using System.Net;
using System.Text.Json;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Signing in with a per-survey credential, and the one thing that makes it worth having:
/// the session sees that survey and nothing else.
///
/// <para>
/// These seed <c>survey_credentials</c> rows directly rather than minting them through the
/// distribution route, so that sign-in and scoping are pinned independently of whatever
/// mints them. A test that went through the minting path would fail for two unrelated
/// reasons and say which only by accident.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyCredentialSignInTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public SurveyCredentialSignInTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"csi-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Credential Sign-In Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>An active, company-wide survey anyone in the company is expected to answer.</summary>
    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client, string titleEn)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(_companyId, title: LocalizedInput.FromBare(titleEn)));
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private Task<Guid> SeedEmployeeAsync(string email) => _harness.WithDbAsync(async db =>
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = email,
            Name = "Employee",
            Role = Roles.Employee,
            IsActive = true,
            // No PasswordHash and no Username: this is what a per-survey respondent is.
            // Their only way in is a credential below.
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    });

    /// <summary>Mints one, the way the distribution route will.</summary>
    private async Task<(string Username, string Password)> SeedCredentialAsync(Guid surveyId, Guid userId)
    {
        var username = MassInviteCredentials.Username(MassInviteCredentials.PrefixFor("Credential Sign-In Co"));
        var password = MassInviteCredentials.Password();
        var hash = new BcryptPasswordHasher().Hash(password);
        await _harness.WithDbAsync(async db =>
        {
            db.SurveyCredentials.Add(new SurveyCredential
            {
                SurveyId = surveyId,
                UserId = userId,
                Username = username,
                PasswordHash = hash,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });
        return (username, password);
    }

    private async Task<string> SignInAsync(string identifier, string password)
    {
        var response = await _factory.CreateClient().PostAsJsonAsync(
            "/auth/login", new { email = identifier, password });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        return body!["token"];
    }

    private HttpClient ClientFor(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task A_survey_credential_signs_in_and_the_account_has_no_password_of_its_own()
    {
        var admin = await AdminAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");
        var (username, password) = await SeedCredentialAsync(survey.Id, employee);

        var token = await SignInAsync(username, password);
        Assert.NotEmpty(token);

        // And the credential records that it arrived and was used -- on an anonymous survey
        // nothing else can tell an administrator that.
        var lastSignIn = await _harness.WithDbAsync(db => db.SurveyCredentials
            .AsNoTracking().Where(c => c.Username == username).Select(c => c.LastSignInAt).FirstAsync());
        Assert.NotNull(lastSignIn);
    }

    /// <summary>
    /// The requirement, end to end. One person, two surveys, two credentials -- and each one
    /// opens exactly one. A session that showed both would be the shared-account view the
    /// whole mode exists to avoid.
    /// </summary>
    [Fact]
    public async Task Each_credential_sees_only_its_own_survey()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima Organizacional");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");

        var climaCredential = await SeedCredentialAsync(clima.Id, employee);
        var teletrabajoCredential = await SeedCredentialAsync(teletrabajo.Id, employee);

        // Two different usernames and two different passwords, for one address.
        Assert.NotEqual(climaCredential.Username, teletrabajoCredential.Username);
        Assert.NotEqual(climaCredential.Password, teletrabajoCredential.Password);

        var climaClient = ClientFor(await SignInAsync(climaCredential.Username, climaCredential.Password));
        var climaList = await climaClient.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Equal([clima.Id], climaList!.Surveys.Select(s => s.Id).ToList());

        var teleClient = ClientFor(await SignInAsync(teletrabajoCredential.Username, teletrabajoCredential.Password));
        var teleList = await teleClient.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Equal([teletrabajo.Id], teleList!.Surveys.Select(s => s.Id).ToList());
    }

    [Fact]
    public async Task The_dashboard_counts_only_the_survey_the_session_is_for()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        await ActiveSurveyAsync(admin, "Teletrabajo");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");
        var (username, password) = await SeedCredentialAsync(clima.Id, employee);

        var client = ClientFor(await SignInAsync(username, password));
        var response = await client.GetAsync("/dashboard/employee");
        response.EnsureSuccessStatusCode();

        // Read the property out of the document rather than binding to a shape: this test
        // is about the COUNT, and binding would make it fail for every unrelated field the
        // dashboard gains.
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var pending = document.RootElement
            .EnumerateObject()
            .First(p => string.Equals(p.Name, "pendingCount", StringComparison.OrdinalIgnoreCase));

        // Two surveys exist and both target this company-wide; the session is for one.
        Assert.Equal(1, pending.Value.GetInt32());
    }

    /// <summary>
    /// A re-mint that dropped the scope would hand a respondent a token seeing every survey
    /// they are in, halfway through answering one.
    /// </summary>
    [Fact]
    public async Task Refreshing_keeps_the_session_on_its_own_survey()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        await ActiveSurveyAsync(admin, "Teletrabajo");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");
        var (username, password) = await SeedCredentialAsync(clima.Id, employee);

        var client = ClientFor(await SignInAsync(username, password));
        var refreshed = await client.PostAsync("/auth/refresh", null);
        refreshed.EnsureSuccessStatusCode();
        var body = await refreshed.Content.ReadFromJsonAsync<Dictionary<string, string>>();

        var after = ClientFor(body!["token"]);
        var list = await after.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Equal([clima.Id], list!.Surveys.Select(s => s.Id).ToList());
    }

    [Fact]
    public async Task One_surveys_password_does_not_open_another_surveys_username()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");

        var climaCredential = await SeedCredentialAsync(clima.Id, employee);
        var teletrabajoCredential = await SeedCredentialAsync(teletrabajo.Id, employee);

        var crossed = await _factory.CreateClient().PostAsJsonAsync(
            "/auth/login",
            new { email = climaCredential.Username, password = teletrabajoCredential.Password });

        Assert.Equal(HttpStatusCode.Unauthorized, crossed.StatusCode);
    }

    /// <summary>
    /// The mode is opt-in, so the account path cannot have moved. A shared respondent still
    /// sees every survey they are targeted by.
    /// </summary>
    [Fact]
    public async Task A_shared_account_still_sees_every_survey_it_is_targeted_by()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");

        var password = MassInviteCredentials.Password();
        var username = MassInviteCredentials.Username(MassInviteCredentials.PrefixFor("Credential Sign-In Co"));
        await _harness.WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@credsignin.example.com",
                Name = "Shared",
                Username = username,
                PasswordHash = new BcryptPasswordHasher().Hash(password),
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });

        var client = ClientFor(await SignInAsync(username, password));
        var list = await client.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");

        var ids = list!.Surveys.Select(s => s.Id).ToHashSet();
        Assert.Contains(clima.Id, ids);
        Assert.Contains(teletrabajo.Id, ids);
    }

    /// <summary>
    /// The listing filter is not the gate. A respondent who keeps or guesses a link to the
    /// OTHER survey must be refused by the endpoint that takes the answer, not merely find
    /// it missing from their dashboard.
    /// </summary>
    [Fact]
    public async Task A_scoped_session_cannot_answer_the_other_survey_by_link()
    {
        var admin = await AdminAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        var employee = await SeedEmployeeAsync($"{Guid.NewGuid():N}@credsignin.example.com");
        var (username, password) = await SeedCredentialAsync(clima.Id, employee);

        var client = ClientFor(await SignInAsync(username, password));

        // Its own survey answers.
        var own = await client.GetAsync($"/surveys/{clima.Id}/respond");
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);

        // The other one does not -- though both are active and company-wide, so targeting
        // alone would have allowed it.
        var other = await client.GetAsync($"/surveys/{teletrabajo.Id}/respond");
        Assert.Equal(HttpStatusCode.Forbidden, other.StatusCode);
    }
}
