using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
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
/// GET /api/planes-accion/export — Procomer acceptance criterion 7 end to end: the ids in the
/// database come back as the names the client's spreadsheet shows, and no caller gets a row
/// through the export that the list endpoint would have withheld.
/// </summary>
public class TrackingSheetExportEndpointsTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    private readonly PostgresFixture _postgres;
    private readonly FakeClimateProjectClient _fakeClient = new();
    private WebApplicationFactory<Program> _factory = null!;

    public TrackingSheetExportEndpointsTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public Dictionary<string, IReadOnlyList<HallazgoDto>> HallazgosPorCiclo { get; } = [];
        public List<string> CiclosRequested { get; } = [];
        public Exception? ExceptionToThrowOnHallazgosLookup { get; set; }

        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<NodoDto>>([]);
        public Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PersonaDto>>([]);
        public Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CicloDto>>([]);

        public Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken)
        {
            CiclosRequested.Add(cicloId);
            if (ExceptionToThrowOnHallazgosLookup is not null)
            {
                throw ExceptionToThrowOnHallazgosLookup;
            }

            return Task.FromResult(HallazgosPorCiclo.GetValueOrDefault(cicloId, []));
        }

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
                services.AddSingleton<IClimateProjectClient>(_fakeClient);
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();

        // IAsyncLifetime runs per test method while the container is shared for the class, so
        // the seed is idempotent and every test owns its own nodo.
        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-EXP"))
        {
            db.Nodos.AddRange(
                Nodo("ND-EXP", "Comercial Exterior"),
                Nodo("ND-EXP-OTRO", "Recursos Humanos"),
                Nodo("ND-EXP-DET", "Promoción Comercial"),
                Nodo("ND-EXP-DOWN", "Servicios Corporativos"));
            db.Personas.AddRange(
                Persona("PER-EXP-LID", "Ana Rojas", "ana.rojas@procomer.test", "ND-EXP"),
                Persona("PER-EXP-RES", "Luis Mora", "luis.mora@procomer.test", "ND-EXP"),
                Persona("PER-EXP-IN1", "Carla Vega", "carla.vega@procomer.test", "ND-EXP"),
                Persona("PER-EXP-IN2", "Diego Solis", "diego.solis@procomer.test", "ND-EXP"));
            await db.SaveChangesAsync();
        }
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static NodoCache Nodo(string externalId, string nombre) => new()
    {
        ExternalId = externalId,
        Nombre = nombre,
        LiderExternalId = "PER-EXP-LID",
        CantidadColaboradores = 8,
        Activo = true,
        LastSyncedAt = DateTimeOffset.UtcNow,
    };

    private static PersonaCache Persona(string externalId, string nombre, string correo, string nodo) => new()
    {
        ExternalId = externalId,
        NombreCompleto = nombre,
        Correo = correo,
        NodoExternalId = nodo,
        LastSyncedAt = DateTimeOffset.UtcNow,
    };

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

    private async Task SeedPlanAsync(
        string planCode,
        string nodo,
        string responsable = "PER-EXP-RES",
        string? hallazgo = null,
        string? ciclo = null,
        string[]? involucrados = null,
        decimal avance = 0m,
        string? comentario = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var plan = new PlanDeAccion
        {
            PlanCode = planCode,
            NodoExternalId = nodo,
            LiderExternalId = "PER-EXP-LID",
            HallazgoExternalId = hallazgo,
            CicloEncuestaExternalId = ciclo,
            // Unique per plan, and deliberately full of the characters CSV has to escape:
            // the sheet has no plan-code column, so this free text is how a test finds its row.
            DescripcionQue = $"Reuniones \"1 a 1\", mensuales ({planCode})",
            MetodologiaComo = "Agenda, minuta y seguimiento",
            ResponsableEjecucionExternalId = responsable,
            FechaCreacion = new DateOnly(2026, 1, 1),
            FechaCompromiso = new DateOnly(2026, 12, 31),
        };

        foreach (var involucrado in involucrados ?? [])
        {
            plan.AgregarInvolucrado(involucrado);
        }

        plan.RegistrarAvance(avance, "PER-EXP-LID", comentario, new DateOnly(2026, 2, 9), new SemaforoThresholdConfig());
        db.PlanesDeAccion.Add(plan);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Export_resolves_every_id_into_the_value_the_client_template_expects()
    {
        _fakeClient.HallazgosPorCiclo["CIC-EXP-1"] =
        [
            new HallazgoDto("HAL-EXP-1", "ND-EXP-DET", "Comunicación interna", 0.62m, null, null, "CIC-EXP-1"),
            new HallazgoDto("HAL-EXP-2", "ND-EXP-DET", "Reconocimiento", 0.41m, null, null, "CIC-EXP-1"),
        ];
        await SeedPlanAsync(
            "PA-2026-90001",
            "ND-EXP-DET",
            hallazgo: "HAL-EXP-1",
            ciclo: "CIC-EXP-1",
            involucrados: ["PER-EXP-IN1", "PER-EXP-IN2"],
            avance: 0.35m,
            comentario: "Primer taller realizado");
        // A second plan on the same ciclo: the hallazgo lookup must cost one call per distinct
        // ciclo, not one per plan.
        await SeedPlanAsync("PA-2026-90002", "ND-EXP-DET", hallazgo: "HAL-EXP-2", ciclo: "CIC-EXP-1");

        var client = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var response = await client.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-DET", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal<byte>([0xEF, 0xBB, 0xBF], bytes[..3]);

        var rows = Rows(bytes);
        Assert.Equal(2, rows.Count);
        var row = rows[0];
        Assert.Equal("1", row[0]);
        Assert.Equal("Reuniones \"1 a 1\", mensuales (PA-2026-90001)", row[4]);
        Assert.Equal("2", rows[1][0]);
        Assert.Equal("Promoción Comercial", row[1]);
        Assert.Equal("Ana Rojas", row[2]);
        Assert.Equal("Comunicación interna", row[3]);
        Assert.Equal("Luis Mora", row[6]);
        Assert.Equal("2026-12-31", row[7]);
        Assert.Equal("35", row[8]);
        Assert.Equal("Verde", row[9]);
        Assert.Equal("carla.vega@procomer.test; diego.solis@procomer.test", row[10]);
        Assert.Equal("2026-02-09", row[11]);
        Assert.Equal("Primer taller realizado", row[12]);
        // One call per distinct ciclo, not one per plan.
        Assert.Equal("CIC-EXP-1", Assert.Single(_fakeClient.CiclosRequested));
    }

    [Fact]
    public async Task A_leader_exports_only_the_rows_the_list_endpoint_would_show_them()
    {
        await SeedPlanAsync("PA-2026-90101", "ND-EXP");
        await SeedPlanAsync("PA-2026-90102", "ND-EXP-OTRO", responsable: "PER-EXP-AJENO");

        var leader = CreateAuthenticatedClient("PER-EXP-LID", "leader", "ND-EXP");
        var csv = await (await leader.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative)))
            .Content.ReadAsByteArrayAsync();
        var nodos = Rows(csv).Select(r => r[1]).ToList();

        Assert.Contains("Comercial Exterior", nodos);
        Assert.DoesNotContain("Recursos Humanos", nodos);

        // The same file, for someone who is allowed the whole company, does have it.
        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var adminCsv = await (await admin.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative)))
            .Content.ReadAsByteArrayAsync();
        Assert.Contains("Recursos Humanos", Rows(adminCsv).Select(r => r[1]));
    }

    [Fact]
    public async Task Nodo_filter_narrows_the_sheet_the_same_way_it_narrows_the_list()
    {
        await SeedPlanAsync("PA-2026-90201", "ND-EXP");
        await SeedPlanAsync("PA-2026-90202", "ND-EXP-OTRO");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var csv = await (await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-OTRO", UriKind.Relative)))
            .Content.ReadAsByteArrayAsync();

        var nodos = Rows(csv).Select(r => r[1]).Distinct().ToList();
        Assert.Equal("Recursos Humanos", Assert.Single(nodos));
    }

    [Fact]
    public async Task An_unreachable_climate_project_costs_the_hallazgo_column_not_the_export()
    {
        _fakeClient.ExceptionToThrowOnHallazgosLookup = new HttpRequestException("climate-project is down");
        await SeedPlanAsync("PA-2026-90301", "ND-EXP-DOWN", hallazgo: "HAL-EXP-DOWN", ciclo: "CIC-EXP-DOWN");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var response = await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-DOWN", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var row = Assert.Single(Rows(await response.Content.ReadAsByteArrayAsync()));
        // The raw id, not a 500 and not a blank cell.
        Assert.Equal("HAL-EXP-DOWN", row[3]);
    }

    [Fact]
    public async Task The_export_is_unauthenticated_callers_nothing()
    {
        var response = await _factory.CreateClient().GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// The sheet only ever leaves. Estado is calculated by the domain, so there is no route
    /// that reads this file back in — see <c>TrackingSheetExport</c>'s remarks.
    /// </summary>
    [Fact]
    public async Task The_export_path_accepts_no_writes()
    {
        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");

        using var content = new StringContent("No.,Estado\r\n1,Verde\r\n", Encoding.UTF8, "text/csv");
        var post = await admin.PostAsync(new Uri("/api/planes-accion/export", UriKind.Relative), content);
        using var putContent = new StringContent("No.,Estado\r\n1,Verde\r\n", Encoding.UTF8, "text/csv");
        var put = await admin.PutAsync(new Uri("/api/planes-accion/export", UriKind.Relative), putContent);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, post.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, put.StatusCode);
    }

    /// <summary>Data rows only — the header is dropped.</summary>
    private static List<List<string>> Rows(byte[] bytes)
    {
        var text = Encoding.UTF8.GetString(bytes);
        if (text.StartsWith('﻿'))
        {
            text = text[1..];
        }

        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (inQuotes)
            {
                if (c != '"')
                {
                    field.Append(c);
                }
                else if (i + 1 < text.Length && text[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = false;
                }
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == ',')
            {
                record.Add(field.ToString());
                field.Clear();
            }
            else if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                i++;
                record.Add(field.ToString());
                field.Clear();
                records.Add(record);
                record = [];
            }
            else
            {
                field.Append(c);
            }
        }

        if (field.Length > 0 || record.Count > 0)
        {
            record.Add(field.ToString());
            records.Add(record);
        }

        return records.Skip(1).ToList();
    }
}
