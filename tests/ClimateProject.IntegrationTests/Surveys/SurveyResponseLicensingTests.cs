using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Licence enforcement where it actually bites: the respond endpoint (#118 + service licensing).
/// A completed response spends one seat for the company + service; the seat is only ever spent by
/// the guarded UPDATE, inside the same transaction as the completion, so a refusal leaves nothing
/// behind and the last seat is never oversold. These are end-to-end against real Postgres because
/// the guarantee is transactional — an in-memory test cannot see the rollback.
/// </summary>
[Collection("Postgres")]
public class SurveyResponseLicensingTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyResponseLicensingTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"licence-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Licence Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private Task<HttpClient> EmployeeAsync() => _harness.ClientAsync(Roles.Employee, _companyId, _departmentId);

    private static CreateSurveyQuestionInput WorkModeQuestion()
        => new(
            LocalizedInput.FromBare("Where do you work?"),
            QuestionTypes.MultipleChoice,
            Options:
            [
                new CreateSurveyQuestionOptionInput("remote", LocalizedInput.FromBare("Remote")),
                new CreateSurveyQuestionOptionInput("hybrid", LocalizedInput.FromBare("Hybrid")),
            ],
            Required: false,
            Order: 0);

    private async Task<SurveyDetail> ActiveGeneralClimateSurveyAsync()
    {
        var admin = await AdminAsync();
        var request = new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Q3 Climate Survey"),
            CompanyId: _companyId,
            Type: ClimateServiceTypes.GeneralClimate,
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions: [WorkModeQuestion()],
            Settings: null,
            Language: null);

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey;
    }

    private static Task<HttpResponseMessage> SubmitAsync(HttpClient client, Guid surveyId, SubmitSurveyResponseRequest request)
        => client.PostAsJsonAsync($"/surveys/{surveyId}/responses", request);

    private Task GrantAsync(int seats) => _harness.WithDbAsync(db =>
        CompanyLicenses.GrantOrUpdateAsync(db, _companyId, ClimateServiceTypes.GeneralClimate, seats, null, DateTimeOffset.UtcNow, default));

    private Task<int> SeatsUsedAsync() => _harness.WithDbAsync(db => db.CompanyServiceLicenses
        .AsNoTracking().Where(l => l.CompanyId == _companyId).Select(l => l.SeatsUsed).FirstAsync());

    private Task<int> CompleteResponseCountAsync(Guid surveyId) => _harness.WithDbAsync(db =>
        db.Responses.AsNoTracking().CountAsync(r => r.SurveyId == surveyId && r.IsComplete));

    private Task<int> TotalResponseCountAsync(Guid surveyId) => _harness.WithDbAsync(db =>
        db.Responses.AsNoTracking().CountAsync(r => r.SurveyId == surveyId));

    [Fact]
    public async Task A_completion_is_allowed_and_provisions_nothing_when_the_company_has_no_licence()
    {
        var survey = await ActiveGeneralClimateSurveyAsync();
        var employee = await EmployeeAsync();

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);

        // Grandfathered: no licence row was invented, so the feature is inert until a super admin grants one.
        var licences = await _harness.WithDbAsync(db => CompanyLicenses.ListAsync(db, _companyId, default));
        Assert.Empty(licences);
        Assert.Equal(1, await CompleteResponseCountAsync(survey.Id));
    }

    [Fact]
    public async Task A_completion_consumes_one_seat_when_a_licence_exists()
    {
        var survey = await ActiveGeneralClimateSurveyAsync();
        await GrantAsync(5);
        var employee = await EmployeeAsync();

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        Assert.Equal(1, await SeatsUsedAsync());
    }

    [Fact]
    public async Task An_exhausted_licence_refuses_the_completion_and_persists_nothing()
    {
        var survey = await ActiveGeneralClimateSurveyAsync();
        await GrantAsync(1);

        var first = await SubmitAsync(await EmployeeAsync(), survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await SubmitAsync(await EmployeeAsync(), survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "hybrid")]));

        Assert.Equal(HttpStatusCode.PaymentRequired, second.StatusCode);

        // The one seat was not oversold, and the refused completion left no row at all — not even a partial.
        Assert.Equal(1, await SeatsUsedAsync());
        Assert.Equal(1, await CompleteResponseCountAsync(survey.Id));
        Assert.Equal(1, await TotalResponseCountAsync(survey.Id));

        var responseCount = await _harness.WithDbAsync(db =>
            db.Surveys.AsNoTracking().Where(s => s.Id == survey.Id).Select(s => s.ResponseCount).FirstAsync());
        Assert.Equal(1, responseCount);
    }

    [Fact]
    public async Task A_partial_save_consumes_no_seat()
    {
        var survey = await ActiveGeneralClimateSurveyAsync();
        await GrantAsync(5);
        var employee = await EmployeeAsync();

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            IsComplete: false));

        http.EnsureSuccessStatusCode();
        Assert.Equal(0, await SeatsUsedAsync());
    }
}
