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

public class PlanesAccionEndpointsTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public PlanesAccionEndpointsTests(PostgresFixture postgres)
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

        // IAsyncLifetime.InitializeAsync runs before every test method, but IClassFixture
        // shares one Postgres container across the whole class — so this seed must be
        // idempotent, not re-inserted (and fail on a duplicate key) each time.
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
            db.Nodos.Add(new NodoCache
            {
                ExternalId = "ND-999",
                Nombre = "Otro Nodo",
                LiderExternalId = "PER-9000",
                CantidadColaboradores = 3,
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

    private async Task<Guid> SeedPlanAsync(string nodoExternalId = "ND-014", string responsableId = "PER-0231")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var plan = new PlanDeAccion
        {
            PlanCode = $"PA-{Guid.NewGuid():N}"[..20],
            NodoExternalId = nodoExternalId,
            LiderExternalId = "PER-0231",
            DescripcionQue = "Plan sembrado para pruebas",
            MetodologiaComo = "N/A",
            ResponsableEjecucionExternalId = responsableId,
            FechaCreacion = new DateOnly(2026, 1, 1),
            FechaCompromiso = new DateOnly(2026, 12, 31),
        };
        db.PlanesDeAccion.Add(plan);
        await db.SaveChangesAsync();
        return plan.Id;
    }

    [Fact]
    public async Task Leader_can_create_a_plan_for_their_own_node_and_lider_is_derived_from_the_node_cache()
    {
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = (string?)null,
            descripcionQue = "Implementar programa de reconocimiento",
            metodologiaComo = "Nominacion mensual",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = new[] { "PER-0245" },
        });

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("PER-0231", body.GetProperty("liderExternalId").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("planCode").GetString()));
    }

    [Fact]
    public async Task Leader_cannot_create_a_plan_for_a_different_node()
    {
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-999",
            hallazgoExternalId = (string?)null,
            descripcionQue = "Plan que no deberia poder crear",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-9000",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Company_admin_can_create_a_plan_for_any_node()
    {
        var client = CreateAuthenticatedClient("PER-0001", "company_admin", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-999",
            hallazgoExternalId = (string?)null,
            descripcionQue = "Plan creado por un admin en otro nodo",
            metodologiaComo = "N/A",
            responsableEjecucionExternalId = "PER-9000",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Employee_cannot_create_a_plan()
    {
        var client = CreateAuthenticatedClient("PER-9999", "employee", "ND-014");

        var response = await client.PostAsJsonAsync("/api/planes-accion", new
        {
            nodoExternalId = "ND-014",
            hallazgoExternalId = (string?)null,
            descripcionQue = "x",
            metodologiaComo = "y",
            responsableEjecucionExternalId = "PER-0231",
            fechaCompromiso = new DateOnly(2026, 12, 31),
            involucrados = (string[]?)null,
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task List_scopes_a_leader_to_only_their_own_nodes_plans()
    {
        await SeedPlanAsync(nodoExternalId: "ND-014", responsableId: "PER-0231");
        await SeedPlanAsync(nodoExternalId: "ND-999", responsableId: "PER-9000");
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.GetAsync("/api/planes-accion");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var plans = body.EnumerateArray().ToList();
        Assert.All(plans, p => Assert.Equal("ND-014", p.GetProperty("nodoExternalId").GetString()));
    }

    [Fact]
    public async Task Get_by_id_returns_404_when_not_found()
    {
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.GetAsync($"/api/planes-accion/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_by_id_returns_403_for_a_leader_on_a_different_uninvolved_node()
    {
        var planId = await SeedPlanAsync(nodoExternalId: "ND-999", responsableId: "PER-9000");
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.GetAsync($"/api/planes-accion/{planId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task RegistrarAvance_happy_path_updates_progress()
    {
        var planId = await SeedPlanAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync($"/api/planes-accion/{planId}/avance", new
        {
            porcentajeAvance = 0.4m,
            comentario = "Primer avance",
            fecha = new DateOnly(2026, 3, 1),
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0.4m, body.GetProperty("porcentajeAvance").GetDecimal());
    }

    [Fact]
    public async Task RegistrarAvance_out_of_range_returns_400()
    {
        var planId = await SeedPlanAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync($"/api/planes-accion/{planId}/avance", new
        {
            porcentajeAvance = 1.5m,
            comentario = (string?)null,
            fecha = new DateOnly(2026, 3, 1),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task MarcarCumplido_happy_path()
    {
        var planId = await SeedPlanAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync($"/api/planes-accion/{planId}/cumplir", new
        {
            fecha = new DateOnly(2026, 6, 1),
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(body.GetProperty("cumplido").GetBoolean());
    }

    [Fact]
    public async Task AgregarInvolucrado_happy_path()
    {
        var planId = await SeedPlanAsync();
        var client = CreateAuthenticatedClient("PER-0231", "leader", "ND-014");

        var response = await client.PostAsJsonAsync($"/api/planes-accion/{planId}/involucrados", new
        {
            personaExternalId = "PER-0245",
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("PER-0245", body.GetProperty("involucradosExternalIds").EnumerateArray().Select(e => e.GetString()));
    }
}
