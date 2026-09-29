using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.OrgStructure.Intake;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// <c>POST /admin/users/bulk-import/understand</c> and the extended <c>/rows</c> — the AI intake,
/// end to end over HTTP against a real database, with a fake standing in for the model. No test
/// here reaches a network or spends money (the shared factory also sets Intake:Ai:Enabled=false).
/// </summary>
[Collection("Postgres")]
public class IntakeUnderstandEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"understand-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    private const string Csv = """
        Listado de personal
        Nombre completo;Correo;Puesto;Área;Sede;Cédula
        "Rojas Pérez, Ana";ana.rojas@EXAMPLE.test;Gerente de Finanzas;Finanzas;San José;112340567
        "Jiménez Mora, Carlos";carlos@gmial.com;Analista;RRHH;Heredia;203450678
        "Vargas, Sofía";sofia@example.test;Analista;Calidad;Heredia;304560789
        """;

    public IntakeUnderstandEndpointsTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var company = new Company { Id = Guid.NewGuid(), Name = "Understand Co", EmailDomain = _companyDomain, CreatedAt = now };
        var other = new Company { Id = Guid.NewGuid(), Name = "Other Co", EmailDomain = $"o-{Guid.NewGuid():N}.test", CreatedAt = now };
        db.Companies.AddRange(company, other);
        _companyId = company.Id;
        _otherCompanyId = other.Id;
        db.Departments.AddRange(
            new Department { Id = Guid.NewGuid(), CompanyId = _companyId, Name = "Finanzas", CreatedAt = now },
            new Department { Id = Guid.NewGuid(), CompanyId = _companyId, Name = "Personas", CreatedAt = now },
            new Department { Id = Guid.NewGuid(), CompanyId = _companyId, Name = "Archivo", IsActive = false, CreatedAt = now });
        var sede = new DemographicField { Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEs = "Sede", Type = "select", Order = 1, CreatedAt = now, UpdatedAt = now };
        db.DemographicFields.Add(sede);
        db.DemographicFieldOptions.AddRange(
            new DemographicFieldOption { DemographicFieldId = sede.Id, Order = 1, Value = "san_jose", LabelEs = "San José" },
            new DemographicFieldOption { DemographicFieldId = sede.Id, Order = 2, Value = "heredia", LabelEs = "Heredia" });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        // Back to "not configured" for whatever runs next on the shared host.
        _factory.IntakeModel.Reset(null);
        return Task.CompletedTask;
    }

    private static IntakeMapping CsvMapping(IntakeProfile profile, IntakeTargets targets) => new(
        profile.Sheets[0].Name,
        2,
        [
            new IntakeColumnMapping(1, "Nombre completo", IntakeTargetFields.Name, null, "high", "Nombre y apellidos"),
            new IntakeColumnMapping(2, "Correo", IntakeTargetFields.Email, null, "high", null),
            new IntakeColumnMapping(3, "Puesto", IntakeTargetFields.Role, null, "high", null),
            new IntakeColumnMapping(4, "Área", IntakeTargetFields.Department, null, "high", null),
            new IntakeColumnMapping(5, "Sede", IntakeTargetFields.Demographic, "sede", "high", null),
            new IntakeColumnMapping(6, "Cédula", IntakeTargetFields.Ignore, null, "high", "Dato personal que no se usa"),
        ],
        "last_first",
        Roles.Employee,
        [new IntakeValueMapping("Gerente de Finanzas", Roles.Leader, "high", null), new IntakeValueMapping("Analista", Roles.Employee, "high", null)],
        [
            new IntakeDepartmentMapping("Finanzas", "Finanzas", false, "high", null),
            new IntakeDepartmentMapping("RRHH", "Personas", false, "high", "RRHH es el área de personas"),
            new IntakeDepartmentMapping("Calidad", "Calidad", true, "medium", null),
        ],
        [new IntakeDemographicValueMapping("sede", "San José", "san_jose", "high"), new IntakeDemographicValueMapping("sede", "Heredia", "heredia", "high")],
        "Tres personas con puesto, área y sede.");

    private async Task<(HttpClient Client, TestIntakeMappingModel Model)> ClientAsync(
        Func<IntakeProfile, IntakeTargets, IntakeMapping?>? answer = null)
    {
        var fake = _factory.IntakeModel;
        fake.Reset(answer ?? CsvMapping);
        var app = _factory;
        var client = app.CreateClient();

        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd"));
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
        return (client, fake);
    }

    private MultipartFormDataContent Form(byte[] bytes, string fileName, Guid? companyId = null, string? mapping = null)
    {
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(bytes), "file", fileName);
        form.Add(new StringContent((companyId ?? _companyId).ToString()), "companyId");
        form.Add(new StringContent("es"), "language");
        if (mapping is not null)
        {
            form.Add(new StringContent(mapping), "mapping");
        }

        return form;
    }

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static async Task<IntakeUnderstandResponse> Read(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<IntakeUnderstandResponse>(Web))!;
    }

    [Fact]
    public async Task A_clients_own_csv_is_understood_and_applied_to_every_row()
    {
        var (client, model) = await ClientAsync();

        var result = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(Encoding.UTF8.GetBytes(Csv), "planilla.csv")));

        Assert.Equal("ai", result.Source);
        Assert.Equal(3, result.Rows.Count);
        var ana = result.Rows[0];
        Assert.Equal(("Ana Rojas Pérez", "ana.rojas@example.test", Roles.Leader, "Finanzas"), (ana.Name, ana.Email, ana.Role, ana.Department));
        Assert.Equal("san_jose", ana.Demographics!["sede"]);
        Assert.Equal("Personas", result.Rows[1].Department);
        Assert.Equal(["Calidad"], result.NewDepartments);
        Assert.Contains(result.Insights, i => i is { Code: "email_typo", Value: "gmial.com", Suggestion: "gmail.com" });
        Assert.Equal("fake-model", result.Ai!.Model);
        Assert.Contains("Cédula", result.Ai.MaskedColumns);
        Assert.Contains("Área", result.Ai.CategoryColumns);

        // What the model was shown: the company's active departments and fields, and the file
        // with nobody in it.
        var (profile, targets, language) = Assert.Single(model.Calls);
        Assert.Equal("es", language);
        Assert.Equal(["Finanzas", "Personas"], targets.Departments);
        Assert.Equal(["san_jose", "heredia"], targets.Demographics.Single().Options!);
        var shown = JsonSerializer.Serialize(profile);
        foreach (var secret in new[] { "Rojas Pérez", "ana.rojas", "carlos@", "112340567", "Sofía" })
        {
            Assert.DoesNotContain(secret, shown, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_same_file_twice_asks_the_model_once()
    {
        var (client, model) = await ClientAsync();
        var bytes = Encoding.UTF8.GetBytes(Csv);

        await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(bytes, "planilla.csv")));
        var second = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(bytes, "planilla.csv")));

        Assert.Single(model.Calls);
        Assert.True(second.Ai!.Cached);
    }

    [Fact]
    public async Task When_the_model_fails_the_header_words_still_give_an_editable_mapping()
    {
        var (client, _) = await ClientAsync((_, _) => null);

        var result = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(Encoding.UTF8.GetBytes(Csv), "planilla.csv")));

        Assert.Equal("heuristic", result.Source);
        Assert.Equal("ai_failed", result.FailureCode);
        // The model WAS asked (and failed), so what it was shown is still true to report.
        Assert.NotNull(result.Ai);
        Assert.Equal(IntakeTargetFields.Email, result.Mapping.Columns.Single(c => c.Column == 2).Target);
        Assert.Equal(3, result.Rows.Count);
    }

    /// <summary>No model reachable means nothing was sent — so no claim about what was.</summary>
    [Fact]
    public async Task With_no_model_configured_the_response_claims_nothing_was_shared()
    {
        var (client, _) = await ClientAsync();
        _factory.IntakeModel.Reset(null);

        var result = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(Encoding.UTF8.GetBytes(Csv), "planilla.csv")));

        Assert.Equal("heuristic", result.Source);
        Assert.Equal("ai_unavailable", result.FailureCode);
        Assert.Null(result.Ai);
    }

    [Fact]
    public async Task An_edited_mapping_is_applied_without_asking_the_model()
    {
        var (client, model) = await ClientAsync();
        var bytes = Encoding.UTF8.GetBytes(Csv);
        var first = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(bytes, "planilla.csv")));

        // The admin decides "Analista" means supervisor here.
        var edited = first.Mapping with
        {
            RoleValues = first.Mapping.RoleValues.Select(v => v.Source == "Analista" ? v with { Target = Roles.Supervisor } : v).ToList(),
        };
        var result = await Read(await client.PostAsync(
            "/admin/users/bulk-import/understand", Form(bytes, "planilla.csv", mapping: JsonSerializer.Serialize(edited, Web))));

        Assert.Equal("manual", result.Source);
        Assert.Single(model.Calls);
        Assert.Equal(Roles.Supervisor, result.Rows[1].Role);
    }

    [Fact]
    public async Task Our_template_is_read_without_the_model()
    {
        var (client, model) = await ClientAsync();
        var template = await (await client.GetAsync($"/admin/users/bulk-import/template?companyId={_companyId}")).Content.ReadAsByteArrayAsync();

        var result = await Read(await client.PostAsync("/admin/users/bulk-import/understand", Form(template, "plantilla.xlsx")));

        Assert.Equal("template", result.Source);
        Assert.Empty(model.Calls);
    }

    [Fact]
    public async Task Another_companys_id_is_refused_and_a_non_spreadsheet_is_a_400_with_a_code()
    {
        var (client, model) = await ClientAsync();

        var forbidden = await client.PostAsync("/admin/users/bulk-import/understand", Form(Encoding.UTF8.GetBytes(Csv), "p.csv", _otherCompanyId));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var pdf = await client.PostAsync("/admin/users/bulk-import/understand", Form([0x25, 0x50, 0x44, 0x46, 0x00, 0x01], "scan.pdf"));
        Assert.Equal(HttpStatusCode.BadRequest, pdf.StatusCode);
        Assert.Equal("not_a_spreadsheet", (await pdf.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["code"]);
        Assert.Empty(model.Calls);
    }

    /// <summary>
    /// Approval creates an approved new department ONCE, points every invitation that names it
    /// at it, and stores each row's demographics on its invitation — which the accept flow
    /// already copies onto the person.
    /// </summary>
    [Fact]
    public async Task Approving_creates_the_new_department_once_and_stores_demographics_on_the_invitations()
    {
        var (client, _) = await ClientAsync();
        var tag = Guid.NewGuid().ToString("N")[..8];
        BulkImportRowInput Row(int n, string department, string sede) =>
            new(n, $"Person {n}", $"p{n}.{tag}@example.test", "Colaborador", department, new Dictionary<string, string?> { ["sede"] = sede });
        var request = new BulkImportRowsRequest(_companyId, false, [Row(3, "Calidad", "heredia"), Row(4, "Calidad", "san_jose"), Row(5, "Finanzas", "heredia")], ["Calidad"]);

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", request);

        var result = (await response.Content.ReadFromJsonAsync<BulkImportResponse>())!;
        Assert.Equal(3, result.SuccessCount);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var calidad = await db.Departments.SingleAsync(d => d.CompanyId == _companyId && d.Name == "Calidad");
        var invitations = await db.UserInvitations.Where(i => i.Email!.EndsWith($".{tag}@example.test")).ToListAsync();
        Assert.Equal(2, invitations.Count(i => i.DepartmentId == calidad.Id));
        var stored = await db.UserInvitationDemographics.Where(d => invitations.Select(i => i.Id).Contains(d.InvitationId)).ToListAsync();
        Assert.Equal(3, stored.Count);
        Assert.Equal(2, stored.Count(d => d.Value == "heredia"));
    }

    [Fact]
    public async Task Preview_creates_no_department_and_a_bad_demographic_or_retired_department_is_named()
    {
        var (client, _) = await ClientAsync();
        var tag = Guid.NewGuid().ToString("N")[..8];
        var request = new BulkImportRowsRequest(
            _companyId,
            true,
            [
                new BulkImportRowInput(3, "A", $"a.{tag}@example.test", "Colaborador", "Nueva Área", null),
                new BulkImportRowInput(4, "B", $"b.{tag}@example.test", "Colaborador", "Archivo", null),
                new BulkImportRowInput(5, "C", $"c.{tag}@example.test", "Colaborador", null, new Dictionary<string, string?> { ["sede"] = "cartago" }),
            ],
            ["Nueva Área", "Archivo"]);

        var result = (await (await client.PostAsJsonAsync("/admin/users/bulk-import/rows", request)).Content.ReadFromJsonAsync<BulkImportResponse>())!;

        Assert.Equal("valid", result.Rows[0].Status);
        Assert.Equal("department_inactive", Assert.Single(result.Rows[1].Issues).Code);
        Assert.Equal("invalid_demographic", Assert.Single(result.Rows[2].Issues).Code);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Departments.AnyAsync(d => d.CompanyId == _companyId && d.Name == "Nueva Área"));
        Assert.Equal(1, await db.Departments.CountAsync(d => d.CompanyId == _companyId && d.Name == "Archivo"));
    }
}
