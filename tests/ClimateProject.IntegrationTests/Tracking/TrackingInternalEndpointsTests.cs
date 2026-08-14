using System.Linq;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingInternalEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private Guid _companyId;

    public TrackingInternalEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    private Guid _parentDepartmentId;
    private Guid _childDepartmentId;
    private Guid _managerId;
    private string _legacyParentNodoId = null!;
    private string _legacyChildNodoId = null!;
    private string _legacyManagerPersonaId = null!;
    private string _legacyPersonaId = null!;

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyDomain = $"internal-{Guid.NewGuid():N}.test";
        var company = new Company { Id = Guid.NewGuid(), Name = "Internal Co", EmailDomain = companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;

        _legacyParentNodoId = $"legacy-nodo-parent-{Guid.NewGuid():N}";
        _legacyChildNodoId = $"legacy-nodo-child-{Guid.NewGuid():N}";
        _legacyManagerPersonaId = $"legacy-persona-manager-{Guid.NewGuid():N}";
        _legacyPersonaId = $"legacy-persona-{Guid.NewGuid():N}";

        _parentDepartmentId = Guid.NewGuid();
        _childDepartmentId = Guid.NewGuid();
        _managerId = Guid.NewGuid();

        // Parent department first -- the manager references it via DepartmentId and the
        // child department references it via ParentDepartmentId (Restrict on delete),
        // so it must exist before either.
        db.Departments.Add(new Department
        {
            Id = _parentDepartmentId,
            CompanyId = _companyId,
            Name = "Headquarters",
            LegacyExternalId = _legacyParentNodoId,
            EmployeeCount = 1,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Users.Add(new User
        {
            Id = _managerId,
            CompanyId = _companyId,
            Email = $"manager@{companyDomain}",
            Name = "Test Manager",
            Role = "company_admin",
            PersonaExternalId = _legacyManagerPersonaId,
            DepartmentId = _parentDepartmentId,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Departments.Add(new Department
        {
            Id = _childDepartmentId,
            CompanyId = _companyId,
            Name = "Engineering",
            LegacyExternalId = _legacyChildNodoId,
            ParentDepartmentId = _parentDepartmentId,
            ManagerId = _managerId,
            EmployeeCount = 3,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = $"persona@{companyDomain}",
            Name = "Test Persona",
            Role = "employee",
            PersonaExternalId = _legacyPersonaId,
            DepartmentId = _childDepartmentId,
            ManagerId = _managerId,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Returns_nodos_with_snake_case_envelope_shape()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<NodosData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        Assert.Equal(2, envelope.Data.Nodos.Count);

        var parent = Assert.Single(envelope.Data.Nodos, n => n.Nombre == "Headquarters");
        Assert.Equal(_legacyParentNodoId, parent.NodoId);
        Assert.Null(parent.NodoPadreId);
        Assert.Null(parent.LiderId);

        var child = Assert.Single(envelope.Data.Nodos, n => n.Nombre == "Engineering");
        Assert.Equal(_legacyChildNodoId, child.NodoId);
        // ONE, not the three this department's `employee_count` column claims. The fixture
        // sets that column to 3 and then seeds a single user, and the divergence is
        // deliberate: nothing in the product has ever written `employee_count`, so it is 0
        // in every real database and any value it holds here is fiction. Reading it made
        // this feed publish a headcount to an external consumer that no user table agreed
        // with. Asserting the counted value against a column that disagrees is what stops
        // the projection quietly going back to `d.EmployeeCount`.
        Assert.Equal(1, child.CantidadColaboradores);
        Assert.Equal(parent.NodoId, child.NodoPadreId);
        Assert.Equal(_legacyManagerPersonaId, child.LiderId);
    }

    [Fact]
    public async Task Returns_personas_with_persona_external_id()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var response = await client.GetAsync($"/api/internal/personas?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);
        Assert.True(envelope!.Success);
        var persona = Assert.Single(envelope.Data.Personas, p => p.NombreCompleto == "Test Persona");
        Assert.Equal(_legacyPersonaId, persona.PersonaId);
        Assert.StartsWith("persona@", persona.Correo);
        Assert.Equal(_legacyManagerPersonaId, persona.ManagerId);
        Assert.Equal(_legacyChildNodoId, persona.NodoId);
    }

    // Regression test for the Critical finding: /personas used to emit `NodoId` from the
    // never-populated `User.NodoId` column instead of resolving it through
    // `User.DepartmentId`, so it never matched any nodo_id from /nodos. Assert the join
    // explicitly across both endpoints rather than just checking each shape in isolation.
    [Fact]
    public async Task Personas_nodo_id_resolves_to_a_nodo_id_present_in_the_nodos_response()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var nodosResponse = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        var personasResponse = await client.GetAsync($"/api/internal/personas?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, nodosResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, personasResponse.StatusCode);

        var nodosEnvelope = await nodosResponse.Content.ReadFromJsonAsync<Envelope<NodosData>>(_snakeCaseOptions);
        var personasEnvelope = await personasResponse.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);

        var nodoIds = nodosEnvelope!.Data.Nodos.Select(n => n.NodoId).ToHashSet();
        Assert.NotEmpty(nodoIds);

        foreach (var persona in personasEnvelope!.Data.Personas)
        {
            Assert.False(string.IsNullOrEmpty(persona.NodoId));
            Assert.Contains(persona.NodoId, nodoIds);
        }
    }

    // Regression test for the finding that /personas emitted nodo_id: "" for any user with
    // no DepartmentId (the common case: plain /auth/signup and Google login never set it).
    // A departmentless user must still get a non-empty nodo_id that resolves to a nodo_id
    // present in /nodos.
    [Fact]
    public async Task Personas_with_no_department_resolve_to_a_synthetic_unassigned_nodo_present_in_nodos_response()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = "no-department@internal.test",
                Name = "No Department User",
                Role = "employee",
                DepartmentId = null,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);

        var nodosResponse = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        var personasResponse = await client.GetAsync($"/api/internal/personas?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.OK, nodosResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, personasResponse.StatusCode);

        var nodosEnvelope = await nodosResponse.Content.ReadFromJsonAsync<Envelope<NodosData>>(_snakeCaseOptions);
        var personasEnvelope = await personasResponse.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);

        var expectedUnassignedId = TrackingIdentifiers.UnassignedNodoId(_companyId);
        Assert.Contains(nodosEnvelope!.Data.Nodos, n => n.NodoId == expectedUnassignedId && n.CantidadColaboradores == 1);

        var persona = Assert.Single(personasEnvelope!.Data.Personas, p => p.NombreCompleto == "No Department User");
        Assert.Equal(expectedUnassignedId, persona.NodoId);
        Assert.Contains(persona.NodoId, nodosEnvelope.Data.Nodos.Select(n => n.NodoId));
    }

    [Fact]
    public async Task Rejects_request_with_missing_or_wrong_api_key()
    {
        var client = _factory.CreateClient();

        var missingKey = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.Unauthorized, missingKey.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "wrong-key");
        var wrongKey = await client.GetAsync($"/api/internal/nodos?company_id={_companyId}");
        Assert.Equal(HttpStatusCode.Unauthorized, wrongKey.StatusCode);
    }
}
