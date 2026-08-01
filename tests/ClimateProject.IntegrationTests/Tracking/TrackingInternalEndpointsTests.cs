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

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyDomain = $"internal-{Guid.NewGuid():N}.test";
        var company = new Company { Id = Guid.NewGuid(), Name = "Internal Co", EmailDomain = companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;

        var legacyNodoId = $"legacy-nodo-{Guid.NewGuid():N}";
        var legacyPersonaId = $"legacy-persona-{Guid.NewGuid():N}";

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Name = "Engineering",
            LegacyExternalId = legacyNodoId,
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
            PersonaExternalId = legacyPersonaId,
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
        var nodo = Assert.Single(envelope.Data.Nodos);
        Assert.Equal("Engineering", nodo.Nombre);
        Assert.Equal(3, nodo.CantidadColaboradores);
        Assert.StartsWith("legacy-nodo-", nodo.NodoId);
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
        var persona = Assert.Single(envelope.Data.Personas);
        Assert.Equal("Test Persona", persona.NombreCompleto);
        Assert.StartsWith("legacy-persona-", persona.PersonaId);
        Assert.StartsWith("persona@", persona.Correo);
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
