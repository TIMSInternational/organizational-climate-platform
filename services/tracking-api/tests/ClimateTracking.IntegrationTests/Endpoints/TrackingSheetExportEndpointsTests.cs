using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Jwt = System.IdentityModel.Tokens.Jwt;

namespace ClimateTracking.IntegrationTests.Endpoints;

/// <summary>
/// GET /api/planes-accion/export — Procomer acceptance criterion 7 end to end: what comes back
/// over HTTP is a workbook the client can open, the ids in the database come back as the names
/// their spreadsheet shows, and no caller gets a row through the export that the list endpoint
/// would have withheld.
/// </summary>
public class TrackingSheetExportEndpointsTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private const string TrackingJwtSecret = "test-tracking-secret-at-least-32-bytes-long";
    private const string ProcomerCompanyId = "CO-014";

    /// <summary>
    /// The media type of an Office Open XML workbook, written out rather than read from
    /// <c>TrackingSheetExport.ContentType</c>: this is the string a browser and Excel agree on,
    /// so a test that took it from the code under test would agree with whatever it said.
    /// </summary>
    private const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>Column numbers, 1-based as the sheet counts them, in the template's order.</summary>
    private const int NoCol = 1;
    private const int NodoCol = 2;
    private const int LiderCol = 3;
    private const int HallazgoCol = 4;
    private const int QueCol = 5;
    private const int ResponsableCol = 7;
    private const int FechaCompromisoCol = 8;
    private const int AvanceCol = 9;
    private const int EstadoCol = 10;
    private const int CorreosCol = 11;
    private const int UltimaActualizacionCol = 12;
    private const int ComentariosCol = 13;

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

        // IAsyncLifetime runs per test method while the container is shared for the class, so
        // the seed is idempotent and every test owns its own nodo.
        if (!await db.Nodos.AnyAsync(n => n.ExternalId == "ND-EXP"))
        {
            db.Nodos.AddRange(
                Nodo("ND-EXP", "Comercial Exterior"),
                Nodo("ND-EXP-OTRO", "Recursos Humanos"),
                Nodo("ND-EXP-DET", "Promoción Comercial"),
                Nodo("ND-EXP-DOWN", "Servicios Corporativos"),
                Nodo("ND-EXP-VINETA", "Dirección de Operaciones"),
                Nodo("ND-EXP-NULA", "Auditoría Interna"));
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

    /// <summary>
    /// The "Plan de acción (Qué)" a seeded plan carries: unique per plan, so a test can find its
    /// row in a sheet that has no plan-code column, and deliberately opening with a bullet dash
    /// and holding a quote — the two characters a typeless format could not have carried
    /// through untouched.
    /// </summary>
    private static string Que(string planCode) => $"- Reuniones \"1 a 1\", mensuales ({planCode})";

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
            DescripcionQue = Que(planCode),
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

    /// <summary>
    /// What the endpoint serves, and what makes it servable at all: the extension and the media
    /// type Excel and every browser key off.
    /// </summary>
    [Fact]
    public async Task The_response_is_served_as_an_xlsx_attachment()
    {
        await SeedPlanAsync("PA-2026-90401", "ND-EXP");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var response = await admin.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(XlsxContentType, response.Content.Headers.ContentType?.MediaType);
        // A workbook is a zip container, not text; a charset parameter here is a lie.
        Assert.Null(response.Content.Headers.ContentType?.CharSet);

        var fileName = response.Content.Headers.ContentDisposition?.FileName?.Trim('"');
        Assert.NotNull(fileName);
        Assert.StartsWith("seguimiento-planes-accion-", fileName, StringComparison.Ordinal);
        Assert.EndsWith(".xlsx", fileName, StringComparison.Ordinal);
    }

    /// <summary>
    /// The body really is a workbook — the constructor below is the assertion, since nothing
    /// that is not an Office Open XML package survives it — and its one sheet is the sheet the
    /// client's template names.
    /// </summary>
    [Fact]
    public async Task The_body_opens_as_a_workbook_whose_only_sheet_is_named_Tracking()
    {
        await SeedPlanAsync("PA-2026-90501", "ND-EXP");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        using var workbook = await WorkbookAsync(
            await admin.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative)));

        Assert.Equal(1, workbook.Worksheets.Count);
        Assert.Equal("Tracking", workbook.Worksheet(1).Name);
        Assert.Equal(
            [
                "No.",
                "Nodo / Área",
                "Líder responsable",
                "Hallazgo (tema de la encuesta)",
                "Plan de acción (Qué)",
                "Cómo",
                "Responsable de ejecución (Quién)",
                "Fecha compromiso",
                "% Avance",
                "Estado",
                "Involucrados a notificar (correos)",
                "Última actualización",
                "Comentarios",
            ],
            Enumerable.Range(1, 13).Select(column => workbook.Worksheet(1).Cell(1, column).GetText()));
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
        using var workbook = await WorkbookAsync(
            await client.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-DET", UriKind.Relative)));
        var sheet = workbook.Worksheet(1);

        Assert.Equal(2, DataRows(sheet).Count);

        Assert.Equal(1, sheet.Cell(2, NoCol).GetDouble());
        Assert.Equal(2, sheet.Cell(3, NoCol).GetDouble());
        Assert.Equal(Que("PA-2026-90001"), sheet.Cell(2, QueCol).GetText());
        Assert.Equal("Promoción Comercial", sheet.Cell(2, NodoCol).GetText());
        Assert.Equal("Ana Rojas", sheet.Cell(2, LiderCol).GetText());
        Assert.Equal("Comunicación interna", sheet.Cell(2, HallazgoCol).GetText());
        Assert.Equal("Luis Mora", sheet.Cell(2, ResponsableCol).GetText());
        Assert.Equal(new DateTime(2026, 12, 31, 0, 0, 0, DateTimeKind.Unspecified), sheet.Cell(2, FechaCompromisoCol).GetDateTime());
        Assert.Equal(35, sheet.Cell(2, AvanceCol).GetDouble());
        Assert.Equal("Verde", sheet.Cell(2, EstadoCol).GetText());
        Assert.Equal("carla.vega@procomer.test; diego.solis@procomer.test", sheet.Cell(2, CorreosCol).GetText());
        Assert.Equal(new DateTime(2026, 2, 9, 0, 0, 0, DateTimeKind.Unspecified), sheet.Cell(2, UltimaActualizacionCol).GetDateTime());
        Assert.Equal("Primer taller realizado", sheet.Cell(2, ComentariosCol).GetText());
        // One call per distinct ciclo, not one per plan.
        Assert.Equal("CIC-EXP-1", Assert.Single(_fakeClient.CiclosRequested));
    }

    /// <summary>
    /// The reason this endpoint serves a workbook, asserted where the client meets it: their
    /// "Qué" and "Comentarios" are Spanish free text that opens with a bullet dash, and a
    /// typeless format could only ship that with an apostrophe in front of it.
    /// </summary>
    [Fact]
    public async Task A_bulleted_plan_reaches_the_client_with_no_apostrophe_in_front_of_it()
    {
        await SeedPlanAsync("PA-2026-90601", "ND-EXP-VINETA", comentario: "- pendiente de aprobación");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        using var workbook = await WorkbookAsync(
            await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-VINETA", UriKind.Relative)));
        var sheet = workbook.Worksheet(1);

        foreach (var column in new[] { QueCol, ComentariosCol })
        {
            var cell = sheet.Cell(2, column);
            Assert.StartsWith("- ", cell.GetText(), StringComparison.Ordinal);
            Assert.Equal(XLDataType.Text, cell.DataType);
            // A leading apostrophe is stored as this flag rather than as a character, so the
            // text assertion above would not notice a formula guard being introduced.
            Assert.False(cell.Style.IncludeQuotePrefix);
        }

        Assert.Equal(Que("PA-2026-90601"), sheet.Cell(2, QueCol).GetText());
        Assert.Equal("- pendiente de aprobación", sheet.Cell(2, ComentariosCol).GetText());
    }

    [Fact]
    public async Task A_leader_exports_only_the_rows_the_list_endpoint_would_show_them()
    {
        await SeedPlanAsync("PA-2026-90101", "ND-EXP");
        await SeedPlanAsync("PA-2026-90102", "ND-EXP-OTRO", responsable: "PER-EXP-AJENO");

        var leader = CreateAuthenticatedClient("PER-EXP-LID", "leader", "ND-EXP");
        using var leaderWorkbook = await WorkbookAsync(
            await leader.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative)));
        var nodos = Nodos(leaderWorkbook);

        Assert.Contains("Comercial Exterior", nodos);
        Assert.DoesNotContain("Recursos Humanos", nodos);

        // The same file, for someone who is allowed the whole company, does have it.
        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        using var adminWorkbook = await WorkbookAsync(
            await admin.GetAsync(new Uri("/api/planes-accion/export", UriKind.Relative)));

        Assert.Contains("Recursos Humanos", Nodos(adminWorkbook));
    }

    [Fact]
    public async Task Nodo_filter_narrows_the_sheet_the_same_way_it_narrows_the_list()
    {
        await SeedPlanAsync("PA-2026-90201", "ND-EXP");
        await SeedPlanAsync("PA-2026-90202", "ND-EXP-OTRO");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        using var workbook = await WorkbookAsync(
            await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-OTRO", UriKind.Relative)));

        Assert.Equal("Recursos Humanos", Assert.Single(Nodos(workbook).Distinct()));
    }

    [Fact]
    public async Task An_unreachable_climate_project_costs_the_hallazgo_column_not_the_export()
    {
        _fakeClient.ExceptionToThrowOnHallazgosLookup = new HttpRequestException("climate-project is down");
        await SeedPlanAsync("PA-2026-90301", "ND-EXP-DOWN", hallazgo: "HAL-EXP-DOWN", ciclo: "CIC-EXP-DOWN");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var response = await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-DOWN", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var workbook = await WorkbookAsync(response);
        var sheet = workbook.Worksheet(1);

        Assert.Single(DataRows(sheet));
        // The raw id, not a 500 and not a blank cell.
        Assert.Equal("HAL-EXP-DOWN", sheet.Cell(2, HallazgoCol).GetText());
    }

    /// <summary>
    /// climate-project's HallazgoDto declares Categoria as a non-nullable string, but the
    /// deserializer behind it does not enforce that, so a finding whose categoria is null
    /// arrives as a null in a string-typed property and lands in the lookup under a key that IS
    /// present — which is exactly the case GetValueOrDefault's fallback does not cover. It must
    /// cost that one cell, not the whole sheet.
    /// </summary>
    [Fact]
    public async Task A_finding_whose_categoria_is_null_costs_that_cell_and_not_the_export()
    {
        _fakeClient.HallazgosPorCiclo["CIC-EXP-NULL"] =
        [
            new HallazgoDto("HAL-EXP-NULL", "ND-EXP-NULA", null!, 0.5m, null, null, "CIC-EXP-NULL"),
        ];
        await SeedPlanAsync("PA-2026-90701", "ND-EXP-NULA", hallazgo: "HAL-EXP-NULL", ciclo: "CIC-EXP-NULL");

        var admin = CreateAuthenticatedClient("PER-EXP-ADM", "company_admin", "ND-EXP");
        var response = await admin.GetAsync(new Uri("/api/planes-accion/export?nodoId=ND-EXP-NULA", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var workbook = await WorkbookAsync(response);
        var sheet = workbook.Worksheet(1);

        Assert.Single(DataRows(sheet));
        Assert.Equal(string.Empty, sheet.Cell(2, HallazgoCol).GetText());
        // The rest of the row survived.
        Assert.Equal(Que("PA-2026-90701"), sheet.Cell(2, QueCol).GetText());
        Assert.Equal("Auditoría Interna", sheet.Cell(2, NodoCol).GetText());
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

        using var content = new ByteArrayContent([0x50, 0x4B, 0x03, 0x04]);
        content.Headers.ContentType = new MediaTypeHeaderValue(XlsxContentType);
        var post = await admin.PostAsync(new Uri("/api/planes-accion/export", UriKind.Relative), content);

        using var putContent = new ByteArrayContent([0x50, 0x4B, 0x03, 0x04]);
        putContent.Headers.ContentType = new MediaTypeHeaderValue(XlsxContentType);
        var put = await admin.PutAsync(new Uri("/api/planes-accion/export", UriKind.Relative), putContent);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, post.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, put.StatusCode);
    }

    /// <summary>
    /// The response body, opened the way the client opens it. <see cref="XLWorkbook"/> reads the
    /// whole stream in its constructor and throws on anything that is not an Office Open XML
    /// package, so this doubles as the assertion that the body is a workbook.
    /// </summary>
    private static async Task<XLWorkbook> WorkbookAsync(HttpResponseMessage response)
    {
        using var stream = new MemoryStream(await response.Content.ReadAsByteArrayAsync());
        return new XLWorkbook(stream);
    }

    /// <summary>Data rows only — the header is dropped.</summary>
    private static List<IXLRow> DataRows(IXLWorksheet sheet) =>
        sheet.RowsUsed().Where(row => row.RowNumber() > 1).ToList();

    private static List<string> Nodos(XLWorkbook workbook) =>
        DataRows(workbook.Worksheet(1)).Select(row => row.Cell(NodoCol).GetText()).ToList();
}
