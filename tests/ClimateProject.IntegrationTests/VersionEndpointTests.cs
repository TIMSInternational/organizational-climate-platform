using System.Net;
using System.Reflection;
using System.Text.Json;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// Guards the build-provenance contract of <c>GET /version</c>.
///
/// The point of these tests is not that the endpoint returns 200 -- it is that the
/// commit and build timestamp are genuinely threaded from the build system rather
/// than being literals in Program.cs. A hardcoded commit string would satisfy a
/// naive "does the field exist" assertion while reintroducing the exact defect this
/// endpoint was changed to fix, so the plumbing itself is asserted below.
/// </summary>
[Collection("AppHost")]
public class VersionEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public VersionEndpointTests(WebApplicationFactory<Program> factory)
    {
        // Same reasoning as HealthEndpointTests: the JWT bearer handler runs on
        // every request including unauthenticated ones and needs a non-empty
        // signing key, and appsettings.json ships an empty TrackingJwtSecret.
        //
        // The connection string and InternalApiKey are supplied for forward
        // compatibility with #189, which adds .ValidateOnStart() for both -- without
        // them the host would refuse to start once that lands, and /version would
        // become unreachable for reasons having nothing to do with /version. The
        // connection string here is never connected to: /version reports build
        // metadata and touches no dependency.
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                    ["GoogleClientId"] = "test-google-client-id",
                });
            });
        });
    }

    [Fact]
    public async Task Version_endpoint_reports_service_runtime_environment_commit_and_build_time()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/version");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.Equal("climate-project-api", root.GetProperty("service").GetString());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("runtime").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("environment").GetString()));

        // The two fields that make deploy drift detectable. Never blank: an absent
        // build stamp is reported as the sentinel "unknown", so emptiness here means
        // the provenance plumbing is broken rather than merely unsupplied.
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("commit").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("builtAt").GetString()));
    }

    [Fact]
    public async Task Version_endpoint_reports_the_commit_stamped_into_the_api_assembly()
    {
        var client = _factory.CreateClient();

        using var document = JsonDocument.Parse(
            await client.GetStringAsync("/version"));
        var root = document.RootElement;

        // This is the assertion that actually proves the wiring: whatever the build
        // stamped into the assembly is what the endpoint must report. It holds both
        // for a local build (where the csproj default makes this "unknown") and for
        // the Docker/CI build (where it is a real 40-char SHA), so it does not
        // become a false failure the day CI starts passing /p:CommitSha.
        Assert.Equal(
            ReadApiAssemblyMetadata("CommitSha"),
            root.GetProperty("commit").GetString());
        Assert.Equal(
            ReadApiAssemblyMetadata("BuildTimestamp"),
            root.GetProperty("builtAt").GetString());
    }

    [Fact]
    public void Api_assembly_carries_build_provenance_metadata()
    {
        // Asserts the csproj AssemblyMetadata items survive -- if someone removes
        // them, the endpoint would silently fall back to "unknown" forever and the
        // deploy-drift detection would be quietly dead again. Presence, not value:
        // the value legitimately differs between a local and a CI/Docker build.
        Assert.NotNull(ReadApiAssemblyMetadata("CommitSha"));
        Assert.NotNull(ReadApiAssemblyMetadata("BuildTimestamp"));
    }

    private static string? ReadApiAssemblyMetadata(string key) =>
        typeof(Program).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => string.Equals(attribute.Key, key, StringComparison.Ordinal))
            ?.Value;
}
