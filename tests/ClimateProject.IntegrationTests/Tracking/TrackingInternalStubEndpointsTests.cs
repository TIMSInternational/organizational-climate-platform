using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Tracking;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingInternalStubEndpointsTests
{
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public TrackingInternalStubEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    private readonly AuthWebApplicationFactory _factory;

    [Fact]
    public async Task Ciclos_endpoint_returns_empty_envelope_with_correct_shape()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/ciclos-encuesta?company_id={Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<CiclosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Ciclos);
    }

    [Fact]
    public async Task Hallazgos_endpoint_accepts_ciclo_id_and_hallazgo_id_filters_and_returns_empty()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/hallazgos?company_id={Guid.NewGuid()}&ciclo_id=some-ciclo&hallazgo_id=some-hallazgo");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<HallazgosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Hallazgos);
    }

    [Fact]
    public async Task SendNotification_endpoint_returns_success_envelope()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.PostAsync("/api/internal/send-notification", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // Regression test for the finding that a prior pass added company_id GUID validation to
    // these stub routes, deviating from the plan's Task 3 Step 2 (unconditional empty/no-op
    // stub bodies, no validation) without it being requested or approved. Assert the stubs
    // stay permissive -- see the class-level contract note on TrackingInternalEndpoints.
    [Fact]
    public async Task Ciclos_endpoint_returns_empty_envelope_even_for_a_non_guid_company_id()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync("/api/internal/ciclos-encuesta?company_id=not-a-guid");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<CiclosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Ciclos);
    }

    [Fact]
    public async Task Hallazgos_endpoint_returns_empty_envelope_even_for_a_non_guid_company_id()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync("/api/internal/hallazgos?company_id=not-a-guid");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<HallazgosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Hallazgos);
    }
}
