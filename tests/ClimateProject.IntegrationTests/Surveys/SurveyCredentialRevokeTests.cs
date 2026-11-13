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
/// <c>DELETE /surveys/{id}/credentials/{userId}</c> -- withdrawing a key that should never have
/// been sent.
///
/// <para>
/// The case these tests are written from happened on 2026-10-28: ten ESPH people were mailed a
/// Clima key by mistake while legitimately part-way through Teletrabajo. Deactivating the
/// account would have closed both. So the central test here is not "the key stops working" on
/// its own -- it is that the key stops working <b>and the other survey's key still does</b>.
/// </para>
///
/// <para>
/// Every password is read from the captured email, the only place the product ever puts one,
/// and "the key no longer works" is proven by signing in with it rather than by looking for an
/// absent row.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyCredentialRevokeTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"rvk-{Guid.NewGuid():N}.test";
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

    private async Task<HttpClient> AdminClientAsync(Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId ?? _companyId;
            await db.SaveChangesAsync();
        });

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client, string title, string? credentialMode = null)
    {
        var request = SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both(title, title));
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

    private static Task<HttpResponseMessage> RevokeAsync(HttpClient admin, Guid surveyId, Guid userId)
        => admin.DeleteAsync($"/surveys/{surveyId}/credentials/{userId}");

    private async Task<HttpStatusCode> SignInAsync(string username, string password)
        => (await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(username, password))).StatusCode;

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(code, body.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("message").GetString()));
    }

    /// <summary>A person invited to one survey and mailed a key they have not used.</summary>
    private async Task<(HttpClient Admin, SurveyDetail Survey, Guid UserId, string Email, SentCredentials Key)> InvitedAsync()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var (userId, email) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, userId);
        return (admin, survey, userId, email, Assert.Single(_factory.Sent, m => m.ToEmail == email));
    }

    // ---------------------------------------------------------------- the case it was built for

    /// <summary>
    /// The 28 Oct mis-send, end to end. One person, two surveys, two keys; the key that should
    /// never have been sent stops opening anything and the other one is untouched. Before this
    /// route the only in-product lever was deactivating the account, which would have closed
    /// both.
    /// </summary>
    [Fact]
    public async Task Withdrawing_one_surveys_key_leaves_the_persons_other_survey_working()
    {
        var admin = await AdminClientAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        var (userId, email) = await SeedEmployeeAsync();
        await InviteAsync(admin, clima.Id, userId);
        await InviteAsync(admin, teletrabajo.Id, userId);
        var mail = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        var climaKey = Assert.Single(mail, m => m.SurveyName == "Clima");
        var teletrabajoKey = Assert.Single(mail, m => m.SurveyName == "Teletrabajo");
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(climaKey.Username, climaKey.Password));

        var response = await RevokeAsync(admin, clima.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialRevokeResult>())!;
        Assert.Equal(climaKey.Username, result.Username);
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInAsync(climaKey.Username, climaKey.Password));
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(teletrabajoKey.Username, teletrabajoKey.Password));
    }

    /// <summary>
    /// Withdrawing a key is an ACCESS change and nothing else. The account stays, active, with
    /// its other keys; the invitation row stays, because deleting it moves the report's numbers
    /// and that is a separate decision (the October recipe says so in as many words).
    /// </summary>
    [Fact]
    public async Task It_withdraws_the_key_and_leaves_the_account_and_the_invitation_alone()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();

        (await RevokeAsync(admin, survey.Id, userId)).EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            Assert.False(await db.SurveyCredentials.AnyAsync(c => c.SurveyId == survey.Id && c.UserId == userId));
            var person = await db.Users.SingleAsync(u => u.Id == userId);
            Assert.True(person.IsActive);
            Assert.True(await db.SurveyInvitations.AnyAsync(i => i.SurveyId == survey.Id && i.UserId == userId));
        });
    }

    [Fact]
    public async Task A_revoke_is_written_to_the_audit_trail_with_the_key_it_withdrew()
    {
        var (admin, survey, userId, _, key) = await InvitedAsync();

        (await RevokeAsync(admin, survey.Id, userId)).EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.SingleAsync(a => a.ResourceId == $"{survey.Id}/{userId}");
            Assert.True(row.Success);
            Assert.Equal(_companyId, row.CompanyId);
            Assert.Contains("revoked", row.Details!);
            Assert.Contains(key.Username, row.Details!);
        });
    }

    // ---------------------------------------------------------------- reported, not refused

    /// <summary>
    /// A key that has been used is withdrawn, not refused -- being locked out is the point, and
    /// it is where this route differs from reissue. But sessions are stamped per USER, so a live
    /// session cannot be ended without ending that person's other surveys' sessions too; the
    /// response says `hadSignedIn` so the screen can tell the administrator that.
    /// </summary>
    [Fact]
    public async Task A_key_that_was_already_used_is_withdrawn_and_reported_rather_than_refused()
    {
        var (admin, survey, userId, _, key) = await InvitedAsync();
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(key.Username, key.Password));

        var response = await RevokeAsync(admin, survey.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialRevokeResult>())!;
        Assert.True(result.HadSignedIn);
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInAsync(key.Username, key.Password));
    }

    /// <summary>A key nobody used reports so, which is the ordinary mis-send case.</summary>
    [Fact]
    public async Task A_key_that_was_never_used_reports_that_nobody_signed_in_with_it()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();

        var response = await RevokeAsync(admin, survey.Id, userId);

        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialRevokeResult>())!;
        Assert.False(result.HadSignedIn);
    }

    // ---------------------------------------------------------------- refusals

    /// <summary>
    /// The guard that matters most. Withdrawing the key would not withdraw the response, and
    /// what happens to a response that should never have existed is a RESULTS decision -- the
    /// one ESPH was actually left with on 28 Oct. Refused so the two are not half-done together.
    /// </summary>
    [Fact]
    public async Task A_person_who_has_already_answered_is_refused()
    {
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
                IsComplete = false,
                StartTime = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        var response = await RevokeAsync(admin, survey.Id, userId);

        await AssertRefusedAsync(response, HttpStatusCode.Conflict, SurveyCredentialRevokeRefusals.HasResponses);
        await WithDbAsync(async db =>
            Assert.True(await db.SurveyCredentials.AnyAsync(c => c.SurveyId == survey.Id && c.UserId == userId)));
    }

    [Fact]
    public async Task A_shared_account_survey_has_no_key_to_withdraw()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima", CredentialModes.Shared);
        var (userId, _) = await SeedEmployeeAsync();

        await AssertRefusedAsync(
            await RevokeAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRevokeRefusals.NotPerSurvey);
    }

    [Fact]
    public async Task A_person_who_holds_no_key_for_this_survey_is_refused()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var (userId, _) = await SeedEmployeeAsync();

        await AssertRefusedAsync(
            await RevokeAsync(admin, survey.Id, userId),
            HttpStatusCode.Conflict,
            SurveyCredentialRevokeRefusals.NoCredential);
    }

    [Fact]
    public async Task An_unknown_person_is_refused()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");

        await AssertRefusedAsync(
            await RevokeAsync(admin, survey.Id, Guid.NewGuid()),
            HttpStatusCode.NotFound,
            SurveyCredentialRevokeRefusals.UserNotFound);
    }

    /// <summary>Another tenant's administrator cannot reach into this one.</summary>
    [Fact]
    public async Task Another_companys_administrator_is_forbidden()
    {
        var (_, survey, userId, _, _) = await InvitedAsync();
        Guid otherCompanyId = Guid.Empty;
        await WithDbAsync(async db =>
        {
            var other = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Otra",
                EmailDomain = $"otra-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Companies.Add(other);
            otherCompanyId = other.Id;
            await db.SaveChangesAsync();
        });
        var intruder = await AdminClientAsync(otherCompanyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await RevokeAsync(intruder, survey.Id, userId)).StatusCode);
        await WithDbAsync(async db =>
            Assert.True(await db.SurveyCredentials.AnyAsync(c => c.SurveyId == survey.Id && c.UserId == userId)));
    }

    /// <summary>
    /// A mis-send is often noticed after the window shuts, and withdrawing the key is how the
    /// roster stops showing it as outstanding -- so unlike reissue, a closed survey is allowed.
    /// </summary>
    [Fact]
    public async Task A_closed_surveys_key_can_still_be_withdrawn()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await RevokeAsync(admin, survey.Id, userId)).StatusCode);
    }
}
