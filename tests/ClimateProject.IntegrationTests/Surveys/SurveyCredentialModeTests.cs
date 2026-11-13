using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Which credential mode a survey ends up in, and -- the part that actually matters -- that
/// it stops moving once it is decided.
///
/// <para>
/// ESPH asked on 2026-10-19 for one username and password PER SURVEY. That is a company
/// default a survey may override, and the repo has exactly one such pair already wired:
/// <c>Language</c>, resolved on the create path and written onto the row.
/// <c>CompanySettings.AnonymousSurveys</c> only looks like a second one -- the settings
/// screen tells the admin new surveys inherit it and nothing on the create path reads it,
/// so the inheritance is copy rather than code. These tests exist so this setting cannot
/// become the second of those.
/// </para>
/// <para>
/// The freeze is the load-bearing property. Credentials are minted and mailed once. If the
/// mode were resolved at read time, changing the company setting afterwards would re-describe
/// a survey whose people are already holding passwords, and nothing would reconcile the two.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SurveyCredentialModeTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public SurveyCredentialModeTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"cred-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Credential Mode Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private async Task SetCompanyModeAsync(HttpClient client, string mode)
    {
        var response = await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/settings",
            new UpdateCompanySettingsRequest(
                null, null, null, null, null, null, null, null, null, null, null, null,
                CredentialMode: mode));
        response.EnsureSuccessStatusCode();
    }

    private Task<string?> StoredModeAsync(Guid surveyId) => _harness.WithDbAsync(db => db.Surveys
        .AsNoTracking().Where(s => s.Id == surveyId).Select(s => s.Settings.CredentialMode).FirstAsync());

    [Fact]
    public async Task A_survey_is_shared_when_nobody_has_said_otherwise()
    {
        var client = await AdminAsync();

        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));

        Assert.Equal(CredentialModes.Shared, created.Settings.CredentialMode);
        // Written, not left null: the survey HAS decided, and "inherit" is not what it decided.
        Assert.Equal(CredentialModes.Shared, await StoredModeAsync(created.Id));
    }

    [Fact]
    public async Task A_survey_inherits_the_companys_mode()
    {
        var client = await AdminAsync();
        await SetCompanyModeAsync(client, CredentialModes.PerSurvey);

        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));

        Assert.Equal(CredentialModes.PerSurvey, created.Settings.CredentialMode);
        Assert.Equal(CredentialModes.PerSurvey, await StoredModeAsync(created.Id));
    }

    [Fact]
    public async Task A_survey_may_override_the_company_in_either_direction()
    {
        var client = await AdminAsync();

        // company shared, survey asks for per-survey
        var optIn = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(CredentialMode: CredentialModes.PerSurvey),
            });
        Assert.Equal(CredentialModes.PerSurvey, optIn.Settings.CredentialMode);

        // company per-survey, survey asks to stay shared
        await SetCompanyModeAsync(client, CredentialModes.PerSurvey);
        var optOut = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(CredentialMode: CredentialModes.Shared),
            });
        Assert.Equal(CredentialModes.Shared, optOut.Settings.CredentialMode);
    }

    /// <summary>
    /// The one that protects the mail. A survey decided its mode when it was created; the
    /// company changing its mind afterwards must not re-describe it, because by then its
    /// people may be holding passwords that were minted under the old answer.
    /// </summary>
    [Fact]
    public async Task Changing_the_company_afterwards_does_not_reshape_a_survey_already_created()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));
        Assert.Equal(CredentialModes.Shared, created.Settings.CredentialMode);

        await SetCompanyModeAsync(client, CredentialModes.PerSurvey);

        // The existing survey is untouched...
        Assert.Equal(CredentialModes.Shared, await StoredModeAsync(created.Id));
        var reread = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}");
        Assert.Equal(CredentialModes.Shared, reread!.Settings.CredentialMode);

        // ...and only surveys created from now on inherit the new answer.
        var next = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));
        Assert.Equal(CredentialModes.PerSurvey, next.Settings.CredentialMode);
    }

    [Fact]
    public async Task An_unknown_mode_is_refused_on_the_survey_rather_than_coerced()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync(
            "/surveys",
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(CredentialMode: "per-survey"),
            });

        // Coercing a typo to `shared` would be discovered by a roster receiving one email
        // where it was promised one per survey, after the mail had gone.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("credentialMode", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unknown_mode_is_refused_on_the_company_too()
    {
        var client = await AdminAsync();

        var response = await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/settings",
            new UpdateCompanySettingsRequest(
                null, null, null, null, null, null, null, null, null, null, null, null,
                CredentialMode: "perSurvey"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("credentialMode", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_company_route_reports_the_mode_it_stored()
    {
        var client = await AdminAsync();
        await SetCompanyModeAsync(client, CredentialModes.PerSurvey);

        // Read through the GET, which every screen now uses instead of an empty PUT.
        var response = await client.GetAsync($"/admin/companies/{_companyId}/settings");
        response.EnsureSuccessStatusCode();

        var settings = await response.Content.ReadFromJsonAsync<CompanySettingsResponse>();
        Assert.Equal(CredentialModes.PerSurvey, settings!.Settings.CredentialMode);
    }

    /// <summary>
    /// The mode is frozen at create. An update that names it used to answer 200 and change
    /// nothing, so a caller could believe a survey had moved to one code per person while its
    /// roster stayed on one shared account. Now it is refused, and nothing else in the same
    /// request is applied.
    /// </summary>
    [Theory]
    [InlineData(CredentialModes.PerSurvey)]
    [InlineData(CredentialModes.Shared)]
    public async Task An_update_that_names_the_credential_mode_is_refused_and_changes_nothing(string mode)
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));
        Assert.Equal(CredentialModes.Shared, created.Settings.CredentialMode);

        var response = await client.PutAsJsonAsync($"/surveys/{created.Id}", new UpdateSurveyRequest(
            Description: LocalizedInput.FromBare("Should not be saved"),
            Settings: new SurveySettingsInput(CredentialMode: mode)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("credential_mode_frozen", body, StringComparison.Ordinal);
        Assert.Contains("credentialMode", body, StringComparison.Ordinal);
        Assert.Equal(CredentialModes.Shared, await StoredModeAsync(created.Id));
        var reread = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}");
        Assert.NotEqual("Should not be saved", reread!.Description);
    }

    [Fact]
    public async Task An_update_that_does_not_name_the_mode_still_succeeds()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));

        var response = await client.PutAsJsonAsync($"/surveys/{created.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(ShowProgress: false)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(CredentialModes.Shared, await StoredModeAsync(created.Id));
    }
}
