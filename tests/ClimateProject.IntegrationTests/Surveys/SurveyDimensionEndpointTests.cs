using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// GET /surveys/dimensions -- the wizard's company-history source. The categories a
/// tenant authored are that tenant's vocabulary, so the tenant boundary here is the
/// whole point of the tests, not scaffolding around them.
/// </summary>
[Collection("Postgres")]
public class SurveyDimensionEndpointTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;

    public SurveyDimensionEndpointTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"dim-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Dimension Co A");
        _companyBId = await _harness.SeedCompanyAsync("Dimension Co B");

        var adminA = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);
        await SurveyTestHarness.CreateSurveyAsync(adminA, SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Q1"), "likert", Order: 0, Category: "trust"),
                // Authored with a stray space: the server stores category verbatim, and
                // the endpoint must not offer 'trust' and 'trust ' as two suggestions.
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Q2"), "likert", Order: 1, Category: "trust "),
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Q3"), "likert", Order: 2, Category: "workload"),
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Q4"), "likert", Order: 3),
            ]));

        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        await SurveyTestHarness.CreateSurveyAsync(adminB, SurveyTestHarness.MinimalRequest(
            _companyBId,
            questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("Q1"), "likert", Order: 0, Category: "tenant_b_private"),
            ]));
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task CompanyAdmin_gets_their_own_distinct_trimmed_categories_and_nobody_elses()
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await client.GetFromJsonAsync<SurveyDimensionsResponse>("/surveys/dimensions");

        Assert.Equal(["trust", "workload"], response!.Dimensions);
    }

    [Fact]
    public async Task CompanyAdmin_naming_another_company_is_refused()
    {
        var client = await _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

        var response = await client.GetAsync($"/surveys/dimensions?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Employee_is_refused()
    {
        // The picker is an authoring surface. An employee who can read suggestions can
        // enumerate the categories of surveys they were never invited to.
        var client = await _harness.ClientAsync(Roles.Employee, _companyAId);

        var response = await client.GetAsync("/surveys/dimensions");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_scopes_by_the_company_they_name()
    {
        var client = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var scoped = await client.GetFromJsonAsync<SurveyDimensionsResponse>(
            $"/surveys/dimensions?companyId={_companyBId}");

        Assert.Equal(["tenant_b_private"], scoped!.Dimensions);
    }
}
