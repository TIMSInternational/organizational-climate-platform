using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Audit gap G15: <c>POST /survey-templates/{id}/use</c> built its survey on the entity's own
/// defaults -- not anonymous, credential mode left null, invitation and reminder mail on, no
/// "Created" audit entry -- while <c>POST /surveys</c> made every survey anonymous. Respondents
/// never sign in, and a signed-out respondent can answer only an anonymous survey, so a
/// template-built survey's public link refused them.
///
/// These assert what is STORED, through the same endpoints the builder calls, against a company
/// in each credential mode.
/// </summary>
[Collection("Postgres")]
public class TemplateSurveyDefaultsTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _sharedCompanyId;
    private Guid _perSurveyCompanyId;

    public TemplateSurveyDefaultsTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"tmpl-defaults-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _sharedCompanyId = await _harness.SeedCompanyAsync("Template Defaults Shared Co");
        _perSurveyCompanyId = await _harness.SeedCompanyAsync("Template Defaults Per-Survey Co");

        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _perSurveyCompanyId);
        var response = await admin.PutAsJsonAsync(
            $"/admin/companies/{_perSurveyCompanyId}/settings",
            new UpdateCompanySettingsRequest(
                null, null, null, null, null, null, null, null, null, null, null, null,
                CredentialMode: CredentialModes.PerSurvey));
        response.EnsureSuccessStatusCode();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Guid CompanyFor(string mode) => mode == CredentialModes.PerSurvey ? _perSurveyCompanyId : _sharedCompanyId;

    private static CreateSurveyTemplateRequest TemplateRequest(Guid companyId) => new(
        Name: "Instrumento de Clima",
        Description: "La base de 2026",
        Category: "periodic",
        CompanyId: companyId,
        Questions:
        [
            new CreateSurveyTemplateQuestionInput(
                LocalizedInput.FromBare("Que cambiarias?"),
                QuestionTypes.OpenEnded,
                Order: 0),
        ],
        Language: ContentLanguages.Spanish);

    private async Task<(HttpClient Client, Guid SurveyId)> FromTemplateAsync(
        string companyMode,
        UseSurveyTemplateRequest? request = null)
    {
        var companyId = CompanyFor(companyMode);
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, companyId);

        var createdTemplate = await client.PostAsJsonAsync("/survey-templates", TemplateRequest(companyId));
        Assert.Equal(HttpStatusCode.Created, createdTemplate.StatusCode);
        var template = (await createdTemplate.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;

        var used = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            request ?? new UseSurveyTemplateRequest(CompanyId: companyId));
        Assert.Equal(HttpStatusCode.Created, used.StatusCode);
        var survey = (await used.Content.ReadFromJsonAsync<SurveyDetail>())!;
        return (client, survey.Id);
    }

    private Task<SurveySettings> StoredSettingsAsync(Guid surveyId) => _harness.WithDbAsync(db => db.Surveys
        .AsNoTracking()
        .Where(s => s.Id == surveyId)
        .Select(s => s.Settings)
        .FirstAsync());

    [Theory]
    [InlineData(CredentialModes.Shared)]
    [InlineData(CredentialModes.PerSurvey)]
    public async Task A_survey_from_a_template_is_anonymous(string companyMode)
    {
        var (client, surveyId) = await FromTemplateAsync(companyMode);

        Assert.True((await StoredSettingsAsync(surveyId)).Anonymous);
        var read = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{surveyId}");
        Assert.True(read!.Settings.Anonymous);
    }

    [Theory]
    [InlineData(CredentialModes.Shared)]
    [InlineData(CredentialModes.PerSurvey)]
    public async Task A_survey_from_a_template_freezes_the_companys_credential_mode(string companyMode)
    {
        var (_, surveyId) = await FromTemplateAsync(companyMode);

        // Written onto the row, not left null: null reads as "inherit" at send time.
        Assert.Equal(companyMode, (await StoredSettingsAsync(surveyId)).CredentialMode);
    }

    [Theory]
    [InlineData(CredentialModes.Shared)]
    [InlineData(CredentialModes.PerSurvey)]
    public async Task A_survey_from_a_template_sends_no_invitation_or_reminder_mail(string companyMode)
    {
        var (_, surveyId) = await FromTemplateAsync(companyMode);

        var settings = await StoredSettingsAsync(surveyId);
        Assert.False(settings.NotificationSendInvitations);
        Assert.False(settings.NotificationSendReminders);
    }

    [Fact]
    public async Task A_survey_from_a_template_has_a_Created_audit_entry_naming_its_maker()
    {
        var (_, surveyId) = await FromTemplateAsync(CredentialModes.Shared);

        var entries = await _harness.WithDbAsync(db => db.SurveyAuditLogs
            .AsNoTracking()
            .Where(a => a.SurveyId == surveyId)
            .ToListAsync());
        var created = Assert.Single(entries, a => a.Action == SurveyAuditActions.Created);
        Assert.Equal(SurveyAuditEntityTypes.Survey, created.EntityType);

        var createdBy = await _harness.WithDbAsync(db => db.Surveys
            .AsNoTracking().Where(s => s.Id == surveyId).Select(s => s.CreatedBy).FirstAsync());
        Assert.Equal(createdBy, created.UserId);
    }

    /// <summary>
    /// Parity over the WHOLE stored settings object, not the four fields above: a blank survey
    /// and a template-built one, made by the same admin in the same company with nothing said
    /// about settings, must be indistinguishable in every setting.
    /// </summary>
    [Theory]
    [InlineData(CredentialModes.Shared)]
    [InlineData(CredentialModes.PerSurvey)]
    public async Task A_blank_survey_and_a_template_survey_agree_on_every_default(string companyMode)
    {
        var (client, fromTemplate) = await FromTemplateAsync(companyMode);
        // MinimalRequest says `Anonymous: false` out loud for its legacy callers; here the blank
        // survey must say NOTHING about settings, exactly as the template one does.
        var blank = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(CompanyFor(companyMode)) with { Settings = null });

        var blankSettings = await StoredSettingsAsync(blank.Id);
        var templateSettings = await StoredSettingsAsync(fromTemplate);

        Assert.Equal(companyMode, blankSettings.CredentialMode);
        Assert.Equal(JsonSerializer.Serialize(blankSettings), JsonSerializer.Serialize(templateSettings));

        // And both have their Created entry.
        var createdEntries = await _harness.WithDbAsync(db => db.SurveyAuditLogs
            .AsNoTracking()
            .Where(a => (a.SurveyId == blank.Id || a.SurveyId == fromTemplate) && a.Action == SurveyAuditActions.Created)
            .Select(a => a.SurveyId)
            .ToListAsync());
        Assert.Equal(2, createdEntries.Count);
    }

    [Fact]
    public async Task The_service_type_is_accepted_on_the_template_path()
    {
        var (_, surveyId) = await FromTemplateAsync(
            CredentialModes.Shared,
            new UseSurveyTemplateRequest(CompanyId: _sharedCompanyId, ServiceType: ClimateServiceTypes.GeneralClimate));

        var stored = await _harness.WithDbAsync(db => db.Surveys
            .AsNoTracking().Where(s => s.Id == surveyId).Select(s => s.ServiceType).FirstAsync());
        Assert.Equal(ClimateServiceTypes.GeneralClimate, stored);
    }

    [Fact]
    public async Task An_unknown_service_type_on_the_template_path_is_a_400_and_creates_nothing()
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _sharedCompanyId);
        var createdTemplate = await client.PostAsJsonAsync("/survey-templates", TemplateRequest(_sharedCompanyId));
        var template = (await createdTemplate.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;
        var before = await _harness.WithDbAsync(db => db.Surveys.CountAsync(s => s.CompanyId == _sharedCompanyId));

        var response = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest(CompanyId: _sharedCompanyId, ServiceType: "not_a_service"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(before, await _harness.WithDbAsync(db => db.Surveys.CountAsync(s => s.CompanyId == _sharedCompanyId)));
    }

    /// <summary>
    /// The builder's two checkboxes reach the template path, applied OVER the defaults: what was
    /// asked about changes, and anonymity -- not mentioned -- stays on.
    /// </summary>
    [Fact]
    public async Task Settings_sent_to_the_template_path_are_applied_over_the_defaults()
    {
        var (_, surveyId) = await FromTemplateAsync(
            CredentialModes.Shared,
            new UseSurveyTemplateRequest(
                CompanyId: _sharedCompanyId,
                Settings: new SurveySettingsInput(AllowPartialResponses: false, ShowProgress: false)));

        var settings = await StoredSettingsAsync(surveyId);
        Assert.False(settings.AllowPartialResponses);
        Assert.False(settings.ShowProgress);
        Assert.True(settings.Anonymous);
        Assert.False(settings.NotificationSendInvitations);
    }

    [Fact]
    public async Task An_explicit_credential_mode_on_the_template_path_overrides_the_company()
    {
        var (_, surveyId) = await FromTemplateAsync(
            CredentialModes.Shared,
            new UseSurveyTemplateRequest(
                CompanyId: _sharedCompanyId,
                Settings: new SurveySettingsInput(CredentialMode: CredentialModes.PerSurvey)));

        Assert.Equal(CredentialModes.PerSurvey, (await StoredSettingsAsync(surveyId)).CredentialMode);
    }

    [Fact]
    public async Task An_unknown_credential_mode_on_the_template_path_is_a_400()
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _sharedCompanyId);
        var createdTemplate = await client.PostAsJsonAsync("/survey-templates", TemplateRequest(_sharedCompanyId));
        var template = (await createdTemplate.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;

        var response = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest(CompanyId: _sharedCompanyId, Settings: new SurveySettingsInput(CredentialMode: "per-survey")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
