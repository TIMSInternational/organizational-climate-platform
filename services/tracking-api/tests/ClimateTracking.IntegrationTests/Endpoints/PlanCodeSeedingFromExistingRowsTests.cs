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

/// <summary>
/// Regression coverage for the plan-code sequence being seeded from pre-existing rows.
/// Uses its own <see cref="PostgresFixture"/> (own container, empty at start) so it can
/// seed a PlanDeAccion row *before* the plan_code_seq_{year} sequence is ever created —
/// reproducing the exact scenario a database with rows from the old COUNT(*)-based scheme
/// (or a prior deploy) would be in. Without seeding, a freshly created sequence starts at
/// 1 and the first POST /api/planes-accion collides with the pre-existing row's PlanCode,
/// raising an unhandled 23505 unique_violation (HTTP 500).
/// </summary>
public class PlanCodeSeedingFromExistingRowsTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanCodeSeedingFromExistingRowsTests(PostgresFixture postgres)
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

        db.Nodos.Add(new NodoCache
        {
            ExternalId = "ND-SEED",
            Nombre = "Seed Test Node",
            LiderExternalId = "PER-SEED",
            CantidadColaboradores = 1,
            Activo = true,
            LastSyncedAt = DateTimeOffset.UtcNow,
        });

        // Seed a plan whose PlanCode is exactly what a brand-new (unseeded) sequence's
        // first nextval() would produce, *before* plan_code_seq_{year} exists at all --
        // mirroring rows created by the old COUNT(*)-based scheme or a prior deploy.
        var year = DateTime.UtcNow.Year;
        db.PlanesDeAccion.Add(new PlanDeAccion
        {
            PlanCode = $"PA-{year}-00001",
            NodoExternalId = "ND-SEED",
            LiderExternalId = "PER-SEED",
            DescripcionQue = "Pre-existing plan from before the sequence existed",
            MetodologiaComo = "N/A",
            ResponsableEjecucionExternalId = "PER-SEED",
            FechaCreacion = DateOnly.FromDateTime(DateTime.UtcNow),
            FechaCompromiso = new DateOnly(year, 12, 31),
        });

        await db.SaveChangesAsync();
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
    public async Task Creating_a_plan_in_a_database_with_a_preexisting_PlanCode_does_not_collide_with_it()
    {
        var client = CreateAuthenticatedClient("PER-SEED", "company_admin", "ND-SEED");
        var year = DateTime.UtcNow.Year;

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-SEED",
            hallazgoExternalId = (string?)null,
            descripcionQue = "First plan created after the sequence existed",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-SEED",
            fechaCompromiso = new DateOnly(year, 12, 31),
            involucrados = (string[]?)null,
        });

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        var planCode = body.GetProperty("planCode").GetString();
        Assert.NotEqual($"PA-{year}-00001", planCode);
        Assert.Equal($"PA-{year}-00002", planCode);
    }
}
