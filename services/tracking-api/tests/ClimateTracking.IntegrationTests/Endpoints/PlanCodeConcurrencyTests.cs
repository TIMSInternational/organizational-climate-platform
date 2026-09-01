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
            // The API host co-hosts CacheSyncWorker and DailySemaforoWorker (#219). Idle here:
            // a test host that swept its own database and dialled a nonexistent
            // climate-project on every boot would be racing the test it is hosting.
            builder.UseSetting("Workers:Enabled", "false");
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

            // Read the body as text and assert the STATUS before parsing it. Going
            // straight to ReadFromJsonAsync turns any non-2xx into
            // "JsonException: 'M' is an invalid start of a value" -- the response body
            // is an exception page, and 'M' is the first letter of "Microsoft...".
            // That is exactly how this test failed on main at 6d04ad4 (2026-09-01):
            // the parse error told us nothing about WHICH failure had occurred, so it
            // was impossible to tell the defect this test exists to catch (a duplicate
            // plan code from the CREATE SEQUENCE race in GeneratePlanCodeAsync) from an
            // unrelated 500. A test that cannot name its own failure cannot be triaged.
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(
                response.IsSuccessStatusCode,
                $"Request {i}: POST /api/planes-accion returned {(int)response.StatusCode} "
                    + $"({response.StatusCode}). Body: {raw}");

            using var parsed = JsonDocument.Parse(raw);
            return parsed.RootElement.GetProperty("planCode").GetString();
        });

        var planCodes = await Task.WhenAll(tasks);

        // Name the colliding codes rather than leaving "expected 20, actual 19", which
        // says a duplicate happened but not which one -- and the code is the only clue
        // to where in the sequence the race landed.
        var duplicates = planCodes
            .GroupBy(code => code)
            .Where(group => group.Count() > 1)
            .Select(group => $"{group.Key} x{group.Count()}")
            .ToArray();
        Assert.True(
            duplicates.Length == 0,
            $"Concurrent creation produced duplicate plan codes: {string.Join(", ", duplicates)}");

        Assert.Equal(20, planCodes.Distinct().Count());
    }
}
