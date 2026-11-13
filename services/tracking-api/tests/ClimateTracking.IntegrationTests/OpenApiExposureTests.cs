using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ClimateTracking.IntegrationTests;

/// <summary>
/// The OpenAPI description is served in Development and nowhere else (G25, 2026-10-22).
///
/// <para>
/// It used to be mapped unconditionally, so a deployed host answered an anonymous
/// <c>GET /openapi/v1.json</c> with the shape of every route and DTO in the service. Both
/// halves are asserted: the deployed environments refuse it, and Development still serves it --
/// otherwise "never map it" would pass the first half and take a developer tool away.
/// </para>
///
/// <para>
/// No database, the same way <see cref="VersionEndpointTests"/> runs: the connection string is
/// never dialled and the jobs are idle.
/// </para>
/// </summary>
public class OpenApiExposureTests
{
    private const string Document = "/openapi/v1.json";

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task A_deployed_environment_does_not_serve_the_api_description(string environment)
    {
        using var factory = FactoryIn(environment);
        var client = factory.CreateClient();

        var response = await client.GetAsync(Document);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Development_still_serves_the_api_description()
    {
        using var factory = FactoryIn("Development");
        var client = factory.CreateClient();

        var response = await client.GetAsync(Document);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"openapi\"", await response.Content.ReadAsStringAsync());
    }

    private static WebApplicationFactory<Program> FactoryIn(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting(
                "ConnectionStrings:ClimateTracking",
                "Host=localhost;Database=unused;Username=unused;Password=unused");
            builder.UseSetting("TrackingJwtSecret", "test-tracking-secret-at-least-32-bytes-long");
            builder.UseSetting("ProcomerCompanyId", "CO-014");
            builder.UseSetting("ClimateProjectBaseUrl", "http://climate-project.test");
            builder.UseSetting("ClimateProjectInternalApiKey", "test-internal-key");
            builder.UseSetting("Workers:Enabled", "false");
        });
}
