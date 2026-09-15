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
        _factory = postgres.App;
    }

    private readonly AuthWebApplicationFactory _factory;

    /// <summary>
    /// A company that has run no survey has no cycles. Still the empty envelope, but now
    /// because there is nothing to report rather than because the route cannot report.
    /// </summary>
    [Fact]
    public async Task Ciclos_endpoint_returns_empty_envelope_for_a_company_with_no_surveys()
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
    public async Task Hallazgos_endpoint_accepts_both_filters_and_returns_empty_for_a_company_with_no_surveys()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/hallazgos?company_id={Guid.NewGuid()}&ciclo_id=some-ciclo&hallazgo_id=some-hallazgo");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<HallazgosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Empty(envelope.Data.Hallazgos);
    }

    /// <summary>
    /// This case used to assert 200 for an empty body, and that was correct while the route was
    /// a no-op: there was nothing a body could be wrong about.
    ///
    /// The route became real on 2026-09-15, which inverts the argument rather than abandoning
    /// it — the same way #385 inverted it for /ciclos-encuesta and /hallazgos. A 200 is now a
    /// promise that notifications were raised, and `DailySemaforoWorker` acts on that promise by
    /// marking its row `EstadoEnvio = Enviado` and never raising the trigger again. So a request
    /// that names no plan and no message must fail loudly, not succeed quietly.
    ///
    /// The live behaviour is covered by `TrackingSendNotificationTests`, which asserts rows
    /// rather than status codes, because a status-code test would have passed against the stub.
    /// </summary>
    [Fact]
    public async Task SendNotification_endpoint_refuses_an_empty_body_now_that_it_really_notifies()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.PostAsync("/api/internal/send-notification", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // These two USED to assert an empty 200 for a non-GUID company_id, and did so on
    // purpose: while /ciclos-encuesta and /hallazgos were unconditional stubs, failing
    // loudly on a tenant key they did not need was the worse behaviour, and a prior pass
    // that added validation to them was correctly reverted.
    //
    // #385 made both routes real, which inverts the argument rather than abandoning it: an
    // empty list is now indistinguishable from a correct answer, so a deployment whose
    // ProcomerCompanyId is still the "" default would quietly ship a tracking export of raw
    // hallazgo ids -- exactly the client-visible defect #385 closes. The tests are updated
    // rather than deleted so the reversal stays visible; the new verdict is a 400, and
    // TrackingCiclosHallazgosEndpointsTests asserts it names the parameter.
    //
    // /send-notification is no longer a stub either (2026-09-15): the notifications domain its
    // comment was waiting on had existed for some time, and the case above now asserts the 400
    // that replaced its permissive 200.
    [Fact]
    public async Task Ciclos_endpoint_rejects_a_non_guid_company_id_now_that_it_returns_real_data()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync("/api/internal/ciclos-encuesta?company_id=not-a-guid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Hallazgos_endpoint_rejects_a_non_guid_company_id_now_that_it_returns_real_data()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync("/api/internal/hallazgos?company_id=not-a-guid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
