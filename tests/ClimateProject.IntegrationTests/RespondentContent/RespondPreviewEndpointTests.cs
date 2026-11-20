using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.RespondentContent;

/// <summary>
/// «Ver como quien responde» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// <c>GET /surveys/{id}/respond-preview</c> serves the respond view a link visitor would get, in any
/// status but archived, to whoever may administer the survey -- and writes nothing, however often
/// it is called.
/// </summary>
[Collection("Postgres")]
public class RespondPreviewEndpointTests : IAsyncLifetime
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyA;
    private Guid _companyB;

    public RespondPreviewEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"preview-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyA = await _harness.SeedCompanyAsync("Vista previa A", language: "es");
        _companyB = await _harness.SeedCompanyAsync("Vista previa B", language: "es");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static string Route(Guid surveyId, string lang = "es") => $"/surveys/{surveyId}/respond-preview?lang={lang}";

    /// <summary>A draft, anonymous, Spanish survey with three questions and its own anonymity paragraph.</summary>
    private static async Task<SurveyDetail> DraftAsync(HttpClient admin, Guid companyId)
        => await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Clima 2026"),
            CompanyId: companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Confío en mi jefatura"), "likert", ScaleMin: 1, ScaleMax: 5, Required: true, Order: 0),
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Tengo lo que necesito"), "likert", ScaleMin: 1, ScaleMax: 5, Required: true, Order: 1),
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("¿Algún comentario?"), "open_ended", Order: 2),
            ],
            Language: "es",
            Settings: new SurveySettingsInput(
                Anonymous: true,
                SelfDeclaredDemographics: false,
                RespondentIntro: LocalizedInput.FromBare("Párrafo de la encuesta"))));

    private static async Task<RespondPreviewView> OkAsync(HttpResponseMessage response)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"Expected 200, got {(int)response.StatusCode}: {raw}");
        return JsonSerializer.Deserialize<RespondPreviewView>(raw, Web)!;
    }

    /// <summary>
    /// Everything a respondent's visit, autosave or submit could change for this survey and its
    /// company, as one comparable value: responses and their answers and demographics, who took
    /// part, invitations and credentials, licence seats, both audit trails, the link's visit
    /// counters, and the survey row itself.
    /// </summary>
    private sealed record Footprint(
        int Responses,
        int QuestionResponses,
        int ResponseDemographics,
        int Participations,
        int Invitations,
        DateTimeOffset? LatestInvitationUpdate,
        int Credentials,
        int SeatsUsed,
        int AuditRows,
        int SurveyAuditRows,
        int LinkAccesses,
        int LinkVisitors,
        DateTimeOffset? LinkLastAccessed,
        int SurveyResponseCount,
        int SurveyVersion,
        string SurveyStatus,
        DateTimeOffset SurveyUpdatedAt);

    private Task<Footprint> FootprintAsync(Guid surveyId, Guid companyId)
        => _harness.WithDbAsync(async db =>
        {
            var responseIds = db.Responses.Where(r => r.SurveyId == surveyId).Select(r => r.Id);
            var survey = await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == surveyId);
            var link = await db.SurveyDistributions.AsNoTracking().FirstOrDefaultAsync(d => d.SurveyId == surveyId);
            return new Footprint(
                await db.Responses.CountAsync(r => r.SurveyId == surveyId),
                await db.QuestionResponses.CountAsync(q => responseIds.Contains(q.ResponseId)),
                await db.ResponseDemographics.CountAsync(d => responseIds.Contains(d.ResponseId)),
                await db.SurveyParticipations.CountAsync(p => p.SurveyId == surveyId),
                await db.SurveyInvitations.CountAsync(i => i.SurveyId == surveyId),
                await db.SurveyInvitations.Where(i => i.SurveyId == surveyId).MaxAsync(i => (DateTimeOffset?)i.UpdatedAt),
                await db.SurveyCredentials.CountAsync(c => c.SurveyId == surveyId),
                await db.CompanyServiceLicenses.Where(l => l.CompanyId == companyId).SumAsync(l => l.SeatsUsed),
                await db.AuditLogs.CountAsync(a => a.CompanyId == companyId),
                await db.SurveyAuditLogs.CountAsync(a => a.SurveyId == surveyId),
                link?.TotalAccesses ?? 0,
                link?.UniqueVisitors ?? 0,
                link?.LastAccessedAt,
                survey.ResponseCount,
                survey.Version,
                survey.Status,
                survey.UpdatedAt);
        });

    /// <summary>
    /// The goal of the route, measured: five previews of a live survey with an open link and a
    /// respondent's partial answers already on file change no row a respondent's visit could
    /// touch, and none of them resumes that respondent's answers.
    /// </summary>
    [Fact]
    public async Task Previewing_a_live_survey_repeatedly_writes_nothing_anywhere_a_respondent_would()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        var survey = await DraftAsync(admin, _companyA);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await SurveyTestHarness.OpenPublicLinkAsync(admin, survey.Id);
        await _harness.SeedResponseAsync(survey.Id, _companyA, userId: null, isComplete: false, language: "es");

        var before = await FootprintAsync(survey.Id, _companyA);

        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        for (var i = 0; i < 5; i++)
        {
            var preview = await OkAsync(await (i % 2 == 0 ? admin : operatorClient).GetAsync(Route(survey.Id, i % 2 == 0 ? "es" : "en")));
            Assert.Null(preview.View.InProgress);
        }

        var after = await FootprintAsync(survey.Id, _companyA);
        Assert.Equal(before, after);
    }

    /// <summary>
    /// A draft -- which no respondent can open -- previews as the link visitor's view: the title,
    /// every question, the survey's own anonymity paragraph through the content chain, the
    /// company's thank-you where the survey wrote none, and the company strip.
    /// </summary>
    [Fact]
    public async Task A_draft_previews_as_the_link_visitor_view_with_its_effective_texts()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        var survey = await DraftAsync(admin, _companyA);
        (await admin.PutAsJsonAsync(
            $"/admin/companies/{_companyA}/respondent-content",
            new UpdateRespondentContentRequest(new Dictionary<string, Dictionary<string, string?>>
            {
                ["es"] = new() { ["thankYouTitle"] = "Gracias, de parte de la empresa" },
            }))).EnsureSuccessStatusCode();

        // The respondent's own route refuses a draft; the preview is the only way to see it.
        var respondent = await _factory.CreateClient().GetAsync($"/surveys/{survey.Id}/respond?lang=es");
        Assert.False(respondent.IsSuccessStatusCode);

        var preview = await OkAsync(await admin.GetAsync(Route(survey.Id)));

        Assert.Equal(SurveyStatuses.Draft, preview.Status);
        Assert.Equal("Vista previa A", preview.CompanyName);
        Assert.Equal("Clima 2026", preview.View.Title);
        Assert.Equal("es", preview.View.ResolvedLocale);
        Assert.True(preview.View.Anonymous);
        Assert.Equal(3, preview.View.Questions.Count);
        Assert.Equal("Párrafo de la encuesta", preview.View.Content!["anonymousBody"]);
        Assert.Equal("Gracias, de parte de la empresa", preview.View.Content["thankYouTitle"]);
        Assert.Null(preview.View.InProgress);
    }

    /// <summary>
    /// Who: the rule every survey admin route uses. A company admin of another company and an
    /// employee of the survey's own company are refused; a company-less super admin is not.
    /// </summary>
    [Fact]
    public async Task Only_an_administrator_of_the_survey_may_preview_it()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        var survey = await DraftAsync(admin, _companyA);

        var otherAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyB);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.GetAsync(Route(survey.Id))).StatusCode);

        var employee = await _harness.ClientAsync(Roles.Employee, _companyA);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync(Route(survey.Id))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().GetAsync(Route(survey.Id))).StatusCode);

        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        await OkAsync(await operatorClient.GetAsync(Route(survey.Id)));

        Assert.Equal(HttpStatusCode.NotFound, (await operatorClient.GetAsync(Route(Guid.NewGuid()))).StatusCode);
    }

    /// <summary>Any status but archived: a closed survey still previews, an archived one is refused with its code.</summary>
    [Fact]
    public async Task A_closed_survey_previews_and_an_archived_one_is_refused_with_its_code()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        var survey = await DraftAsync(admin, _companyA);

        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);
        await OkAsync(await admin.GetAsync(Route(survey.Id)));

        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Archived);
        var refused = await admin.GetAsync(Route(survey.Id));
        var raw = await refused.Content.ReadAsStringAsync();
        Assert.True(refused.StatusCode == HttpStatusCode.Conflict, raw);
        Assert.Equal(AdminRefusals.RespondPreviewArchived, JsonDocument.Parse(raw).RootElement.GetProperty("code").GetString());
    }
}
