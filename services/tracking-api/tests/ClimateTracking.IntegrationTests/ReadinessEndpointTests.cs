using System.Net;
using System.Text.Json;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateTracking.IntegrationTests;

/// <summary>
/// Proves <c>GET /ready</c> is a real dependency probe and not another static literal.
///
/// App Runner probes this path (HealthCheckPath in
/// infra/aws/climate-tracking-api-prod-service.yml) and deploy-tracking-prod.yml's canary
/// demands 20 consecutive 200s from it. The negative test below is the one that matters, and it
/// is written to fail if /ready were ever reduced to a constant: it points the app at a database
/// that cannot be reached and asserts /health still answers 200 while /ready answers 503. A
/// readiness probe that cannot fail is the defect, not the feature -- it lets a dead instance
/// serve errors indefinitely, because App Runner never learns to replace it.
/// </summary>
public sealed class UnreachableDatabaseHostFixture : IDisposable
{
    // Routable-but-dead: port 1 on the loopback interface. Chosen over a bogus hostname on
    // purpose -- a DNS failure can take the resolver's full timeout on some CI runners, whereas
    // this refuses the TCP connection immediately, which keeps the test fast and its failure
    // mode unambiguous.
    private const string UnreachableDatabase =
        "Host=127.0.0.1;Port=1;Database=unreachable;Username=none;Password=none;Timeout=2;Command Timeout=2";

    public WebApplicationFactory<Program> Factory { get; } =
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", UnreachableDatabase);
            // Non-empty, or the startup guards trip and these tests would pass for the wrong
            // reason -- a host that refused to start reports no /ready at all.
            builder.UseSetting("TrackingJwtSecret", "test-tracking-secret-at-least-32-bytes-long");
            builder.UseSetting("ProcomerCompanyId", "CO-014");
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            // The API host co-hosts the jobs (#219); idle here so no job timer dials the
            // deliberately unreachable database alongside the probe under test.
            builder.UseSetting("Workers:Enabled", "false");
        });

    public void Dispose() => Factory.Dispose();
}

public class ReadinessEndpointTests(UnreachableDatabaseHostFixture host)
    : IClassFixture<UnreachableDatabaseHostFixture>
{
    [Fact]
    public async Task Ready_returns_503_when_the_database_cannot_be_reached()
    {
        var client = host.Factory.CreateClient();

        var response = await client.GetAsync("/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("climate-tracking-api", document.RootElement.GetProperty("service").GetString());
        Assert.Equal("not-ready", document.RootElement.GetProperty("status").GetString());
        Assert.Equal("unreachable", document.RootElement.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Health_still_returns_200_when_the_database_cannot_be_reached()
    {
        // The companion half of the test above. Together they pin the intended split: /health
        // is liveness ("the process is up"), /ready is readiness and is what App Runner polls.
        // If someone "fixes" this by pointing HealthCheckPath at /health -- the configuration
        // #221 removed from climate-project -- an instance that has lost Postgres passes
        // forever and is never replaced.
        var client = host.Factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_does_not_leak_database_connection_details()
    {
        // /ready is unauthenticated -- App Runner sends no bearer token, so it cannot be behind
        // authorization. Npgsql's failure messages carry the host, database name and username of
        // whatever it tried to reach, so echoing the exception would hand an anonymous caller a
        // description of the production database.
        var client = host.Factory.CreateClient();

        var body = await (await client.GetAsync("/ready")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("127.0.0.1", body, StringComparison.Ordinal);
        Assert.DoesNotContain("unreachable;", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Username", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// The happy path, against a real Postgres. Without this the suite would only ever have seen
/// /ready fail, which a hardcoded 503 would also satisfy.
/// </summary>
public class ReadinessEndpointDatabaseTests : IClassFixture<PostgresFixture>, IAsyncLifetime
{
    private readonly PostgresFixture _postgres;
    private WebApplicationFactory<Program> _factory = null!;

    public ReadinessEndpointDatabaseTests(PostgresFixture postgres)
    {
        _postgres = postgres;
    }

    public async Task InitializeAsync()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:ClimateTracking", _postgres.ConnectionString);
            builder.UseSetting("TrackingJwtSecret", "test-tracking-secret-at-least-32-bytes-long");
            builder.UseSetting("ProcomerCompanyId", "CO-014");
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            builder.UseSetting("Workers:Enabled", "false");
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Ready_returns_200_when_the_database_round_trip_succeeds()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("climate-tracking-api", document.RootElement.GetProperty("service").GetString());
        Assert.Equal("ready", document.RootElement.GetProperty("status").GetString());
        Assert.Equal("ok", document.RootElement.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Ready_requires_no_authorization()
    {
        // Not incidental to the test above: App Runner's health checker sends no bearer token,
        // so a /ready behind .RequireAuthorization() answers 401 to every probe and the rollout
        // is rejected with the endpoint working perfectly.
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/ready");

        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
