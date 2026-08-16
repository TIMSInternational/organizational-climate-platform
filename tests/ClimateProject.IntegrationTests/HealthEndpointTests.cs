using System.Net;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

[Collection("AppHost")]
public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        // The JWT bearer handler runs on every request (even unauthenticated ones
        // like /health) to attempt authentication, and needs a non-empty signing
        // key. appsettings.json ships an empty TrackingJwtSecret, so this test
        // (predating auth) needs its own override to avoid a 500.
        //
        // As of #189 the connection string and InternalApiKey are validated at startup too, so
        // they must be present here as well. Worth being explicit about what that means for
        // this class: /health is a static literal that touches no dependency, so before #189
        // these tests proved /health returns "ok" on a host with no database configured. It
        // still does -- /health is not a readiness probe and does not pretend to be -- but the
        // host now at least refuses to start without a connection string.
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                    // The API co-hosts the scheduled jobs (#275); test hosts run them idle so
                    // nothing ticks against the unused connection string above.
                    ["Scheduling:Enabled"] = "false",
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
