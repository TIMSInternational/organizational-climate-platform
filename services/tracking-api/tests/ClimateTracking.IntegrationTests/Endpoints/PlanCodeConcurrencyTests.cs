using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateTracking.Application.Auth;
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

public class PlanCodeConcurrencyTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanCodeConcurrencyTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<NodoDto>>([]);
        public Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PersonaDto>>([]);
        public Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CicloDto>>([]);
        public Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<HallazgoDto>>([]);
        public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken) =>
            Task.FromResult<HallazgoDto?>(null);
        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", TrackingJwtSecret);
            builder.UseSetting("ProcomerCompanyId", ProcomerCompanyId);
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IClimateProjectClient>();
                services.AddSingleton<IClimateProjectClient>(new FakeClimateProjectClient());
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-CONC"))
        {
            db.Nodos.Add(new NodoCache
            {
                ExternalId = "ND-CONC",
                Nombre = "Concurrency Test Node",
                LiderExternalId = "PER-CONC",
                CantidadColaboradores = 1,
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
    public async Task Concurrent_plan_creation_never_produces_duplicate_plan_codes()
    {
        var client = CreateAuthenticatedClient("PER-CONC", "company_admin", "ND-CONC");

        var tasks = Enumerable.Range(0, 20).Select(async i =>
        {
            var response = await client.PostAsJsonAsync("/api/planes-accion", new
            {
                nodoExternalId = "ND-CONC",
                hallazgoExternalId = (string?)null,
                descripcionQue = $"Concurrent plan {i}",
                metodologiaComo = "N/A",
                responsableEjecucionExternalId = "PER-CONC",
                fechaCompromiso = new DateOnly(2026, 12, 31),
                involucrados = (string[]?)null,
            });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("planCode").GetString();
        });

        var planCodes = await Task.WhenAll(tasks);

        Assert.Equal(20, planCodes.Distinct().Count());
    }
}
