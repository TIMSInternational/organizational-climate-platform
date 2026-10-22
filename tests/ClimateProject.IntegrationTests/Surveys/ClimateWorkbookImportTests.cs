using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>/surveys/import</c> against a company in each credential mode, and the re-run of an
/// interrupted import. Every write below is the request the page makes
/// (<c>web/src/features/surveys/api/climateWorkbook.ts</c>), in the same order and with the same
/// settings, so "the page can resume" is measured on the shape the page actually produces.
/// </summary>
[Collection("Postgres")]
public class ClimateWorkbookImportTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"workbook-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ClimateWorkbookImportTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Workbook Co", EmailDomain = _domain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        db.Departments.Add(new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Ingeniería", CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        _companyId = company.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Theory]
    [InlineData(CredentialModes.PerSurvey)]
    [InlineData(CredentialModes.Shared)]
    public async Task The_preview_reports_the_companys_credential_mode(string mode)
    {
        await SetModeAsync(mode);
        using var client = await ClientAsync(Roles.CompanyAdmin);

        var plan = await PreviewAsync(client, await WorkbookAsync(_domain, "Clima modo", "persona"));

        Assert.Empty(plan.Errors);
        Assert.Equal(_companyId, plan.CompanyId);
        Assert.Equal(mode, plan.CredentialMode);
    }

    [Fact]
    public async Task The_preview_of_a_company_that_does_not_exist_yet_reports_no_mode()
    {
        using var client = await ClientAsync(Roles.SuperAdmin);

        var plan = await PreviewAsync(client, await WorkbookAsync($"nueva-{Guid.NewGuid():N}.test", "Clima nuevo", "persona"));

        Assert.Empty(plan.Errors);
        Assert.Null(plan.CompanyId);
        Assert.Null(plan.CredentialMode);
    }

    /// <summary>
    /// The run the page makes, stopped after the people and before anything else -- which, now
    /// that the page leaves the survey a draft, is the whole run. Previewing the same file again
    /// must pick up that draft (not call it "a different survey") and list the person already
    /// imported, so the bulk import skips them.
    /// </summary>
    [Fact]
    public async Task A_rerun_of_the_same_workbook_in_a_per_survey_company_resumes_the_draft()
    {
        await SetModeAsync(CredentialModes.PerSurvey);
        using var client = await ClientAsync(Roles.CompanyAdmin);
        var bytes = await WorkbookAsync(_domain, "Clima reanudable", "reanuda");
        var plan = await PreviewAsync(client, bytes);
        Assert.Empty(plan.Errors);
        Assert.Equal(CredentialModes.PerSurvey, plan.CredentialMode);

        foreach (var field in plan.Fields)
        {
            var created = await client.PostAsJsonAsync("/admin/demographic-fields", new
            {
                companyId = _companyId, field = field.Field, label = new { es = field.Label, en = field.Label }, type = "select", required = false, order = 1,
                options = field.Options.Select(o => new { value = o.Value, label = new { es = o.Label, en = o.Label } }),
            });
            created.EnsureSuccessStatusCode();
        }
        var survey = await CreateSurveyAsThePageDoesAsync(client, plan.Content);
        Assert.Equal(SurveyStatuses.Draft, survey.Status);

        var rows = plan.Content.People.Select(p => new BulkImportRowInput(p.RowNumber, p.Name, p.Email, p.Role, p.Department, p.Demographics?.ToDictionary(kv => kv.Key, kv => kv.Value))).ToArray();
        // The page used to send withCredentials:true here unconditionally; a per_survey company
        // refuses that, which is why the page now asks the preview for the mode.
        var refused = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(_companyId, false, rows, WithCredentials: true));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("credentials_not_available_per_survey", await refused.Content.ReadAsStringAsync());
        var import = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(_companyId, false, rows, WithCredentials: false));
        import.EnsureSuccessStatusCode();
        var imported = (await import.Content.ReadFromJsonAsync<BulkImportResponse>())!;
        Assert.True(imported.SuccessCount == 1, string.Join("; ", imported.Rows.Select(r => $"{r.Status}: {string.Join(",", r.Errors)}")));

        var resumed = await PreviewAsync(client, bytes);

        Assert.Empty(resumed.Errors);
        Assert.Equal(survey.Id, resumed.SurveyId);
        Assert.Equal(SurveyStatuses.Draft, resumed.SurveyStatus);
        Assert.Equal(plan.Content.People.Single().Email, Assert.Single(resumed.ExistingPeople).Email, ignoreCase: true);
        Assert.Equal(CredentialModes.PerSurvey, resumed.CredentialMode);
    }

    [Fact]
    public async Task A_survey_with_the_same_title_but_other_content_is_still_a_different_survey()
    {
        using var client = await ClientAsync(Roles.CompanyAdmin);
        var plan = await PreviewAsync(client, await WorkbookAsync(_domain, "Clima distinto", "distinto"));
        Assert.Empty(plan.Errors);
        await CreateSurveyAsThePageDoesAsync(client, plan.Content with { Description = "Otra descripción." });

        var again = await PreviewAsync(client, await WorkbookAsync(_domain, "Clima distinto", "distinto"));

        Assert.Null(again.SurveyId);
        Assert.Contains(again.Errors, e => e.Contains("encuesta distinta", StringComparison.Ordinal));
    }

    /// <summary>
    /// The survey froze the company's mode when it was created. A company switched to
    /// per_survey afterwards would have its new people imported without mail while the survey
    /// still hands out shared accounts -- refused at preview, before anything is written.
    /// </summary>
    [Fact]
    public async Task A_resumed_survey_whose_frozen_mode_differs_from_the_company_is_refused_before_any_write()
    {
        await SetModeAsync(CredentialModes.Shared);
        using var client = await ClientAsync(Roles.CompanyAdmin);
        var bytes = await WorkbookAsync(_domain, "Clima cambio de modo", "modo");
        var plan = await PreviewAsync(client, bytes);
        var survey = await CreateSurveyAsThePageDoesAsync(client, plan.Content);
        await SetModeAsync(CredentialModes.PerSurvey);

        var again = await PreviewAsync(client, bytes);

        Assert.Null(again.SurveyId);
        Assert.Contains(again.Errors, e => e.Contains("modo de acceso", StringComparison.Ordinal));
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.CompanyId == _companyId && u.Email.StartsWith("modo")));
        Assert.Equal(SurveyStatuses.Draft, (await db.Surveys.SingleAsync(s => s.Id == survey.Id)).Status);
    }

    private async Task<SurveyDetail> CreateSurveyAsThePageDoesAsync(HttpClient client, ClimateWorkbookContent content)
    {
        var create = await client.PostAsJsonAsync("/surveys", new
        {
            companyId = _companyId, title = new { es = content.Title }, description = new { es = content.Description }, type = "periodic", language = "es",
            startDate = content.StartDate.ToUniversalTime(), endDate = content.EndDate.ToUniversalTime(), questions = content.Questions, targetAudienceCount = content.People.Count,
            settings = new
            {
                anonymous = content.Company.Anonymous, allowPartialResponses = true, showProgress = true, autoSave = true,
                notificationSendInvitations = false, notificationSendReminders = false, invitationSendImmediately = true,
                invitationCustomSubject = content.InvitationSubject, invitationCustomMessage = content.InvitationMessage,
            },
        });
        create.EnsureSuccessStatusCode();
        var survey = (await create.Content.ReadFromJsonAsync<SurveyDetail>())!;
        var distribution = await client.PutAsJsonAsync($"/surveys/{survey.Id}/distribution", new { accessType = "tokenized", accessRules = new { requireLogin = true, allowAnonymous = false, singleResponse = true } });
        distribution.EnsureSuccessStatusCode();
        return survey;
    }

    /// <summary>Through the settings route an administrator uses, as `set-credential-mode.sh` does.</summary>
    private async Task SetModeAsync(string mode)
    {
        using var client = await ClientAsync(Roles.CompanyAdmin);
        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyId}/settings",
            new UpdateCompanySettingsRequest(null, null, null, null, null, null, null, null, null, null, null, null, CredentialMode: mode));
        response.EnsureSuccessStatusCode();
    }

    private static async Task<ClimateWorkbookPreview> PreviewAsync(HttpClient client, byte[] bytes)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        form.Add(file, "file", "clima.xlsx");
        var response = await client.PostAsync("/admin/climate-workbooks/preview", form);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ClimateWorkbookPreview>())!;
    }

    private async Task<byte[]> WorkbookAsync(string domain, string title, string emailPrefix)
    {
        using var admin = await ClientAsync(Roles.CompanyAdmin);
        using var input = new MemoryStream(await admin.GetByteArrayAsync("/admin/climate-workbooks/template"));
        using var book = new XLWorkbook(input);
        var company = book.Worksheet("EMPRESA");
        company.Cell("B7").Value = "Workbook Co"; company.Cell("B8").Value = domain;
        company.Cell("B9").Value = "Costa Rica"; company.Cell("B10").Value = "Servicios"; company.Cell("B13").Value = title;
        company.Cell("B15").Value = DateTime.UtcNow.Date.AddDays(1).ToString("yyyy-MM-dd HH:mm");
        company.Cell("B16").Value = DateTime.UtcNow.Date.AddDays(30).ToString("yyyy-MM-dd HH:mm"); company.Cell("B17").Value = "America/Costa_Rica";
        var people = book.Worksheet("DEMOGRAFICOS");
        people.Cell("B6").Value = "Persona"; people.Cell("C6").Value = "Prueba"; people.Cell("D6").Value = $"{emailPrefix}-{Guid.NewGuid():N}@example.test";
        people.Cell("E6").Value = "Analista"; people.Cell("F6").Value = "Norte"; people.Cell("K6").Value = "Ingeniería"; people.Cell("L6").Value = "Colaborador";
        using var output = new MemoryStream(); book.SaveAs(output);
        return output.ToArray();
    }

    private async Task<HttpClient> ClientAsync(string role)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Workbook Admin", email, "A-good-passw0rd"));
        signup.EnsureSuccessStatusCode();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
