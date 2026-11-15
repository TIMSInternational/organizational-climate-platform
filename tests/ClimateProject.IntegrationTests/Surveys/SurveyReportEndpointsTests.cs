using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The «Generar informe» routes against a real database: the door (the results screen's own
/// <c>CanAdminister</c>), the refusals a caller can act on, and a file that is a PDF.
/// </summary>
[Collection("Postgres")]
public class SurveyReportEndpointsTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _operacionesId;
    private Guid _finanzasId;

    public SurveyReportEndpointsTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"report-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Meridiano", "es");
        _companyBId = await _harness.SeedCompanyAsync("Otra Empresa", "es");
        _operacionesId = await _harness.SeedDepartmentAsync(_companyAId, "Operaciones");
        _finanzasId = await _harness.SeedDepartmentAsync(_companyAId, "Finanzas");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task A_company_admin_downloads_their_surveys_report_as_a_pdf()
    {
        var survey = await SeedSurveyAsync();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await admin.GetAsync($"/surveys/{survey}/export/report?lang=es&cross=department*gender");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("informe-clima-organizacional-2026.pdf", response.Content.Headers.ContentDisposition?.FileNameStar);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-1.4", Encoding.Latin1.GetString(bytes, 0, 8), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TIMS_reads_any_companys_report()
    {
        var survey = await SeedSurveyAsync();
        var tims = await _harness.ClientAsync(Roles.SuperAdmin, null);

        var response = await tims.GetAsync($"/surveys/{survey}/export/report");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Every_download_is_audited_against_the_surveys_company_even_for_a_company_less_TIMS_account()
    {
        var survey = await SeedSurveyAsync();
        var (tims, timsId) = await _harness.IdentifiedClientAsync(Roles.SuperAdmin, null);

        (await tims.GetAsync($"/surveys/{survey}/export/report")).EnsureSuccessStatusCode();

        var logged = await _harness.WithDbAsync(db => db.AuditLogs
            .AsNoTracking()
            .AnyAsync(a => a.UserId == timsId && a.CompanyId == _companyAId && a.Action.Contains("export")));
        Assert.True(logged, "the report download should be written to audit_logs under the survey's company");
    }

    [Theory]
    [InlineData("/export/report")]
    [InlineData("/report/options")]
    [InlineData("/report/preview")]
    public async Task Another_companys_admin_is_refused_on_every_route(string route)
    {
        var survey = await SeedSurveyAsync();
        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);

        var response = await intruder.GetAsync($"/surveys/{survey}{route}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_is_refused()
    {
        var survey = await SeedSurveyAsync();
        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId);

        var response = await employee.GetAsync($"/surveys/{survey}/export/report");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_survey_is_404()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await admin.GetAsync($"/surveys/{Guid.NewGuid()}/export/report");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_cross_on_a_variable_the_survey_does_not_have_is_refused_naming_the_ones_it_has()
    {
        var survey = await SeedSurveyAsync();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await admin.GetAsync($"/surveys/{survey}/export/report?cross=department*shoe_size");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var message = await MessageAsync(response);
        Assert.Contains("shoe_size", message, StringComparison.Ordinal);
        Assert.Contains("department, gender", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Another_companys_survey_cannot_be_the_comparison()
    {
        var survey = await SeedSurveyAsync();
        var foreign = await SeedSurveyAsync(_companyBId);
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await admin.GetAsync($"/surveys/{survey}/report/preview?compare={foreign}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("same company", await MessageAsync(response), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Another_companys_department_cannot_scope_the_report()
    {
        var survey = await SeedSurveyAsync();
        var foreignDepartment = await _harness.SeedDepartmentAsync(_companyBId, "Ajeno");
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await admin.GetAsync($"/surveys/{survey}/report/preview?department={foreignDepartment}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task The_options_list_the_departments_and_the_variables_the_survey_carries()
    {
        var survey = await SeedSurveyAsync();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var options = await admin.GetFromJsonAsync<SurveyReportOptionsResponse>($"/surveys/{survey}/report/options?lang=es");

        Assert.NotNull(options);
        Assert.Equal(["Finanzas", "Operaciones"], options!.Departments.Select(d => d.Name));
        Assert.Equal(["department", "gender"], options.Variables.Select(v => v.Field));
        Assert.Equal(20, options.CompletedCount);
        Assert.False(options.IsSuppressed);
    }

    [Fact]
    public async Task The_preview_counts_the_protected_cells_of_the_pdf_it_describes()
    {
        // Finanzas has 6 women and 2 men. The 2 men are under 3. The 6 women beside Finanzas'
        // total would give the 2 away by subtraction, so they are protected too. So are
        // Operaciones' 5 men: beside the men's total of 7 they would give away Finanzas' 2.
        // Only Operaciones' 7 women print a number.
        var survey = await SeedSurveyAsync();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var preview = await admin.GetFromJsonAsync<SurveyReportPreviewResponse>($"/surveys/{survey}/report/preview?cross=department*gender");

        var cross = Assert.Single(preview!.Crosses);
        Assert.Equal(4, cross.Groups);
        Assert.Equal(3, cross.Protected);
        Assert.Equal(1, cross.Disclosed);
        Assert.Equal(3, preview.ProtectedCells);
        Assert.Equal(1, preview.DisclosedCells);
        Assert.True(preview.PageCount >= 1);
    }

    private static async Task<string> MessageAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("message").GetString() ?? string.Empty;
    }

    /// <summary>
    /// A closed climate survey of 20 complete responses: Operaciones 7 women and 5 men,
    /// Finanzas 6 women and 2 men, three Likert questions in two dimensions.
    /// </summary>
    private async Task<Guid> SeedSurveyAsync(Guid? companyId = null)
    {
        var company = companyId ?? _companyAId;
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, company);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            company,
            title: SurveyTestHarness.Both("Organisational Climate 2026", "Clima Organizacional 2026"),
            language: ContentLanguages.Both,
            questions:
            [
                Likert("My manager respects me.", "Mi jefatura me respeta.", "liderazgo", 0),
                Likert("My manager recognises my work.", "Mi jefatura reconoce mi trabajo.", "liderazgo", 1),
                Likert("My workload lets me rest.", "Mi carga me permite descansar.", "carga", 2),
            ]));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var questionIds = survey.Questions.Select(q => q.Id).ToList();
        if (companyId is null)
        {
            await SeedResponsesAsync(survey.Id, company, questionIds, _operacionesId, "mujer", 7, 4);
            await SeedResponsesAsync(survey.Id, company, questionIds, _operacionesId, "hombre", 5, 3);
            await SeedResponsesAsync(survey.Id, company, questionIds, _finanzasId, "mujer", 6, 5);
            await SeedResponsesAsync(survey.Id, company, questionIds, _finanzasId, "hombre", 2, 2);
        }

        return survey.Id;
    }

    private static CreateSurveyQuestionInput Likert(string en, string es, string category, int order)
        => new(
            SurveyTestHarness.Both(en, es),
            "likert",
            ScaleMin: 1,
            ScaleMax: 5,
            ScaleLabelMin: SurveyTestHarness.Both("Strongly disagree", "Totalmente en desacuerdo"),
            ScaleLabelMax: SurveyTestHarness.Both("Strongly agree", "Totalmente de acuerdo"),
            Order: order,
            Category: category);

    private Task SeedResponsesAsync(Guid surveyId, Guid companyId, IReadOnlyList<Guid> questionIds, Guid departmentId, string gender, int count, int score)
        => _harness.WithDbAsync(async db =>
        {
            for (var i = 0; i < count; i++)
            {
                var responseId = Guid.NewGuid();
                db.Responses.Add(new Response
                {
                    Id = responseId,
                    SurveyId = surveyId,
                    CompanyId = companyId,
                    UserId = null,
                    DepartmentId = departmentId,
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

                foreach (var questionId in questionIds)
                {
                    // Stored as a JSON number, the shape the respond endpoint writes for a scale.
                    db.QuestionResponses.Add(new QuestionResponse
                    {
                        ResponseId = responseId,
                        QuestionId = questionId,
                        ResponseValue = score.ToString(CultureInfo.InvariantCulture),
                        ResponseText = null,
                    });
                }

                db.ResponseDemographics.Add(new ResponseDemographic
                {
                    ResponseId = responseId,
                    Field = "gender",
                    Value = JsonSerializer.Serialize(gender),
                });
            }

            await db.SaveChangesAsync();
        });
}
