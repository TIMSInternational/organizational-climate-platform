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
/// <c>POST /surveys/{id}/credentials/{userId}/reissue</c> -- the per-survey resend the October
/// launches did by SQL (audit gap G2), and the two roster facts that say when it is safe to
/// use (G7): the day a key was mailed and the day it was last used.
///
/// <para>
/// Every password is read from the captured email, the only place the product ever puts one.
/// "The old password no longer works" is proven by signing in with it, not by comparing hashes:
/// a row that changed while sign-in still accepted the old pair would pass a hash comparison.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyCredentialReissueTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"rsc-{Guid.NewGuid():N}.test";
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

    private static Task<HttpResponseMessage> ReissueAsync(HttpClient admin, Guid surveyId, Guid userId)
        => admin.PostAsync($"/surveys/{surveyId}/credentials/{userId}/reissue", content: null);

    private async Task<HttpStatusCode> SignInAsync(string username, string password)
        => (await _factory.CreateClient().PostAsJsonAsync("/auth/login", new LoginRequest(username, password))).StatusCode;

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(code, body.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("message").GetString()));
    }

    /// <summary>A person invited, mailed a key, and has not used it -- the state every refusal below varies one thing of.</summary>
    private async Task<(HttpClient Admin, SurveyDetail Survey, Guid UserId, string Email, SentCredentials First)> InvitedAsync()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var (userId, email) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, userId);
        return (admin, survey, userId, email, Assert.Single(_factory.Sent, m => m.ToEmail == email));
    }

    // ---------------------------------------------------------------- success

    [Fact]
    public async Task Reissuing_mails_exactly_one_new_password_that_works_and_the_old_one_stops_working()
    {
        var (admin, survey, userId, email, first) = await InvitedAsync();

        var response = await ReissueAsync(admin, survey.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialReissueResult>())!;
        Assert.True(result.Delivered);
        Assert.Null(result.FailureReason);

        // Exactly one more email, to this person, naming this survey, with the SAME username --
        // the half an admin reads out on the phone does not change.
        var mail = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        Assert.Equal(2, mail.Count);
        var second = mail[1];
        Assert.Equal(first.Username, second.Username);
        Assert.Equal(first.Username, result.Username);
        Assert.Equal("Clima", second.SurveyName);
        Assert.NotEqual(first.Password, second.Password);

        // Both messages print the day the survey closes on the COMPANY's clock (this company
        // is America/Costa_Rica), and the reissue carries the same day as the first -- the
        // two must not disagree about the deadline.
        var closesOn = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(survey.EndDate, TimeZoneInfo.FindSystemTimeZoneById("America/Costa_Rica")).DateTime);
        Assert.Equal(closesOn, first.SurveyClosesOn);
        Assert.Equal(closesOn, second.SurveyClosesOn);

        Assert.Equal(HttpStatusCode.Unauthorized, await SignInAsync(first.Username, first.Password));
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(second.Username, second.Password));
    }

    [Fact]
    public async Task A_reissue_is_written_to_the_audit_trail_with_its_outcome()
    {
        var (admin, survey, userId, _, _) = await InvitedAsync();

        (await ReissueAsync(admin, survey.Id, userId)).EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.SingleAsync(a => a.ResourceId == $"{survey.Id}/{userId}");
            Assert.True(row.Success);
            Assert.Equal(_companyId, row.CompanyId);
            Assert.Contains("reissued", row.Details!);
        });
    }

    /// <summary>
    /// The new password's only copy never left, so it is put back: the person is exactly as
    /// they were, their old key still opens the survey, and the response says it did not go.
    /// </summary>
    [Fact]
    public async Task A_reissue_whose_mail_fails_keeps_the_old_key_working_and_says_so()
    {
        var (admin, survey, userId, email, first) = await InvitedAsync();
        _factory.FailFor.Add(email);

        var response = await ReissueAsync(admin, survey.Id, userId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyCredentialReissueResult>())!;
        Assert.False(result.Delivered);
        Assert.NotNull(result.FailureReason);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);

        Assert.Equal(HttpStatusCode.OK, await SignInAsync(first.Username, first.Password));
    }

    // ---------------------------------------------------------------- refusals

    [Fact]
    public async Task A_key_that_has_been_used_to_sign_in_is_not_replaced()
    {
        var (admin, survey, userId, email, first) = await InvitedAsync();
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(first.Username, first.Password));

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.AlreadySignedIn);

        Assert.Single(_factory.Sent, m => m.ToEmail == email);
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(first.Username, first.Password));
    }

    [Fact]
    public async Task A_person_with_no_key_is_sent_to_the_invite_step()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var (userId, email) = await SeedEmployeeAsync();

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.NoCredential);
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task A_shared_survey_has_no_per_survey_key_to_reissue()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var (userId, email) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, userId);

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.NotPerSurvey);
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task A_closed_survey_is_refused()
    {
        var (admin, survey, userId, email, first) = await InvitedAsync();
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.SurveyNotOpen);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task A_deactivated_person_is_refused()
    {
        var (admin, survey, userId, email, _) = await InvitedAsync();
        await WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == userId)).IsActive = false;
            await db.SaveChangesAsync();
        });

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.UserInactive);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task A_person_outside_the_audience_is_refused()
    {
        var (admin, survey, userId, email, _) = await InvitedAsync();

        // Narrow the audience to somebody else: the key exists, but the survey no longer reaches
        // its holder, so a new one would open nothing.
        var (someoneElse, _) = await SeedEmployeeAsync();
        await WithDbAsync(async db =>
        {
            db.SurveyUserTargets.Add(new SurveyUserTarget { SurveyId = survey.Id, UserId = someoneElse });
            await db.SaveChangesAsync();
        });

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, userId), HttpStatusCode.Conflict,
            SurveyCredentialReissueRefusals.NotInAudience);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    [Fact]
    public async Task A_person_from_another_company_is_not_found()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);

        await AssertRefusedAsync(
            await ReissueAsync(admin, survey.Id, Guid.NewGuid()), HttpStatusCode.NotFound,
            SurveyCredentialReissueRefusals.UserNotFound);
    }

    [Fact]
    public async Task Another_companys_admin_is_forbidden()
    {
        var (_, survey, userId, email, _) = await InvitedAsync();

        var otherCompany = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Companies.Add(new Company
            {
                Id = otherCompany,
                Name = "Otra",
                EmailDomain = $"otra-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        var stranger = await AdminClientAsync(otherCompany);

        Assert.Equal(HttpStatusCode.Forbidden, (await ReissueAsync(stranger, survey.Id, userId)).StatusCode);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    // ---------------------------------------------------------------- the roster's view of a key

    /// <summary>
    /// G7: the roster says, per person, which key they hold, the day it was mailed and the day
    /// it was last used -- and nothing for somebody who holds none.
    /// </summary>
    [Fact]
    public async Task The_roster_shows_each_persons_key_the_day_it_was_mailed_and_whether_it_was_used()
    {
        var (admin, survey, signedInId, _, first) = await InvitedAsync();
        Assert.Equal(HttpStatusCode.OK, await SignInAsync(first.Username, first.Password));

        var (mailedId, mailedEmail) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, mailedId);
        var mailed = Assert.Single(_factory.Sent, m => m.ToEmail == mailedEmail);

        var (keylessId, _) = await SeedEmployeeAsync();

        var view = (await admin.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{survey.Id}/participation"))!;
        Assert.Equal(CredentialModes.PerSurvey, view.CredentialMode);
        Assert.Equal("Clima", view.SurveyTitleEs);

        // The company's day, not UTC's: this company is in Costa Rica (UTC-6, no DST), and a
        // key mailed after 18:00 there is still that day on its screen.
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-6));

        var signedIn = view.Roster.Single(r => r.UserId == signedInId);
        Assert.Equal(first.Username, signedIn.SurveyUsername);
        Assert.Equal(today, signedIn.CredentialIssuedOn);
        Assert.Equal(today, signedIn.LastSignInOn);

        var notYet = view.Roster.Single(r => r.UserId == mailedId);
        Assert.Equal(mailed.Username, notYet.SurveyUsername);
        Assert.Equal(today, notYet.CredentialIssuedOn);
        Assert.Null(notYet.LastSignInOn);

        var keyless = view.Roster.Single(r => r.UserId == keylessId);
        Assert.Null(keyless.SurveyUsername);
        Assert.Null(keyless.CredentialIssuedOn);
        Assert.Null(keyless.LastSignInOn);
    }

    [Fact]
    public async Task A_shared_survey_reports_its_mode_and_no_survey_keys()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var (userId, _) = await SeedEmployeeAsync();
        await InviteAsync(admin, survey.Id, userId);

        var view = (await admin.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{survey.Id}/participation"))!;

        Assert.Equal(CredentialModes.Shared, view.CredentialMode);
        var row = view.Roster.Single(r => r.UserId == userId);
        Assert.Null(row.SurveyUsername);
        Assert.Null(row.CredentialIssuedOn);
        Assert.Null(row.LastSignInOn);
    }
}
