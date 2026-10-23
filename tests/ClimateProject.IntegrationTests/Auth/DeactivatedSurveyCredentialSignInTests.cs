using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// What deactivating a person does to the per-survey keys they were already mailed (audit G5:
/// "UNVERIFIED whether sign-in checks IsActive for a survey key").
///
/// <para>
/// Measured, not assumed: the key is minted while the person is active and signs in; the
/// person is then deactivated through the same <c>PUT /admin/users/{id}</c> the users screen
/// sends; the same key is refused with the byte-identical answer a wrong password gets, so the
/// login endpoint does not tell a caller that this username exists but belongs to someone
/// deactivated; reactivating makes the same key work again. The users screen's deactivation
/// copy says exactly these three things.
/// </para>
/// </summary>
[Collection("Postgres")]
public class DeactivatedSurveyCredentialSignInTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public DeactivatedSurveyCredentialSignInTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"dsc-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Deactivated Key Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Guid UserId, string Username, string Password)> SeedPerSurveyRespondentAsync(Guid surveyId)
    {
        var username = MassInviteCredentials.Username(MassInviteCredentials.PrefixFor("Deactivated Key Co"));
        var password = MassInviteCredentials.Password();
        var hash = new BcryptPasswordHasher().Hash(password);
        var userId = await _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@deactivated-key.example.com",
                Name = "Respondent",
                Role = Roles.Employee,
                IsActive = true,
                // No PasswordHash and no Username: a per-survey respondent's only way in is the key.
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            db.SurveyCredentials.Add(new SurveyCredential
            {
                SurveyId = surveyId,
                UserId = user.Id,
                Username = username,
                PasswordHash = hash,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return user.Id;
        });
        return (userId, username, password);
    }

    private Task<HttpResponseMessage> SignInAsync(string identifier, string password)
        => _factory.CreateClient().PostAsJsonAsync("/auth/login", new { email = identifier, password });

    [Fact]
    public async Task A_deactivated_persons_survey_key_is_refused_like_a_wrong_password_and_works_again_on_reactivation()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId, title: LocalizedInput.FromBare("Clima")));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var (userId, username, password) = await SeedPerSurveyRespondentAsync(survey.Id);

        // Control: the key works while the person is active.
        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(username, password)).StatusCode);

        (await admin.PutAsJsonAsync($"/admin/users/{userId}", new UpdateUserRequest(null, null, null, false)))
            .EnsureSuccessStatusCode();

        var refused = await SignInAsync(username, password);
        var wrongPassword = await SignInAsync(username, password + "x");

        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        // No account enumeration: a deactivated holder's correct key reads exactly as a wrong one.
        Assert.Equal(await wrongPassword.Content.ReadAsStringAsync(), await refused.Content.ReadAsStringAsync());

        (await admin.PutAsJsonAsync($"/admin/users/{userId}", new UpdateUserRequest(null, null, null, true)))
            .EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await SignInAsync(username, password)).StatusCode);
    }
}
