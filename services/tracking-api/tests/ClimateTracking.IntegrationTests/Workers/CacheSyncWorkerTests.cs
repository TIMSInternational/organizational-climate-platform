using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Infrastructure.Persistence;
using ClimateTracking.Workers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateTracking.IntegrationTests.Workers;

public class CacheSyncWorkerTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _postgres;
    private ServiceProvider _provider = null!;

    public CacheSyncWorkerTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    public async Task InitializeAsync()
    {
        var services = new ServiceCollection();
        services.AddDbContext<ClimateTrackingDbContext>(options =>
            options.UseNpgsql(_postgres.ConnectionString));
        _provider = services.BuildServiceProvider();

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _provider.DisposeAsync();
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public IReadOnlyList<NodoDto> Nodos { get; set; } = [];
        public IReadOnlyList<PersonaDto> Personas { get; set; } = [];
        public IReadOnlyList<CicloDto> Ciclos { get; set; } = [];
        public bool ThrowOnNodos { get; set; }

        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            ThrowOnNodos
                ? throw new HttpRequestException("simulated failure")
                : Task.FromResult(Nodos);

        public Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Personas);

        public Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Ciclos);

        public Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<HallazgoDto>>([]);

        public Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken) =>
            Task.FromResult<HallazgoDto?>(null);

        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    [Fact]
    public async Task SyncOnceAsync_upserts_nodos_personas_and_ciclos_from_the_client()
    {
        var client = new FakeClimateProjectClient
        {
            Nodos = [new NodoDto("ND-014", "Comercial Exterior", null, "PER-0231", 8, true, "CO-014")],
            Personas = [new PersonaDto("PER-0231", "Maria Rodriguez", "mrodriguez@procomer.com", "ND-014", null, "leader", true, "CO-014")],
            Ciclos = [new CicloDto("survey-q3-2026", DateTimeOffset.Parse("2026-07-01T00:00:00Z"), DateTimeOffset.Parse("2026-07-15T00:00:00Z"), 48, "abierto", "CO-014")],
        };
        var worker = new CacheSyncWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<CacheSyncWorker>.Instance);

        await worker.SyncOnceAsync(CancellationToken.None);

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var nodo = await db.Nodos.SingleAsync(n => n.ExternalId == "ND-014");
        var persona = await db.Personas.SingleAsync(p => p.ExternalId == "PER-0231");
        var ciclo = await db.CiclosEncuesta.SingleAsync(c => c.ExternalId == "survey-q3-2026");

        Assert.Equal("Comercial Exterior", nodo.Nombre);
        Assert.Equal(8, nodo.CantidadColaboradores);
        Assert.Equal("Maria Rodriguez", persona.NombreCompleto);
        Assert.Equal(48, ciclo.NumeroPreguntas);
        Assert.True(nodo.LastSyncedAt > DateTimeOffset.MinValue);
    }

    [Fact]
    public async Task SyncOnceAsync_updates_existing_rows_in_place_without_duplicating()
    {
        var client = new FakeClimateProjectClient
        {
            Nodos = [new NodoDto("ND-020", "Nodo Original", null, "PER-0001", 5, true, "CO-014")],
        };
        var worker = new CacheSyncWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<CacheSyncWorker>.Instance);
        await worker.SyncOnceAsync(CancellationToken.None);
        var firstSync = await GetSyncedAt("ND-020");

        await Task.Delay(10);
        client.Nodos = [new NodoDto("ND-020", "Nodo Actualizado", null, "PER-0002", 9, true, "CO-014")];
        await worker.SyncOnceAsync(CancellationToken.None);

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var count = await db.Nodos.CountAsync(n => n.ExternalId == "ND-020");
        var nodo = await db.Nodos.SingleAsync(n => n.ExternalId == "ND-020");

        Assert.Equal(1, count);
        Assert.Equal("Nodo Actualizado", nodo.Nombre);
        Assert.Equal(9, nodo.CantidadColaboradores);
        Assert.True(nodo.LastSyncedAt > firstSync);
    }

    private async Task<DateTimeOffset> GetSyncedAt(string externalId)
    {
        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var nodo = await db.Nodos.SingleAsync(n => n.ExternalId == externalId);
        return nodo.LastSyncedAt;
    }

    [Fact]
    public async Task SyncOnceAsync_does_not_throw_when_the_client_fails_for_one_entity_type()
    {
        var client = new FakeClimateProjectClient
        {
            ThrowOnNodos = true,
            Personas = [new PersonaDto("PER-0500", "Someone Else", "someone@procomer.com", "ND-030", null, "employee", true, "CO-014")],
        };
        var worker = new CacheSyncWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<CacheSyncWorker>.Instance);

        var exception = await Record.ExceptionAsync(() => worker.SyncOnceAsync(CancellationToken.None));

        Assert.Null(exception);

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        Assert.True(await db.Personas.AnyAsync(p => p.ExternalId == "PER-0500"));
    }
}
