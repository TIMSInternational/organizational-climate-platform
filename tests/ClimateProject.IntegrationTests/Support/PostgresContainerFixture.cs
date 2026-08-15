using Testcontainers.PostgreSql;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// The database every container-backed test runs against, and -- since #279 -- the single
/// application host they all share.
///
/// <para>
/// <b>Why the host lives here.</b> xUnit constructs a fresh test-class instance for every
/// <c>[Fact]</c>, so a factory built in a class constructor is built once per test case, not
/// once per class. Measured on this assembly: 58 classes construct
/// <see cref="AuthWebApplicationFactory"/>, and between them they hold 744 test methods, so a
/// full run booted on the order of 800 application hosts -- and 50 of those 58 classes never
/// disposed theirs, so the hosts stayed alive until the process exited. That is what #279 is:
/// <c>WebApplicationFactory&lt;Program&gt;</c> reaches a top-level-statements entry point
/// through <c>HostFactoryResolver</c>, whose capture handshake has a hard 300s timeout and
/// races under load (see <c>StartupValidationTests.IsHostCaptureRace</c>), and hundreds of
/// live hosts are exactly the load that makes it lose.
/// </para>
/// <para>
/// A collection fixture is constructed once for the whole "Postgres" collection and disposed
/// once, which is the lifetime the host should have had all along. The database was already
/// shared this way, so nothing about test isolation changes: classes already had to make their
/// own company e-mail domains unique, and they still do.
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
