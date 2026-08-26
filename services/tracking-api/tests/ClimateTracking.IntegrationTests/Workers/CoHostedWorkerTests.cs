using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Application.Scheduling;
using ClimateTracking.Infrastructure.Persistence;
using ClimateTracking.Workers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace ClimateTracking.IntegrationTests.Workers;

/// <summary>
/// The third of #219's three prerequisites: <c>ClimateTracking.Api</c> must reference
/// <c>ClimateTracking.Workers</c> and actually run both jobs, because the API image is the only
/// container this service deploys.
///
/// Without it the service deploys, serves HTTP, and syncs nothing -- the <c>*_cache</c> tables
/// stay empty, so every nodo and persona NAME in the plans list and in the Procomer <c>.xlsx</c>
/// export renders blank, and no 30-day/15-day/vencimiento notification is ever sent. That is a
/// client-visible failure that no HTTP test would notice, which is why the first test here drives
/// a real API host and waits for rows to appear rather than asserting on a registration list.
/// </summary>
public class CoHostedWorkerTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _postgres;
    private readonly FakeClimateProjectClient _client = new();
    private ServiceProvider _readerProvider = null!;
    private WebApplicationFactory<Program> _factory = null!;

    public CoHostedWorkerTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    public async Task InitializeAsync()
    {
        // Migrate BEFORE the host starts. The co-hosted CacheSyncWorker ticks immediately on
        // start; against an unmigrated database that first tick would fail (logged, not fatal)
        // and the test would then be waiting out an interval for nothing.
        var readerServices = new ServiceCollection();
        readerServices.AddDbContext<ClimateTrackingDbContext>(options =>
            options.UseNpgsql(_postgres.ConnectionString));
        _readerProvider = readerServices.BuildServiceProvider();

        using (var scope = _readerProvider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            await db.Database.MigrateAsync();
        }

        _client.Nodos = [new NodoDto("ND-014", "Comercial Exterior", null, "PER-0231", 8, true, "CO-014")];
        _client.Personas =
            [new PersonaDto("PER-0231", "Maria Rodriguez", "mrodriguez@procomer.com", "ND-014", null, "leader", true, "CO-014")];

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", "test-tracking-secret-at-least-32-bytes-long");
            builder.UseSetting("ProcomerCompanyId", "CO-014");
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            // The one host in this suite that runs the jobs for real -- everywhere else they are
            // registered and idle. This is what makes the test below an end-to-end statement
            // about the deployed shape rather than about a service collection.
            builder.UseSetting("Workers:Enabled", "true");
            // 3 seconds, so a missed first tick is recoverable inside the wait below rather than
            // 15 minutes away.
            builder.UseSetting("CacheSyncIntervalMinutes", "0.05");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IClimateProjectClient>();
                services.AddSingleton<IClimateProjectClient>(_client);
            });
        });

        // Forces the host to start, which is what starts the hosted services.
        _factory.CreateClient().Dispose();
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        await _readerProvider.DisposeAsync();
    }

    [Fact]
    public async Task The_api_host_syncs_the_cache_tables_by_itself()
    {
        // Fails if the ProjectReference or the AddClimateTrackingWorkers call is removed: nothing
        // else in the API host writes these rows.
        var nodo = await WaitForAsync(async db =>
            await db.Nodos.AsNoTracking().FirstOrDefaultAsync(n => n.ExternalId == "ND-014"));

        Assert.NotNull(nodo);
        Assert.Equal("Comercial Exterior", nodo.Nombre);

        var persona = await WaitForAsync(async db =>
            await db.Personas.AsNoTracking().FirstOrDefaultAsync(p => p.ExternalId == "PER-0231"));

        Assert.NotNull(persona);
        // The name is the point. A blank one here is what the client sees as an empty cell in
        // the plans list and in the .xlsx export.
        Assert.Equal("Maria Rodriguez", persona.NombreCompleto);
    }

    [Fact]
    public void The_api_host_registers_both_background_jobs()
    {
        var hosted = _factory.Services.GetServices<IHostedService>().ToList();

        Assert.Contains(hosted, service => service is CacheSyncWorker);
        Assert.Contains(hosted, service => service is DailySemaforoWorker);
    }

    [Fact]
    public async Task Two_instances_of_the_same_job_cannot_run_at_once()
    {
        // The lease, stated as the thing it prevents. DailySemaforoWorker's idempotency is a read
        // ("has this trigger been recorded Enviado for this plan") followed by a write, so two
        // instances inside it at the same time both read "not sent" and both send -- duplicate
        // 30-day and 15-day reminders to the client about their own action plans. Since #219 the
        // API image runs this worker on every instance, so "two at once" is the default, not an
        // edge case.
        //
        // Nested rather than raced on purpose: while the outer lease is held, the inner attempt
        // MUST be refused, and asserting that is deterministic where a two-task race is not.
        using var outerScope = _factory.Services.CreateScope();
        using var innerScope = _factory.Services.CreateScope();
        var outerLease = outerScope.ServiceProvider.GetRequiredService<IJobLease>();
        var innerLease = innerScope.ServiceProvider.GetRequiredService<IJobLease>();
        var key = JobLockKey.For(TrackingJobs.DailySemaforo);

        var innerRan = true;
        var outerRan = await outerLease.TryRunExclusivelyAsync(
            key,
            async token =>
            {
                innerRan = await innerLease.TryRunExclusivelyAsync(
                    key,
                    _ => Task.CompletedTask,
                    token);
            },
            CancellationToken.None);

        Assert.True(outerRan, "the first caller must win the lease when nothing else holds it");
        Assert.False(innerRan, "a second caller must be refused while the first holds the lease");
    }

    [Fact]
    public async Task The_lease_is_released_when_the_run_finishes()
    {
        // The other half: a lease that is never released turns a single-flight guarantee into a
        // job that runs once and then never again. The advisory lock is transaction-scoped, so
        // this is really asserting that the transaction is committed rather than left open on a
        // pooled connection.
        using var scope = _factory.Services.CreateScope();
        var lease = scope.ServiceProvider.GetRequiredService<IJobLease>();
        var key = JobLockKey.For(TrackingJobs.CacheSync);

        var first = await lease.TryRunExclusivelyAsync(key, _ => Task.CompletedTask, CancellationToken.None);
        var second = await lease.TryRunExclusivelyAsync(key, _ => Task.CompletedTask, CancellationToken.None);

        Assert.True(first);
        Assert.True(second);
    }

    [Fact]
    public void Each_job_contends_on_its_own_lock_key()
    {
        // Postgres advisory locks are bare integers with no registry behind them, so two jobs
        // sharing a key would silently serialise against each other -- and a 24-hour job holding
        // the 15-minute job's key is not a failure anything would report.
        Assert.NotEqual(
            JobLockKey.For(TrackingJobs.CacheSync),
            JobLockKey.For(TrackingJobs.DailySemaforo));
    }

    /// <summary>
    /// Polls a fresh <see cref="ClimateTrackingDbContext"/> until the worker has written, or the
    /// deadline passes. A fresh context per attempt because a tracked context would answer from
    /// its own identity map and never see the insert.
    /// </summary>
    private async Task<T?> WaitForAsync<T>(Func<ClimateTrackingDbContext, Task<T?>> read)
        where T : class
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(60);
        while (DateTimeOffset.UtcNow < deadline)
        {
            using var scope = _readerProvider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
            var value = await read(db);
            if (value is not null)
            {
                return value;
            }

            await Task.Delay(250);
        }

        return null;
    }

    private sealed class FakeClimateProjectClient : IClimateProjectClient
    {
        public IReadOnlyList<NodoDto> Nodos { get; set; } = [];
        public IReadOnlyList<PersonaDto> Personas { get; set; } = [];
        public IReadOnlyList<CicloDto> Ciclos { get; set; } = [];

        public Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Nodos);

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
}
