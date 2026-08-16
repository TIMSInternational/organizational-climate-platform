using System.Net;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

[Collection("AppHost")]
public class CorsPolicyTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CorsPolicyTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    // As of #189 the connection string and InternalApiKey are validated at
                    // startup, so this host no longer boots without them. That this class
                    // previously proved CORS worked on a host with *no database configured at
                    // all* is the hole #189 closed; these tests still need no database, only a
                    // syntactically present connection string.
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                    ["Cors:AllowedOrigins:0"] = "https://allowed.example.com",
                    // The API co-hosts the scheduled jobs (#275); test hosts run them idle so
                    // nothing ticks against the unused connection string above.
                    ["Scheduling:Enabled"] = "false",
                });
            });
        });
    }

    [Fact]
    public async Task Allowed_origin_receives_access_control_allow_origin_header()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://allowed.example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values));
        Assert.Equal("https://allowed.example.com", values!.Single());
    }

    [Fact]
    public async Task Disallowed_origin_does_not_receive_access_control_allow_origin_header()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://not-allowed.example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
