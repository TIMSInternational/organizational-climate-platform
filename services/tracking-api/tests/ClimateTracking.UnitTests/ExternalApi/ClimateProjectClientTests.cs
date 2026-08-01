using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Infrastructure.ExternalApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ClimateTracking.UnitTests.ExternalApi;

public class ClimateProjectClientTests
{
    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }

    private static ClimateProjectClient CreateClient(StubHttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://climate-project.test"),
        };
        var options = Options.Create(new ClimateProjectClientOptions
        {
            BaseUrl = "http://climate-project.test",
            InternalApiKey = "test-internal-key",
            ProcomerCompanyId = "CO-014",
        });
        return new ClimateProjectClient(httpClient, options);
    }

    private static HttpResponseMessage JsonResponse(object body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
    };

    [Fact]
    public async Task GetCiclosAsync_sends_bearer_header_and_company_id_query_param()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse(new
        {
            success = true,
            data = new
            {
                ciclos = new[]
                {
                    new
                    {
                        ciclo_id = "survey-q3-2026",
                        fecha_apertura = "2026-07-01T00:00:00.000Z",
                        fecha_cierre = "2026-07-15T00:00:00.000Z",
                        numero_preguntas = 48,
                        estado = "abierto",
                        company_id = "CO-014",
                    },
                },
            },
        }));
        var client = CreateClient(handler);

        var ciclos = await client.GetCiclosAsync(CancellationToken.None);

        Assert.Single(ciclos);
        Assert.Equal("survey-q3-2026", ciclos[0].CicloId);
        Assert.Equal(48, ciclos[0].NumeroPreguntas);
        Assert.Equal("abierto", ciclos[0].Estado);

        var request = handler.Requests[0];
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal("test-internal-key", request.Headers.Authorization.Parameter);
        Assert.Contains("company_id=CO-014", request.RequestUri!.Query);
    }

    [Fact]
    public async Task GetHallazgosAsync_passes_ciclo_id_and_company_id_query_params()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse(new
        {
            success = true,
            data = new { hallazgos = Array.Empty<object>() },
        }));
        var client = CreateClient(handler);

        await client.GetHallazgosAsync("survey-q3-2026", CancellationToken.None);

        var request = handler.Requests[0];
        Assert.Contains("ciclo_id=survey-q3-2026", request.RequestUri!.Query);
        Assert.Contains("company_id=CO-014", request.RequestUri!.Query);
    }

    [Fact]
    public async Task GetHallazgoByIdAsync_passes_hallazgo_id_and_company_id_and_returns_first_match()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse(new
        {
            success = true,
            data = new
            {
                hallazgos = new[]
                {
                    new { hallazgo_id = "HAL-1", nodo_id = "ND-1", categoria = "Clima", resultado_pct = 0.5m, benchmark_sector_pct = (decimal?)null, resultado_anio_anterior_pct = (decimal?)null, ciclo_id = "CIC-2026-Q3" },
                },
            },
        }));
        var client = CreateClient(handler);

        var result = await client.GetHallazgoByIdAsync("HAL-1", CancellationToken.None);

        var request = handler.Requests[0];
        Assert.Contains("hallazgo_id=HAL-1", request.RequestUri!.Query);
        Assert.Contains("company_id=CO-014", request.RequestUri!.Query);
        Assert.Equal("CIC-2026-Q3", result!.CicloId);
    }

    [Fact]
    public async Task GetHallazgoByIdAsync_returns_null_when_not_found()
    {
        var handler = new StubHttpMessageHandler(_ => JsonResponse(new
        {
            success = true,
            data = new { hallazgos = Array.Empty<object>() },
        }));
        var client = CreateClient(handler);

        var result = await client.GetHallazgoByIdAsync("HAL-missing", CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task SendNotificationAsync_posts_the_expected_body()
    {
        HttpRequestMessage? capturedRequest = null;
        string? capturedBody = null;
        var handler = new StubHttpMessageHandler(req =>
        {
            capturedRequest = req;
            capturedBody = req.Content!.ReadAsStringAsync().Result;
            return JsonResponse(new { success = true, data = new { notificacion_id = "NOT-1" } });
        });
        var client = CreateClient(handler);

        await client.SendNotificationAsync(
            new SendNotificationRequest(["PER-0231"], "alerta_15_dias", "El plan vence", "PA-1"),
            CancellationToken.None);

        Assert.Equal(HttpMethod.Post, capturedRequest!.Method);
        Assert.Contains("destinatarios_ids", capturedBody);
        Assert.Contains("alerta_15_dias", capturedBody);
    }

    [Fact]
    public async Task Retries_transient_failures_before_giving_up()
    {
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://climate-project.test") };
        var options = Options.Create(new ClimateProjectClientOptions
        {
            BaseUrl = "http://climate-project.test",
            InternalApiKey = "test-internal-key",
            ProcomerCompanyId = "CO-014",
        });
        var client = new ClimateProjectClient(httpClient, options);

        await Assert.ThrowsAnyAsync<HttpRequestException>(
            () => client.GetNodosAsync(CancellationToken.None));

        // The client itself doesn't retry — retry/circuit-breaker is applied at the
        // DI-registered HttpClient policy layer (Program.cs), not inside this class.
        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task DI_wired_client_retries_transient_failures_via_Polly_before_giving_up()
    {
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var services = new ServiceCollection();
        services.AddClimateProjectClient(
            new ClimateProjectClientOptions
            {
                BaseUrl = "http://climate-project.test",
                InternalApiKey = "test-internal-key",
                ProcomerCompanyId = "CO-014",
            },
            httpClientBuilder => httpClientBuilder.ConfigurePrimaryHttpMessageHandler(() => handler),
            retryDelay: _ => TimeSpan.Zero);

        using var provider = services.BuildServiceProvider();
        var client = provider.GetRequiredService<IClimateProjectClient>();

        await Assert.ThrowsAnyAsync<Exception>(() => client.GetNodosAsync(CancellationToken.None));

        // 1 initial attempt + 3 retries = 4 calls.
        Assert.Equal(4, handler.CallCount);
    }
}
