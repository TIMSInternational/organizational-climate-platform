using Testcontainers.PostgreSql;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// The database every container-backed test runs against, and -- since #279 -- the single
/// application host they all share.
///
/// <para>
/// <b>Why the host lives here.</b> xUnit constructs a fresh test-class instance for every
/// <c>[Fact]</c>, so a factory built in a class constructor is built once per test case, not
/// once per class. Counted on this assembly: 58 classes constructed
/// <see cref="AuthWebApplicationFactory"/>, and between them they hold <b>833 test cases</b>
/// (test CASES, so each <c>[Theory]</c> row counts, which is the number that matters here) --
/// so the "Postgres" collection alone booted on the order of 830 application hosts per run.
/// Read that as the upper bound it is: a few of the 58 built lazily and so not in every case.
/// 50 of the 58 never disposed theirs, so the hosts stayed alive until the
/// process exited. That is what #279 is: <c>WebApplicationFactory&lt;Program&gt;</c> reaches a
/// top-level-statements entry point through <c>HostFactoryResolver</c>, whose capture handshake
/// has a hard 300s timeout and races under load (see
/// <c>StartupValidationTests.IsHostCaptureRace</c>), and hundreds of live hosts are exactly the
/// load that makes it lose.
/// </para>
/// <para>
/// <b>What that is now, and what it is NOT.</b> This collection builds five hosts a run, and
/// <see cref="AuthWebApplicationFactory.HostBudget"/> refuses a sixth. The whole assembly is a
/// different number and a much less flattering one: the "AppHost" collection was not touched by
/// #279 and still builds roughly a host per test case -- 48 measured for its 57 cases -- because
/// varying the host configuration is what those classes are for. A full run therefore went from
/// about 880 hosts to 53, roughly 17x, and the claim to make about #279 is that it removed the
/// dominant term rather than that it removed the hosts.
/// </para>
/// <para>
/// A collection fixture is constructed once for the whole "Postgres" collection and disposed
/// once, which is the lifetime the host should have had all along. The database was already
/// shared this way, so nothing about test isolation changes: classes already had to make their
/// own company e-mail domains unique, and they still do.
/// </para>
/// <para>
/// <b>The one interaction worth naming: a long-lived host now outlives a TRUNCATE.</b>
/// Four classes -- the three in <c>Scheduling</c> (45 cases between them) and
/// <c>SurveyDraftExpiryIndexTests</c> -- open their own <c>DbContext</c> straight at
/// <see cref="ConnectionString"/> and run <c>TRUNCATE TABLE companies CASCADE</c> before every
/// test, so the whole database empties dozens of times a run underneath a host that used to be
/// thrown away between test cases and now is not. It is safe for a reason rather than by
/// luck: this application holds no row-level state between requests -- there is no
/// <c>IMemoryCache</c>, no <c>IDistributedCache</c> and no second-level EF cache anywhere in
/// <c>src</c> -- so a host has nothing that a truncation could leave stale, and pooled
/// connections to an emptied database are still valid connections. Run rather than reasoned
/// about: all 45 Scheduling cases green in one process with the converted Auth namespace, and
/// <c>SharedHostTests</c> executed after all three Scheduling classes in that run, driving the
/// authentication limiter to exhaustion through the same shared host.
/// </para>
/// </summary>
public class PostgresContainerFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("climate_project_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    private AuthWebApplicationFactory? _app;

    public string ConnectionString => _container.GetConnectionString();

    /// <summary>
    /// The one application host the "Postgres" collection shares, migrated and ready.
    ///
    /// <para>
    /// Use this instead of <c>new AuthWebApplicationFactory(postgres.ConnectionString)</c>, and
    /// do NOT dispose it -- the fixture owns it. A class that genuinely needs a differently
    /// configured host still builds its own from <see cref="ConnectionString"/> and disposes
    /// it; <c>AuditPoolPressureTests</c> is the worked example, and its host differs in the one
    /// way that matters to it (a deliberately small connection pool).
    /// </para>
    /// </summary>
    public AuthWebApplicationFactory App => _app
        ?? throw new InvalidOperationException(
            "The shared application host is built in InitializeAsync. Reaching it before then means "
            + "this fixture was constructed outside the \"Postgres\" collection.");

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        // Migrations run once, here, rather than once per test case. Every converted class
        // used to open its InitializeAsync with ApplyMigrationsAsync(); those calls were
        // idempotent but not free, and the first of them is what forced the host boot.
        _app = new AuthWebApplicationFactory(ConnectionString);
        await _app.ApplyMigrationsAsync();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }

        await _container.DisposeAsync();
    }
}

[CollectionDefinition("Postgres")]
public class PostgresCollection : ICollectionFixture<PostgresContainerFixture>;
