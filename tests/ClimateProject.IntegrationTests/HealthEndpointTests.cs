using System.Net;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        // The JWT bearer handler runs on every request (even unauthenticated ones
        // like /health) to attempt authentication, and needs a non-empty signing
        // key. appsettings.json ships an empty TrackingJwtSecret, so this test
        // (predating auth) needs its own override to avoid a 500.
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                });
            });
        });
    }

    [Fact]
    public async Task Health_endpoint_returns_ok_status()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"ok\"", body);
    }
}
