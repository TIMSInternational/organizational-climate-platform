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

    private Task<SurveyDetail> ActiveGeneralClimateSurveyAsync()
        => ActiveSurveyAsync(ClimateServiceTypes.GeneralClimate);

    /// <summary>
    /// An ACTIVE survey whose <c>Type</c> is a real one the wizard can produce, carrying
    /// <paramref name="serviceType"/> as its licensed service (or none).
    /// </summary>
    /// <remarks>
    /// <b>`Type` is deliberately `periodic` here, and that is the whole point of #496.</b> This
    /// helper used to pass <c>Type: ClimateServiceTypes.GeneralClimate</c>, which the create
    /// endpoint accepted only because <c>Survey.Type</c> has no validation — and which no wizard
    /// can produce, since its vocabulary is periodic/pulse/engagement/satisfaction/onboarding/
    /// exit/custom. So every licence test passed against a survey shaped like nothing the product
    /// creates, and in production no seat was ever spent. The service now rides its own field.
    /// </remarks>
    private async Task<SurveyDetail> ActiveSurveyAsync(string? serviceType)
    {
        var admin = await AdminAsync();
        var request = new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Q3 Climate Survey"),
            CompanyId: _companyId,
            Type: "periodic",
            ServiceType: serviceType,
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

    private CreateSurveyRequest NewSurveyRequest(string? serviceType)
        => new(
            Title: LocalizedInput.FromBare("Service type check"),
            CompanyId: _companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions: [WorkModeQuestion()],
            Settings: null,
            Language: null,
            ServiceType: serviceType);

    /// <summary>
    /// **The reachability guard #496 asks for.** Every metered service must be settable through
    /// the endpoint the product actually calls, and must come back on the survey.
    /// </summary>
    /// <remarks>
    /// This is the test whose absence let the defect ship. The licence layer named three services;
    /// nothing checked that any of them could be attached to a survey by a real caller. Iterating
    /// <see cref="ClimateServiceTypes.Metered"/> itself — rather than three literals — means a
    /// service added to that list without a way to assign it fails here.
    /// </remarks>
    [Fact]
    public async Task Every_metered_service_can_be_assigned_through_the_create_endpoint()
    {
        var admin = await AdminAsync();

        Assert.NotEmpty(ClimateServiceTypes.Metered);
        foreach (var service in ClimateServiceTypes.Metered)
        {
            var survey = await SurveyTestHarness.CreateSurveyAsync(admin, NewSurveyRequest(service));
            Assert.Equal(service, survey.ServiceType);
        }
    }

    [Fact]
    public async Task A_service_outside_the_metered_vocabulary_is_refused_rather_than_stored()
    {
        var admin = await AdminAsync();

        // "periodic" is a real Survey.Type and precisely the kind of value that must NOT be
        // accepted here — confusing the two fields is the defect this endpoint now refuses.
        var response = await admin.PostAsJsonAsync("/surveys", NewSurveyRequest("periodic"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_survey_can_be_moved_onto_a_service_and_back_off_it()
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, NewSurveyRequest(null));
        Assert.Null(survey.ServiceType);

        var onto = await admin.PutAsJsonAsync($"/surveys/{survey.Id}",
            new UpdateSurveyRequest(ServiceType: ClimateServiceTypes.Microclimate));
        Assert.Equal(HttpStatusCode.OK, onto.StatusCode);
        Assert.Equal(ClimateServiceTypes.Microclimate, (await onto.Content.ReadFromJsonAsync<SurveyDetail>())!.ServiceType);

        // Empty string clears it; null would mean "leave unchanged", so a mis-assignment has to
        // have an explicit way back or a survey could never be taken off a service.
        var off = await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(ServiceType: ""));
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.Null((await off.Content.ReadFromJsonAsync<SurveyDetail>())!.ServiceType);
    }

    /// <summary>
    /// **The #496 regression test.** A survey whose `Type` is one the wizard actually produces
    /// still spends a seat, because the service rides `ServiceType`.
    /// </summary>
    /// <remarks>
    /// Before #496 this could not pass for any value of `Type` a real survey carries: metering
    /// compared the licence's `general_climate` against the survey's `periodic` and never matched.
    /// Every `Type` the wizard offers is exercised, so this fails the moment metering is wired
    /// back onto the cadence field.
    /// </remarks>
    [Theory]
    [InlineData("periodic")]
    [InlineData("pulse")]
    [InlineData("engagement")]
    [InlineData("satisfaction")]
    [InlineData("onboarding")]
    [InlineData("exit")]
    [InlineData("custom")]
    public async Task A_seat_is_spent_for_any_survey_type_the_wizard_can_produce(string surveyType)
    {
        var admin = await AdminAsync();
        var request = new CreateSurveyRequest(
            Title: LocalizedInput.FromBare($"{surveyType} climate survey"),
            CompanyId: _companyId,
            Type: surveyType,
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions: [WorkModeQuestion()],
            Settings: null,
            Language: null,
            ServiceType: ClimateServiceTypes.GeneralClimate);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        await GrantAsync(5);

        var http = await SubmitAsync(await EmployeeAsync(), survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        Assert.Equal(1, await SeatsUsedAsync());
    }

    /// <summary>
    /// The other half of the same rule: a survey nobody assigned to a service spends nothing,
    /// even when the company holds a licence with seats free.
    /// </summary>
    [Fact]
    public async Task A_survey_with_no_service_spends_nothing_even_when_a_licence_has_seats()
    {
        var survey = await ActiveSurveyAsync(serviceType: null);
        await GrantAsync(5);

        var http = await SubmitAsync(await EmployeeAsync(), survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync());
        Assert.Equal(1, await CompleteResponseCountAsync(survey.Id));
    }

    /// <summary>
    /// A seat is spent against the survey's OWN service, so a licence for a different service is
    /// untouched. Without this, "any active licence" and "the right licence" pass identically.
    /// </summary>
    [Fact]
    public async Task A_licence_for_another_service_is_not_spent()
    {
        var survey = await ActiveSurveyAsync(ClimateServiceTypes.OrganizationalCulture);
        await GrantAsync(5); // general_climate

        var http = await SubmitAsync(await EmployeeAsync(), survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        Assert.Equal(0, await SeatsUsedAsync());
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
