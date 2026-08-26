using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Jwt = System.IdentityModel.Tokens.Jwt;

namespace ClimateTracking.IntegrationTests.Endpoints;

public class PlanesAccionHallazgoLookupTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanesAccionHallazgoLookupTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public HallazgoDto? HallazgoToReturn { get; set; }
        public Exception? ExceptionToThrowOnHallazgoLookup { get; set; }

        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<NodoDto>>([]);
        public Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PersonaDto>>([]);
        public Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CicloDto>>([]);
        public Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<HallazgoDto>>([]);
        public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken)
        {
            if (ExceptionToThrowOnHallazgoLookup is not null)
            {
                throw ExceptionToThrowOnHallazgoLookup;
            }

            return Task.FromResult(HallazgoToReturn);
        }
        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    private readonly FakeClimateProjectClient _fakeClient = new();

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", TrackingJwtSecret);
            builder.UseSetting("ProcomerCompanyId", ProcomerCompanyId);
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            // The API host co-hosts CacheSyncWorker and DailySemaforoWorker (#219). Idle here:
            // a test host that swept its own database and dialled a nonexistent
            // climate-project on every boot would be racing the test it is hosting.
            builder.UseSetting("Workers:Enabled", "false");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IClimateProjectClient>();
                services.AddSingleton<IClimateProjectClient>(_fakeClient);
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-014"))
        {
            db.Nodos.Add(new NodoCache
            {
                ExternalId = "ND-014",
                Nombre = "Comercial Exterior",
                LiderExternalId = "PER-0231",
                CantidadColaboradores = 8,
                Activo = true,
                LastSyncedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
    }

    private HttpClient CreateAuthenticatedClient(string sub, string role, string nodoId)
    {
        var client = _factory.CreateClient();
        var handler = new Jwt.JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TrackingJwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("sub", sub),
            new Claim("role", role),
            new Claim("nodoId", nodoId),
            new Claim("email", $"{sub}@procomer.com"),
            new Claim("name", sub),
            new Claim("companyId", ProcomerCompanyId),
            new Claim("isActive", "true"),
        };
        var token = new Jwt.JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(1), signingCredentials: creds);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", handler.WriteToken(token));
        return client;
    }

    [Fact]
    public async Task CreatingAPlanWithAHallazgo_setsCicloEncuestaExternalId_fromTheClientLookup()
    {
        _fakeClient.HallazgoToReturn = new HallazgoDto("HAL-1", "ND-014", "Clima", 0.5m, null, null, "CIC-2026-Q3");
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = "HAL-1",
            descripcionQue = "Plan con hallazgo",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("CIC-2026-Q3", body.GetProperty("cicloEncuestaExternalId").GetString());
    }

    [Fact]
    public async Task CreatingAPlanWithAHallazgoTheClientCannotFind_leavesCicloEncuestaExternalIdNull()
    {
        _fakeClient.HallazgoToReturn = null;
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = "HAL-missing",
            descripcionQue = "Plan con hallazgo inexistente",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        Assert.True(body.GetProperty("cicloEncuestaExternalId").ValueKind == JsonValueKind.Null);
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    [InlineData(typeof(Polly.CircuitBreaker.BrokenCircuitException))]
    [InlineData(typeof(TaskCanceledException))]
    public async Task CreatingAPlanWhenTheHallazgoLookupThrows_stillCreatesThePlan_withNullCicloEncuestaExternalId(
        Type exceptionType)
    {
        _fakeClient.ExceptionToThrowOnHallazgoLookup =
            (Exception)Activator.CreateInstance(exceptionType, "climate-project-api is unreachable")!;
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = "HAL-1",
            descripcionQue = "Plan creado con climate-project-api caido",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });

        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("cicloEncuestaExternalId").ValueKind == JsonValueKind.Null);
    }
}
