using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ClimateTracking.IntegrationTests;

/// <summary>
/// Guards the build-provenance contract of <c>GET /version</c>.
///
/// The point is not that the endpoint returns 200 -- it is that <c>commit</c> is genuinely
/// threaded from the build system rather than being a literal in Program.cs. A hardcoded commit
/// string would satisfy a naive "does the field exist" assertion while reintroducing the exact
/// defect this endpoint exists to fix, so the plumbing itself is asserted below.
///
/// No database: /version reports build metadata and touches no dependency. The connection string
/// below is never connected to, and the jobs are idle so nothing else dials it either.
/// </summary>
public class VersionEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public VersionEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting(
                "ConnectionStrings:ClimateTracking",
                "Host=localhost;Database=unused;Username=unused;Password=unused");
            // The JwtBearer handler runs on every request including unauthenticated ones and
            // needs a non-empty signing key; appsettings.json ships TrackingJwtSecret empty.
            builder.UseSetting("TrackingJwtSecret", "test-tracking-secret-at-least-32-bytes-long");
            builder.UseSetting("ProcomerCompanyId", "CO-014");
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            builder.UseSetting("Workers:Enabled", "false");
        });
    }

    [Fact]
    public async Task Version_reports_service_runtime_environment_commit_and_build_time()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/version");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.Equal("climate-tracking-api", root.GetProperty("service").GetString());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("runtime").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("environment").GetString()));

        // The two fields that make deploy drift detectable. Never blank: an absent build stamp
        // is reported as the sentinel "unknown", so emptiness here means the provenance plumbing
        // is broken rather than merely unsupplied.
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("commit").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("builtAt").GetString()));
    }

    [Fact]
    public async Task Version_reports_the_commit_stamped_into_the_api_assembly()
    {
        var client = _factory.CreateClient();

        using var document = JsonDocument.Parse(await client.GetStringAsync("/version"));
        var root = document.RootElement;

        // This is the assertion that actually proves the wiring: whatever the build stamped into
        // the assembly is what the endpoint must report. It holds both for a local build (where
        // the csproj default makes this "unknown") and for the Docker/CI build (where it is a
        // real 40-character SHA), so it does not become a false failure the day
        // deploy-tracking-prod.yml starts passing /p:CommitSha.
        Assert.Equal(ReadApiAssemblyMetadata("CommitSha"), root.GetProperty("commit").GetString());
        Assert.Equal(ReadApiAssemblyMetadata("BuildTimestamp"), root.GetProperty("builtAt").GetString());
    }

    [Fact]
    public async Task Version_reports_a_commit_the_deploy_reader_will_accept_or_the_sentinel()
    {
        // scripts/read-deployed-commit.sh -- what deploy-tracking-prod.yml's "Verify deployed
        // commit matches this run" step calls -- requires ^[0-9a-f]{40}$ and exits 1 on anything
        // else. "unknown" is the one other value it understands, and it treats it as a finding
        // ("an image built outside the CI path is serving traffic"), not a parse error. Any
        // THIRD shape -- a short SHA, a tag, "v1.2.3", a blank -- fails that step for a reason
        // nobody will be able to read off the log. This pins the field to the two the reader
        // knows.
        var client = _factory.CreateClient();

        using var document = JsonDocument.Parse(await client.GetStringAsync("/version"));
        var commit = document.RootElement.GetProperty("commit").GetString();

        Assert.True(
            commit == "unknown" || Regex.IsMatch(commit ?? string.Empty, "^[0-9a-f]{40}$"),
            $"/version reported commit '{commit}', which scripts/read-deployed-commit.sh would " +
            "reject: it accepts a 40-character lowercase hex SHA, and understands only 'unknown' " +
            "as the no-provenance sentinel.");
    }

    [Fact]
    public void Api_assembly_carries_build_provenance_metadata()
    {
        // Asserts the csproj AssemblyMetadata items survive. If someone removes them the
        // endpoint falls back to "unknown" forever and the deployed-commit assertion is quietly
        // dead again -- which is the whole failure mode: a deploy that silently did nothing and a
        // deploy that worked produce byte-identical /version output. Presence, not value: the
        // value legitimately differs between a local and a CI/Docker build.
        Assert.NotNull(ReadApiAssemblyMetadata("CommitSha"));
        Assert.NotNull(ReadApiAssemblyMetadata("BuildTimestamp"));
    }

    private static string? ReadApiAssemblyMetadata(string key) =>
        typeof(Program).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => string.Equals(attribute.Key, key, StringComparison.Ordinal))
            ?.Value;
}
