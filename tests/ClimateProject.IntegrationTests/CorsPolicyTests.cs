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
                    ["Cors:AllowedOrigins:0"] = "https://allowed.example.com",
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
