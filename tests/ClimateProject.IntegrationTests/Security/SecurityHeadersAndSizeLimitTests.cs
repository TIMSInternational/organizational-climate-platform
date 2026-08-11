using System.Net;
using System.Net.Http.Headers;
using ClimateProject.Api.Infrastructure;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests.Security;

/// <summary>
/// Security response headers and the request-body ceiling (#146), through the real pipeline.
///
/// <para>
/// No database is used: the oversized-body tests are answered by the size middleware, which
/// runs before authentication, and the not-oversized control cases stop at the 401 the
/// authorization middleware produces. That is what makes the exemption test meaningful --
/// 401 rather than 413 is the observable difference between "exempt" and "not exempt".
/// </para>
/// </summary>
[Collection("AppHost")]
public class SecurityHeadersAndSizeLimitTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const int TestBodyLimitBytes = 1024;

    private readonly WebApplicationFactory<Program> _root;

    public SecurityHeadersAndSizeLimitTests(WebApplicationFactory<Program> factory) => _root = factory;

    private WebApplicationFactory<Program> HostWith(params (string Key, string Value)[] overrides)
        => _root.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
        {
            var settings = new Dictionary<string, string?>
            {
                ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
            };

            foreach (var (key, value) in overrides)
            {
                settings[key] = value;
            }

            config.AddInMemoryCollection(settings);
        }));

    // ------------------------------------------------------------------
    // Headers
    // ------------------------------------------------------------------

    [Fact]
    public async Task Every_response_carries_the_security_headers()
    {
        // One [Fact] over the four rather than one [InlineData] each: every xUnit test case
        // constructs this class, and this class boots an application host to do anything.
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["X-Content-Type-Options"] = "nosniff",
            ["Referrer-Policy"] = "no-referrer",
            ["X-Frame-Options"] = "DENY",
            ["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        };

        var client = HostWith().CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        foreach (var (header, value) in expected)
        {
            Assert.True(response.Headers.TryGetValues(header, out var values), $"missing {header}");
            Assert.Equal(value, values!.Single());
        }
    }

    [Fact]
    public async Task Hsts_is_absent_unless_the_deployment_asks_for_it()
    {
        // Deliberate: emitting HSTS from a deployment that is reachable over plain HTTP would
        // lock clients out of it. See SecurityOptions.EnableHsts for why this is a switch and
        // not derived from Request.IsHttps.
        var client = HostWith().CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.False(response.Headers.Contains("Strict-Transport-Security"));
    }

    [Fact]
    public async Task Hsts_is_emitted_when_the_deployment_enables_it()
    {
        var client = HostWith(("Security:EnableHsts", "true"), ("Security:HstsMaxAgeSeconds", "31536000"))
            .CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.True(response.Headers.TryGetValues("Strict-Transport-Security", out var values));
        Assert.Equal("max-age=31536000; includeSubDomains", values!.Single());
    }

    // ------------------------------------------------------------------
    // Request body ceiling
    // ------------------------------------------------------------------

    private static HttpContent BodyOf(int bytes)
    {
        var content = new ByteArrayContent(new byte[bytes]);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return content;
    }

    [Fact]
    public async Task An_oversized_body_is_refused_before_authentication_or_the_database()
    {
        var client = HostWith(("Security:MaxRequestBodyBytes", TestBodyLimitBytes.ToString())).CreateClient();

        var response = await client.PostAsync(
            new Uri("/admin/companies", UriKind.Relative),
            BodyOf(TestBodyLimitBytes + 1));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task A_body_within_the_ceiling_reaches_the_rest_of_the_pipeline()
    {
        // The control for the test above, on the same route and one byte the other side of
        // the ceiling. 401 is the authorization middleware, which sits *after* the size
        // middleware -- so this is evidence the request got through rather than evidence the
        // middleware is absent.
        var client = HostWith(("Security:MaxRequestBodyBytes", TestBodyLimitBytes.ToString())).CreateClient();

        var response = await client.PostAsync(
            new Uri("/admin/companies", UriKind.Relative),
            BodyOf(TestBodyLimitBytes - 1));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task The_bulk_import_upload_route_is_exempt_from_the_default_ceiling()
    {
        // Same oversized body as the refused case above, on the one route that carries
        // LargeRequestBodyMetadata. 401 rather than 413 is the whole assertion: the request
        // got past the size middleware and was stopped by authorization instead.
        var client = HostWith(
                ("Security:MaxRequestBodyBytes", TestBodyLimitBytes.ToString()),
                ("Security:MaxUploadBodyBytes", (TestBodyLimitBytes * 16).ToString()))
            .CreateClient();

        var response = await client.PostAsync(
            new Uri("/admin/users/bulk-import", UriKind.Relative),
            BodyOf(TestBodyLimitBytes + 1));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_body_over_the_upload_ceiling_is_refused_even_on_the_exempt_route()
    {
        var client = HostWith(
                ("Security:MaxRequestBodyBytes", TestBodyLimitBytes.ToString()),
                ("Security:MaxUploadBodyBytes", (TestBodyLimitBytes * 2).ToString()))
            .CreateClient();

        var response = await client.PostAsync(
            new Uri("/admin/users/bulk-import", UriKind.Relative),
            BodyOf((TestBodyLimitBytes * 2) + 1));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public void The_shipped_ceilings_are_the_ones_documented_on_the_options_type()
    {
        // Guards the other side of the tests above, which all run at a 1 KiB ceiling: the
        // product ships 4 MiB by default and 32 MiB for the upload route.
        var options = new SecurityOptions();

        Assert.Equal(4L * 1024 * 1024, options.MaxRequestBodyBytes);
        Assert.Equal(32L * 1024 * 1024, options.MaxUploadBodyBytes);
        Assert.False(options.EnableHsts);
    }
}
