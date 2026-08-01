using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using ClimateTracking.Infrastructure.Persistence;
using ClimateTracking.Workers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateTracking.IntegrationTests.Workers;

public class DailySemaforoWorkerTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _postgres;
    private ServiceProvider _provider = null!;

    public DailySemaforoWorkerTests(PostgresFixture postgres)
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
        await db.PlanesDeAccion.ExecuteDeleteAsync();
        await db.Notificaciones.ExecuteDeleteAsync();
    }

    public async Task DisposeAsync()
    {
        await _provider.DisposeAsync();
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public List<SendNotificationRequest> SentRequests { get; } = [];
        public bool ThrowOnSend { get; set; }

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

        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken)
        {
            if (ThrowOnSend)
            {
                throw new HttpRequestException("simulated failure");
            }
            SentRequests.Add(request);
            return Task.CompletedTask;
        }
    }

    private static PlanDeAccion NewPlan(DateOnly creacion, DateOnly compromiso) => new()
    {
        PlanCode = $"PA-{Guid.NewGuid():N}"[..20],
        NodoExternalId = "ND-014",
        LiderExternalId = "PER-0231",
        DescripcionQue = "Plan sembrado para pruebas del worker diario",
        MetodologiaComo = "N/A",
        ResponsableEjecucionExternalId = "PER-0231",
        FechaCreacion = creacion,
        FechaCompromiso = compromiso,
    };

    [Fact]
    public async Task Dispatches_recordatorio_30_dias_when_30_days_remain()
    {
        var today = new DateOnly(2026, 6, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(30));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient();
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        await worker.RunOnceAsync(today, CancellationToken.None);

        Assert.Single(client.SentRequests);
        Assert.Equal("recordatorio_30_dias", client.SentRequests[0].TipoDisparador);
        Assert.Equal(plan.Id.ToString(), client.SentRequests[0].PlanId);
    }

    [Fact]
    public async Task Dispatches_alerta_15_dias_when_15_days_remain()
    {
        var today = new DateOnly(2026, 6, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(15));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient();
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        await worker.RunOnceAsync(today, CancellationToken.None);

        Assert.Single(client.SentRequests);
        Assert.Equal("alerta_15_dias", client.SentRequests[0].TipoDisparador);
    }

    [Fact]
    public async Task Dispatches_vencimiento_once_the_plan_is_overdue()
    {
        var today = new DateOnly(2026, 6, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(-1));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient();
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        await worker.RunOnceAsync(today, CancellationToken.None);

        Assert.Single(client.SentRequests);
        Assert.Equal("vencimiento", client.SentRequests[0].TipoDisparador);

        using var scope2 = _provider.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var reloaded = await db2.PlanesDeAccion.SingleAsync(p => p.Id == plan.Id);
        Assert.Equal(EstadoSemaforo.Rojo, reloaded.EstadoSemaforo);
    }

    [Fact]
    public async Task Does_not_dispatch_the_same_trigger_twice_on_the_same_day()
    {
        var today = new DateOnly(2026, 6, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(30));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient();
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        await worker.RunOnceAsync(today, CancellationToken.None);
        await worker.RunOnceAsync(today, CancellationToken.None);

        Assert.Single(client.SentRequests);
    }

    [Fact]
    public async Task Marks_fallido_and_does_not_throw_when_the_client_fails()
    {
        var today = new DateOnly(2026, 6, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(30));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient { ThrowOnSend = true };
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        var exception = await Record.ExceptionAsync(() => worker.RunOnceAsync(today, CancellationToken.None));

        Assert.Null(exception);

        using var scope2 = _provider.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var notificacion = await db2.Notificaciones.SingleAsync(n => n.PlanDeAccionId == plan.Id);
        Assert.Equal(EstadoEnvioNotificacion.Fallido, notificacion.EstadoEnvio);
    }

    [Fact]
    public async Task Retries_a_failed_dispatch_on_a_later_day_until_it_succeeds()
    {
        var compromiso = new DateOnly(2026, 7, 1);
        var plan = NewPlan(new DateOnly(2026, 1, 1), compromiso);
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.Add(plan);
            await db.SaveChangesAsync();
        }

        var client = new FakeClimateProjectClient { ThrowOnSend = true };
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        // Day 30 (compromiso - 30): dispatch fails.
        await worker.RunOnceAsync(compromiso.AddDays(-30), CancellationToken.None);
        Assert.Empty(client.SentRequests);

        // Day 25: the Recordatorio30Dias window is still open (<=30), so it retries and
        // this time succeeds — the earlier Fallido must not have permanently blocked it.
        client.ThrowOnSend = false;
        await worker.RunOnceAsync(compromiso.AddDays(-25), CancellationToken.None);

        Assert.Single(client.SentRequests);
        Assert.Equal("recordatorio_30_dias", client.SentRequests[0].TipoDisparador);

        using var scope2 = _provider.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var notificaciones = await db2.Notificaciones.Where(n => n.PlanDeAccionId == plan.Id).ToListAsync();
        Assert.Equal(2, notificaciones.Count);
        Assert.Contains(notificaciones, n => n.EstadoEnvio == EstadoEnvioNotificacion.Fallido);
        Assert.Contains(notificaciones, n => n.EstadoEnvio == EstadoEnvioNotificacion.Enviado);
    }

    [Fact]
    public async Task One_plans_failure_does_not_block_notifications_for_other_plans_in_the_same_run()
    {
        var today = new DateOnly(2026, 6, 1);
        var okPlan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(30));
        var failingPlan = NewPlan(new DateOnly(2026, 1, 1), today.AddDays(15));
        using (var scope = _provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            db.PlanesDeAccion.AddRange(okPlan, failingPlan);
            await db.SaveChangesAsync();
        }

        var client = new SelectivelyFailingClient(failForPlanId: failingPlan.Id);
        var worker = new DailySemaforoWorker(_provider.GetRequiredService<IServiceScopeFactory>(), client, NullLogger<DailySemaforoWorker>.Instance);

        await worker.RunOnceAsync(today, CancellationToken.None);

        Assert.Single(client.SentRequests);
        Assert.Equal(okPlan.Id.ToString(), client.SentRequests[0].PlanId);

        using var scope2 = _provider.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var failingNotificacion = await db2.Notificaciones.SingleAsync(n => n.PlanDeAccionId == failingPlan.Id);
        Assert.Equal(EstadoEnvioNotificacion.Fallido, failingNotificacion.EstadoEnvio);
    }

    private sealed class SelectivelyFailingClient(Guid failForPlanId) : IClimateProjectClient
    {
        public List<SendNotificationRequest> SentRequests { get; } = [];

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

        public Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken)
        {
            if (request.PlanId == failForPlanId.ToString())
            {
                throw new HttpRequestException("simulated failure for this plan only");
            }
            SentRequests.Add(request);
            return Task.CompletedTask;
        }
    }
}
