using System.Net;
using System.Text.Json;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// Proves /ready is a real dependency probe and not another static literal.
///
/// The negative test below is the one that matters, and it is written to fail if
/// /ready were ever reduced to a constant: it points the app at a database that
/// cannot be reached and asserts /health still answers 200 while /ready answers 503.
/// That divergence is precisely the defect that made the old deploy canary
/// worthless -- it polled /health, which cannot observe the database at all, so a
/// service deployed with a broken connection string passed the canary and the
/// deploy was reported successful.
/// </summary>
/// <summary>
/// Holds ONE application host for all three unreachable-database tests.
///
/// This is a class fixture rather than a factory created per test on purpose. xUnit
/// instantiates the test class once per test method, so a factory built in the
/// constructor would boot three hosts instead of one. That matters here: #189 took
/// the "AppHost" collection from 5 host boots to 13, and concurrent/most numerous
/// host boots are the identified structural hazard behind the #68
/// StartupValidationTests flake (see AppHostCollection). All three tests want
/// identical configuration, so there is no reason to pay for three.
/// </summary>
public sealed class UnreachableDatabaseHostFixture : IDisposable
{
    // Routable-but-dead: port 1 on the loopback interface. Chosen over a bogus
    // hostname on purpose -- a DNS failure can take the resolver's full timeout on
    // some CI runners, whereas this refuses the TCP connection immediately, which
    // keeps the test fast and its failure mode unambiguous.
    private const string UnreachableDatabase =
        "Host=127.0.0.1;Port=1;Database=unreachable;Username=none;Password=none;Timeout=2;Command Timeout=2";

    public WebApplicationFactory<Program> Factory { get; } =
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ClimateProject"] = UnreachableDatabase,
                    // Must be non-empty or the startup guards trip and these tests
                    // would pass for the wrong reason. See StartupValidationTests.
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["GoogleClientId"] = "test-google-client-id",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                });
            });
        });

    public void Dispose() => Factory.Dispose();
}

[Collection("AppHost")]
public class ReadinessEndpointTests(UnreachableDatabaseHostFixture host)
    : IClassFixture<UnreachableDatabaseHostFixture>
{
    [Fact]
    public async Task Ready_returns_503_when_the_database_cannot_be_reached()
    {
        // CreateClient(), never host.Factory.Services -- the latter intermittently
        // throws ObjectDisposedException and masks the real failure (#68).
        var client = host.Factory.CreateClient();

        var response = await client.GetAsync("/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("not-ready", document.RootElement.GetProperty("status").GetString());
        Assert.Equal("unreachable", document.RootElement.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Health_still_returns_200_when_the_database_cannot_be_reached()
    {
        // The companion half of the test above. Together they pin the intended
        // split: /health is liveness (App Runner polls it, and must not be torn
        // down by a database blip), /ready is the deploy gate. If someone "fixes"
        // /health to probe the database, this test fails and forces the
        // conversation rather than silently changing App Runner's teardown
        // behaviour in production.
        var client = host.Factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_does_not_leak_database_connection_details()
    {
        // /ready is unauthenticated. Npgsql's failure messages carry the host,
        // database name and username of whatever it tried to reach, so echoing the
        // exception would hand an anonymous caller a description of the production
        // database.
        var client = host.Factory.CreateClient();

        var body = await (await client.GetAsync("/ready")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("127.0.0.1", body, StringComparison.Ordinal);
        Assert.DoesNotContain("unreachable;", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Username", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// The happy path needs a real Postgres, so it lives in the "Postgres" collection
/// alongside every other container-backed test rather than in "AppHost".
/// </summary>
[Collection("Postgres")]
public class ReadinessEndpointDatabaseTests(PostgresContainerFixture postgres)
{
    [Fact]
    public async Task Ready_returns_200_when_the_database_round_trip_succeeds()
    {
        using var factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("climate-project-api", document.RootElement.GetProperty("service").GetString());
        Assert.Equal("ready", document.RootElement.GetProperty("status").GetString());
        Assert.Equal("ok", document.RootElement.GetProperty("database").GetString());
    }
}
