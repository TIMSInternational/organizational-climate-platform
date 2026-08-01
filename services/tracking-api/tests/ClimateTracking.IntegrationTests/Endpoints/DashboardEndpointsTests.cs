using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Jwt = System.IdentityModel.Tokens.Jwt;

namespace ClimateTracking.IntegrationTests.Endpoints;

public class DashboardEndpointsTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public DashboardEndpointsTests(PostgresFixture postgres)
    {
        _postgres = postgres;
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
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        // InitializeAsync runs before every test method, but IClassFixture shares one
        // Postgres container for the whole class — without this, plans seeded by an
        // earlier test would still be there for the next one.
        await db.PlanesDeAccion.ExecuteDeleteAsync();
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

    private async Task SeedPlansAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var config = await db.SemaforoThresholdConfigs.SingleAsync(c => c.Id == SemaforoThresholdConfig.DefaultConfigId);

        // Rojo: vencido sin cumplir.
        var rojo = NewPlan("ND-014", new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 10), "PER-0231");
        rojo.RegistrarAvance(0m, "PER-0231", null, new DateOnly(2026, 1, 11), config);

        // Amarillo: sin actualizar mas de 30 dias, plenty of time left.
        var amarillo = NewPlan("ND-014", new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "PER-0231");
        amarillo.RegistrarAvance(0.5m, "PER-0231", null, new DateOnly(2026, 1, 10), config);
        amarillo.RecalcularSemaforo(new DateOnly(2026, 2, 15), config);

        // Verde: on track, recently updated.
        var verde = NewPlan("ND-014", new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "PER-0231");
        verde.RegistrarAvance(0.5m, "PER-0231", null, new DateOnly(2026, 6, 5), config);

        // Another node's plan, should never surface in ND-014's tablero.
        var otroNodo = NewPlan("ND-999", new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "PER-9000");
        otroNodo.RegistrarAvance(0.5m, "PER-9000", null, new DateOnly(2026, 6, 5), config);

        db.PlanesDeAccion.AddRange(rojo, amarillo, verde, otroNodo);
        await db.SaveChangesAsync();
    }

    private static PlanDeAccion NewPlan(string nodo, DateOnly creacion, DateOnly compromiso, string responsable) => new()
    {
        PlanCode = $"PA-{Guid.NewGuid():N}"[..20],
        NodoExternalId = nodo,
        LiderExternalId = "PER-0231",
        DescripcionQue = "Plan sembrado para pruebas de dashboard",
        MetodologiaComo = "N/A",
        ResponsableEjecucionExternalId = responsable,
        FechaCreacion = creacion,
        FechaCompromiso = compromiso,
    };

    [Fact]
    public async Task Tablero_returns_semaforo_counts_and_plans_scoped_to_the_node()
    {
        await SeedPlansAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.GetAsync("/api/tablero-seguimiento?nodoId=ND-014");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, body.GetProperty("conteos").GetProperty("rojo").GetInt32());
        Assert.Equal(1, body.GetProperty("conteos").GetProperty("amarillo").GetInt32());
        Assert.Equal(1, body.GetProperty("conteos").GetProperty("verde").GetInt32());
        Assert.Equal(3, body.GetProperty("planes").GetArrayLength());
    }

    [Fact]
    public async Task Leader_cannot_query_another_nodes_tablero()
    {
        await SeedPlansAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.GetAsync("/api/tablero-seguimiento?nodoId=ND-999");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Consolidado_is_admin_only()
    {
        await SeedPlansAsync();
        var leaderClient = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");
        var adminClient = CreateAuthenticatedClient("PER-0001", "company_admin", "ND-014");

        var leaderResponse = await leaderClient.GetAsync("/api/consolidado");
        var adminResponse = await adminClient.GetAsync("/api/consolidado");
        var adminBody = await adminResponse.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Forbidden, leaderResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, adminResponse.StatusCode);
        Assert.Equal(4, adminBody.GetProperty("conteos").GetProperty("rojo").GetInt32()
            + adminBody.GetProperty("conteos").GetProperty("amarillo").GetInt32()
            + adminBody.GetProperty("conteos").GetProperty("verde").GetInt32());
    }

    [Fact]
    public async Task MisTareas_returns_only_plans_where_the_caller_is_responsable_or_involucrado()
    {
        await SeedPlansAsync();
        var client = CreateAuthenticatedClient("PER-9000", "employee", "ND-999");

        var response = await client.GetAsync("/api/mis-tareas");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var plans = body.EnumerateArray().ToList();
        Assert.Single(plans);
        Assert.Equal("ND-999", plans[0].GetProperty("nodoExternalId").GetString());
    }
}
