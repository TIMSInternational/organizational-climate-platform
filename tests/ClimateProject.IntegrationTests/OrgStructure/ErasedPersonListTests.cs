using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.IntegrationTests.Surveys;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// «Eliminar persona» (ruled 2026-11-08) is the GDPR erasure behind a button. The account row
/// survives, pseudonymised, because sixteen RESTRICT keys hold it -- but it is nobody any more,
/// and a row reading "Erased user" left in the list it was deleted from would read as a failure.
/// </summary>
[Collection("Postgres")]
public class ErasedPersonListTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public ErasedPersonListTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"erased-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Erasure Co");

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task An_erased_person_leaves_the_people_list_and_everyone_else_stays()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var (_, erased) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        var (_, kept) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);

        (await operatorClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(erased, true))).EnsureSuccessStatusCode();

        var list = await operatorClient.GetStringAsync($"/admin/users?companyId={_companyId}");
        Assert.DoesNotContain(erased.ToString(), list);
        Assert.DoesNotContain("erased.invalid", list);
        Assert.Contains(kept.ToString(), list);
    }
}
