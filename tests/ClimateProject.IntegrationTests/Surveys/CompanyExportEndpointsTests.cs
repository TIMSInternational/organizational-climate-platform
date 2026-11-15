using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// <c>GET /admin/companies/{id}/exports/bundle</c>, the «Descargar en Excel» wizard's download:
/// who may take which file, and that what arrives is one workbook or a zip of them.
/// </summary>
[Collection("Postgres")]
public class CompanyExportEndpointsTests : IAsyncLifetime
{
    private const string Xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public CompanyExportEndpointsTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"bundle-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Cooperativa Austral", "es");
        _otherCompanyId = await _harness.SeedCompanyAsync("Instituto Norte", "es");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> BundleAsync(HttpClient client, string query, Guid? companyId = null)
        => client.GetAsync($"/admin/companies/{companyId ?? _companyId}/exports/bundle?{query}");

    [Fact]
    public async Task A_company_admin_gets_three_workbooks_in_one_zip()
    {
        var survey = await SeedSurveyAsync("Clima");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, $"survey={survey}&file=questionnaire&file=status&file=results&group=department");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);
        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var names = zip.Entries.Select(e => e.Name).ToList();
        Assert.Equal(3, names.Count);
        Assert.StartsWith("cuestionario-cooperativa-austral-", names[0], StringComparison.Ordinal);
        Assert.StartsWith("estado-cooperativa-austral-", names[1], StringComparison.Ordinal);
        Assert.StartsWith("resultados-cooperativa-austral-", names[2], StringComparison.Ordinal);

        // Each entry is a workbook that opens.
        foreach (var entry in zip.Entries)
        {
            using var stream = new MemoryStream();
            await entry.Open().CopyToAsync(stream);
            using var book = new XLWorkbook(new MemoryStream(stream.ToArray()));
            Assert.NotEmpty(book.Worksheets);
        }
    }

    [Fact]
    public async Task One_file_arrives_as_the_workbook_itself()
    {
        var survey = await SeedSurveyAsync("Clima");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, $"survey={survey}&file=questionnaire");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Xlsx, response.Content.Headers.ContentType?.MediaType);
        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var sheet = book.Worksheet("Clima");
        Assert.Equal("Mi jefatura me respeta.", sheet.Cell(5, 5).GetString());
        Assert.Equal("My manager respects me.", sheet.Cell(5, 6).GetString());
    }

    /// <summary>
    /// The redesign (after #666): the client's logo on a cover sheet and their colour on every
    /// header, measured through the endpoint a download actually calls, with the logo uploaded
    /// and the colour set through the product's own endpoints.
    /// </summary>
    [Fact]
    public async Task Every_file_wears_the_companys_logo_and_colour()
    {
        var survey = await SeedSurveyAsync("Clima");
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var logo = new ByteArrayContent(Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="));
        logo.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        (await operatorClient.PutAsync($"/admin/companies/{_companyId}/logo", logo)).EnsureSuccessStatusCode();
        (await operatorClient.PutAsJsonAsync($"/admin/companies/{_companyId}/settings", new ClimateProject.Application.OrgStructure.UpdateCompanySettingsRequest(
            null, null, null, null, null, null, null, null, "#0B6E4F", null, null, null))).EnsureSuccessStatusCode();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, $"survey={survey}&file=questionnaire");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var cover = book.Worksheet(1);
        Assert.Equal("Portada", cover.Name);
        Assert.Single(cover.Pictures);
        Assert.Contains(cover.CellsUsed(), c => c.GetString().StartsWith("Cooperativa Austral", StringComparison.Ordinal));
        Assert.Equal("FF0B6E4F", book.Worksheet("Clima").Cell(4, 1).Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
    }

    [Fact]
    public async Task The_response_workbook_is_refused_to_a_company_admin_whatever_else_is_asked()
    {
        var survey = await SeedSurveyAsync("Clima");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, $"survey={survey}&file=questionnaire&file=responses");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task TIMS_gets_all_four_including_the_response_workbook_and_the_download_is_audited_as_it()
    {
        var survey = await SeedSurveyAsync("Clima");
        var (tims, timsId) = await _harness.IdentifiedClientAsync(Roles.SuperAdmin, null);

        var response = await BundleAsync(tims, $"survey={survey}&file=responses&file=questionnaire&file=status&file=results");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        Assert.Equal(4, zip.Entries.Count);
        Assert.StartsWith("respuestas-", zip.Entries[0].Name, StringComparison.Ordinal);

        // Recorded under the response workbook's own action, so "who read the answers" has one
        // answer however the workbook was downloaded.
        var audited = await _harness.WithDbAsync(db => db.AuditLogs
            .AsNoTracking()
            .AnyAsync(a => a.UserId == timsId
                           && a.Action == Api.Endpoints.ResponseExportEndpoints.ExportAction
                           && a.Resource == Api.Endpoints.ResponseExportEndpoints.ExportResource));
        Assert.True(audited, "a bundle with the response workbook must be audited as a response export");
    }

    [Fact]
    public async Task Every_download_is_written_to_the_audit_log()
    {
        var survey = await SeedSurveyAsync("Clima");
        var (admin, adminId) = await _harness.IdentifiedClientAsync(Roles.CompanyAdmin, _companyId);

        (await BundleAsync(admin, $"survey={survey}&file=questionnaire")).EnsureSuccessStatusCode();

        var logged = await _harness.WithDbAsync(db => db.AuditLogs
            .AsNoTracking()
            .AnyAsync(a => a.UserId == adminId && a.Action.Contains("export")));
        Assert.True(logged, "the bundle download should be written to audit_logs");
    }

    [Fact]
    public async Task Another_companys_admin_is_refused()
    {
        await SeedSurveyAsync("Clima");
        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

        var response = await BundleAsync(intruder, "file=questionnaire");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_survey_of_another_company_or_a_draft_is_refused_in_words()
    {
        await SeedSurveyAsync("Clima");
        var foreign = await SeedSurveyAsync("Ajena", _otherCompanyId);
        var draft = await SeedSurveyAsync("Borrador", activate: false);
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        foreach (var id in new[] { foreign, draft })
        {
            var response = await BundleAsync(admin, $"survey={id}&file=questionnaire");
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("borrador", await MessageAsync(response), StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData("", "Name at least one file")]
    [InlineData("file=everything", "Unknown file 'everything'")]
    [InlineData("file=results&group=shoe_size", "Unknown group 'shoe_size'")]
    public async Task A_request_it_cannot_honour_is_refused_in_words(string query, string expected)
    {
        await SeedSurveyAsync("Clima");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(expected, await MessageAsync(response), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_results_workbook_carries_aggregates_and_no_open_answer()
    {
        var survey = await SeedSurveyAsync("Clima");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await BundleAsync(admin, $"survey={survey}&file=results");

        using var book = new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
        var sheet = book.Worksheet("Clima");
        Assert.Equal("P01", sheet.Cell(6, 1).GetString());
        Assert.Equal(4.0, sheet.Cell(6, 6).GetValue<double>());
        Assert.DoesNotContain(book.Worksheets.SelectMany(w => w.CellsUsed()), c => c.GetString().Contains("texto privado", StringComparison.Ordinal));
    }

    private static async Task<string> MessageAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("message").GetString() ?? string.Empty;
    }

    /// <summary>A survey with one scale question and one open question, and 4 complete responses.</summary>
    private async Task<Guid> SeedSurveyAsync(string title, Guid? companyId = null, bool activate = true)
    {
        var company = companyId ?? _companyId;
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, company);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            company,
            title: SurveyTestHarness.Both(title, title),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("My manager respects me.", "Mi jefatura me respeta."),
                    "likert",
                    ScaleMin: 1,
                    ScaleMax: 5,
                    Order: 0,
                    Category: "liderazgo"),
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("What would you change?", "¿Qué cambiaría?"),
                    "open_ended",
                    Order: 1),
            ]));
        if (!activate)
        {
            return survey.Id;
        }

        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var scale = survey.Questions.Single(q => q.Type == "likert").Id;
        var open = survey.Questions.Single(q => q.Type == "open_ended").Id;

        await _harness.WithDbAsync(async db =>
        {
            for (var i = 0; i < 4; i++)
            {
                var responseId = Guid.NewGuid();
                db.Responses.Add(new Response
                {
                    Id = responseId,
                    SurveyId = survey.Id,
                    CompanyId = company,
                    SessionId = Guid.NewGuid().ToString("N"),
                    Language = ContentLanguages.Spanish,
                    IsComplete = true,
                    IsAnonymous = true,
                    StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                    CompletionTime = DateTimeOffset.UtcNow,
                    TotalTimeSeconds = 300,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
                db.QuestionResponses.Add(new QuestionResponse { ResponseId = responseId, QuestionId = scale, ResponseValue = "4" });
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = open,
                    ResponseValue = JsonSerializer.Serialize("texto privado"),
                    ResponseText = "texto privado",
                });
            }

            await db.SaveChangesAsync();
        });

        return survey.Id;
    }
}
