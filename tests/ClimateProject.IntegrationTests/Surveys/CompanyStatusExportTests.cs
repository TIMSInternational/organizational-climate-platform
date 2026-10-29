using System.Net;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>GET /admin/companies/{id}/participation/export</c> — every one of a company's distributed
/// surveys as one workbook, a sheet each.
///
/// <para>
/// This is the file TIMS sends the client. Through October 2026 producing it meant downloading
/// three rosters and running a Python script over them, about twice a day; these tests pin the
/// two decisions that make the route safe to hand over — a DRAFT survey is left out, and the
/// per-survey authorization is the one that decides who may read a list of named people.
/// </para>
/// </summary>
[Collection("Postgres")]
public class CompanyStatusExportTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public CompanyStatusExportTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"status-export-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Servicio Público de Heredia", "es");

    public Task DisposeAsync() => Task.CompletedTask;

    private static Task<HttpResponseMessage> ExportAsync(HttpClient client, Guid companyId)
        => client.GetAsync($"/admin/companies/{companyId}/participation/export");

    private static async Task<XLWorkbook> WorkbookOfAsync(HttpResponseMessage response)
    {
        Assert.Equal(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            response.Content.Headers.ContentType?.MediaType);
        var stream = new MemoryStream(await response.Content.ReadAsByteArrayAsync());
        return new XLWorkbook(stream);
    }

    private async Task<Guid> ActiveSurveyAsync(HttpClient admin, string title, Guid userId)
    {
        var survey = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both(title, title)) with
            {
                UserIds = [userId],
                Settings = new SurveySettingsInput(Anonymous: false),
            });
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey.Id;
    }

    [Fact]
    public async Task Every_distributed_survey_gets_a_sheet_with_its_people_on_it()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (_, personId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await ActiveSurveyAsync(admin, "Clima", personId);
        await ActiveSurveyAsync(admin, "Teletrabajo", personId);

        var response = await ExportAsync(admin, _companyId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var book = await WorkbookOfAsync(response);
        Assert.Equal(["Clima", "Teletrabajo"], book.Worksheets.Select(w => w.Name));
        // The header row is the CSV export's own, asserted against the method rather than a copy.
        var sheet = book.Worksheet("Clima");
        var headers = SurveyRosterCsv.Headers(spanish: true, perSurvey: false, showState: true);
        Assert.Equal(headers[0], sheet.Cell(4, 1).GetString());
        Assert.Equal("Clima", sheet.Cell(1, 1).GetString());
    }

    /// <summary>
    /// A draft has invited nobody, so its sheet would be a page of people reported as not
    /// having answered something they were never sent.
    /// </summary>
    [Fact]
    public async Task A_draft_survey_is_left_out()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (_, personId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await ActiveSurveyAsync(admin, "Clima", personId);
        await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both("Borrador", "Borrador")));

        var response = await ExportAsync(admin, _companyId);

        using var book = await WorkbookOfAsync(response);
        Assert.Equal(["Clima"], book.Worksheets.Select(w => w.Name));
    }

    /// <summary>A survey that has closed is still reported: dropping it would read as never having run.</summary>
    [Fact]
    public async Task A_closed_survey_is_still_reported()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (_, personId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var surveyId = await ActiveSurveyAsync(admin, "Cerrada", personId);
        (await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        var response = await ExportAsync(admin, _companyId);

        using var book = await WorkbookOfAsync(response);
        Assert.Contains("Cerrada", book.Worksheets.Select(w => w.Name));
    }

    [Fact]
    public async Task The_file_is_named_for_the_company_and_the_day()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (_, personId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await ActiveSurveyAsync(admin, "Clima", personId);

        var response = await ExportAsync(admin, _companyId);

        var name = response.Content.Headers.ContentDisposition?.FileNameStar
                   ?? response.Content.Headers.ContentDisposition?.FileName;
        Assert.NotNull(name);
        // ASCII only, accents folded, and the day on the end.
        Assert.StartsWith("estado-servicio-publico-de-heredia-", name!.Trim('"'), StringComparison.Ordinal);
        Assert.EndsWith(".xlsx", name.Trim('"'), StringComparison.Ordinal);
    }

    /// <summary>A list of named people is personal data: another tenant's administrator is refused.</summary>
    [Fact]
    public async Task Another_companys_administrator_is_forbidden()
    {
        var otherCompanyId = await _harness.SeedCompanyAsync("Otra Empresa");
        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, otherCompanyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await ExportAsync(intruder, _companyId)).StatusCode);
    }

    [Fact]
    public async Task An_employee_of_the_company_is_forbidden()
    {
        var employee = await _harness.ClientAsync(Roles.Employee, _companyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await ExportAsync(employee, _companyId)).StatusCode);
    }

    [Fact]
    public async Task An_unknown_company_is_not_found()
    {
        var admin = await _harness.ClientAsync(Roles.SuperAdmin, _companyId);

        Assert.Equal(HttpStatusCode.NotFound, (await ExportAsync(admin, Guid.NewGuid())).StatusCode);
    }

    /// <summary>A company with nothing distributed gets an openable file that says so.</summary>
    [Fact]
    public async Task A_company_with_no_distributed_surveys_gets_an_openable_file()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await ExportAsync(admin, _companyId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var book = await WorkbookOfAsync(response);
        Assert.Single(book.Worksheets);
    }

    /// <summary>
    /// A list of named people leaving the server is the disclosure "who exported this data" is
    /// asked about, so the read is audited — the same marker the per-survey export carries.
    /// </summary>
    [Fact]
    public async Task The_export_is_written_to_the_audit_log()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var (_, personId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await ActiveSurveyAsync(admin, "Clima", personId);

        (await ExportAsync(admin, _companyId)).EnsureSuccessStatusCode();

        var logged = await _harness.WithDbAsync(async db => await db.AuditLogs
            .AsNoTracking()
            .AnyAsync(a => a.CompanyId == _companyId && a.Action.Contains("participation") && a.Action.Contains("export")));
        Assert.True(logged, "the status export should be written to audit_logs");
    }
}
