using System.Net;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Security;

/// <summary>
/// The rate limiter, exercised through the real pipeline (#146).
///
/// <para>
/// No database is configured beyond a syntactically valid connection string: every route
/// used here either touches no database at all (<c>/health</c>, <c>/version</c>, an unmatched
/// path) or rejects its input before the first query (<c>/survey-links/{token}</c> with a
/// token that fails <c>SurveyAccessTokens.HasExpectedShape</c>). That is what makes it
/// affordable to fire a limit to exhaustion here rather than asserting on route metadata and
/// hoping the middleware is wired up.
/// </para>
/// </summary>
[Collection("AppHost")]
public class RateLimitingTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _root;

    /// <summary>
    /// A host on the shipped configuration, built on first use. Lazy because a host boot is
    /// the expensive thing in this class and the tests that override configuration build
    /// their own; xUnit constructs this class once per test case, so each test still gets its
    /// own host and therefore its own limiter state.
    /// </summary>
    private WebApplicationFactory<Program> Shipped => _shippedHost ??= HostWith();

    private WebApplicationFactory<Program>? _shippedHost;

    public RateLimitingTests(WebApplicationFactory<Program> factory) => _root = factory;

    /// <summary>
    /// A host with the minimum configuration Program.cs validates at startup, plus whatever
    /// this test wants to change. The connection string is present but unused -- see the
    /// class remarks.
    /// </summary>
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

    private static HttpClient ClientOf(WebApplicationFactory<Program> factory)
        // AllowAutoRedirect off so that a request to "/" is observed as the 302 it is, rather
        // than silently becoming a second request to /health and spending a second permit.
        => factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    // ------------------------------------------------------------------
    // The probe carve-out. Getting this wrong takes production down.
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("/health", HttpStatusCode.OK)]
    [InlineData("/version", HttpStatusCode.OK)]
    [InlineData("/", HttpStatusCode.Redirect)]
    public async Task Probe_paths_are_never_limited_however_far_past_the_ceiling_they_go(
        string path,
        HttpStatusCode expected)
    {
        // App Runner polls /health every 10 seconds (HealthCheckConfiguration in the service
        // template) and /ready is how #220 is monitored. A 429 to either reads as an
        // unhealthy instance and tears the service down. The ceiling is set to 2 here so that
        // twenty requests is emphatically past it.
        var factory = HostWith(("RateLimiting:GlobalPermitsPerMinute", "2"));
        var client = ClientOf(factory);

        for (var i = 0; i < 20; i++)
        {
            var response = await client.GetAsync(new Uri(path, UriKind.Relative));
            Assert.Equal(expected, response.StatusCode);
        }
    }

    [Fact]
    public void Ready_is_in_the_carve_out_set_alongside_the_other_probes()
    {
        // /ready is not requested here -- it opens a Postgres connection, and this host has
        // none. What is asserted is the membership that the middleware consults, which is the
        // whole of the carve-out decision; the three paths above prove the consultation
        // itself happens.
        Assert.Contains("/ready", RateLimitPolicies.UnlimitedPaths);
        Assert.True(RateLimitPolicies.IsUnlimitedPath(new PathString("/ready")));
        Assert.False(RateLimitPolicies.IsUnlimitedPath(new PathString("/auth/login")));
    }

    // ------------------------------------------------------------------
    // The coarse ceiling
    // ------------------------------------------------------------------

    [Fact]
    public async Task Traffic_outside_the_carve_out_is_capped_by_the_global_ceiling()
    {
        var factory = HostWith(("RateLimiting:GlobalPermitsPerMinute", "3"));
        var client = ClientOf(factory);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 8; i++)
        {
            statuses.Add((await client.GetAsync(new Uri("/no-such-route", UriKind.Relative))).StatusCode);
        }

        // The permitted requests are answered normally (404 -- there is no such endpoint, and
        // that is the point: the ceiling applies to unmatched paths too), and the rest are
        // refused. Asserting both halves is deliberate: a limiter set absurdly low would
        // satisfy "a 429 appears" while breaking every real caller.
        Assert.Equal(3, statuses.Count(status => status == HttpStatusCode.NotFound));
        Assert.Equal(5, statuses.Count(status => status == HttpStatusCode.TooManyRequests));
    }

    [Fact]
    public void The_shipped_global_ceiling_is_far_above_any_human_rate()
    {
        // Guards the other side of the test above: the limits the product actually ships with
        // are these, not the deliberately tiny ones the pipeline tests configure.
        Assert.Equal(600, new RateLimitingOptions().GlobalPermitsPerMinute);
        Assert.Equal(0, new RateLimitingOptions().TrustedProxyHopCount);
        Assert.Equal(TimeSpan.FromMinutes(1), RateLimitPolicies.GlobalWindow);
    }

    // ------------------------------------------------------------------
    // The public-token class, at its shipped limit
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_public_link_token_is_limited_at_the_shipped_permit_count()
    {
        var factory = Shipped;
        var client = ClientOf(factory);
        var token = "this-token-has-the-wrong-shape";

        for (var i = 0; i < RateLimitPolicies.PublicTokenPermitsPerWindow; i++)
        {
            var permitted = await client.GetAsync(new Uri($"/survey-links/{token}", UriKind.Relative));
            Assert.Equal(HttpStatusCode.NotFound, permitted.StatusCode);
        }

        var refused = await client.GetAsync(new Uri($"/survey-links/{token}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.NotNull(refused.Headers.RetryAfter);
    }

    [Fact]
    public async Task Exhausting_one_token_does_not_refuse_a_different_token()
    {
        // The bucket is the token, not the caller: both requests below come from the same
        // client. If the partition were caller-keyed, one replayed invitation would take the
        // whole surface down for everyone; if it were a single shared bucket, so would any
        // single visitor.
        var factory = Shipped;
        var client = ClientOf(factory);

        for (var i = 0; i <= RateLimitPolicies.PublicTokenPermitsPerWindow; i++)
        {
            await client.GetAsync(new Uri("/survey-links/exhausted-token-aaaaaaaaaaaa", UriKind.Relative));
        }

        var other = await client.GetAsync(new Uri("/survey-links/untouched-token-bbbbbbbbbbbb", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, other.StatusCode);
    }

    // ------------------------------------------------------------------
    // Which policy is attached where
    // ------------------------------------------------------------------

    /// <summary>
    /// Every route in the app that answers a caller holding no bearer token, enumerated from
    /// <c>MapGroup</c>/<c>AllowAnonymous</c> in <c>src/ClimateProject.Api/Endpoints</c> rather
    /// than from the issue's list, together with the policy its class requires.
    ///
    /// <para>
    /// Two anonymous routes are deliberately absent and their absence is asserted below:
    /// <c>GET /microclimates/{id:guid}</c>, which is the same route an authenticated admin
    /// reads a microclimate through and so must not be bucketed by address, and the
    /// <c>/api/internal/*</c> group, which is not anonymous at all -- it is gated by
    /// <c>InternalApiKeyFilter</c>. Both are covered by the global ceiling.
    /// </para>
    /// </summary>
    private static readonly (string Pattern, string Policy)[] UnauthenticatedRoutePolicies =
    [
        ("/auth/login", RateLimitPolicies.Authentication),
        ("/auth/signup", RateLimitPolicies.Authentication),
        ("/auth/google", RateLimitPolicies.Authentication),
        ("/invitations/{token}/accept", RateLimitPolicies.PublicToken),
        ("/survey-invitations/{token}", RateLimitPolicies.PublicToken),
        ("/survey-invitations/{token}/opened", RateLimitPolicies.PublicToken),
        ("/survey-invitations/{token}/started", RateLimitPolicies.PublicToken),
        ("/survey-invitations/{token}/completed", RateLimitPolicies.PublicToken),
        ("/survey-links/{token}", RateLimitPolicies.PublicToken),
        ("/microclimates/{id:guid}/responses", MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy),
        ("/surveys/{id:guid}/responses", SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy),
        ("/surveys/{id:guid}/respond", SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy),
    ];

    private RouteEndpoint EndpointFor(string pattern)
        => Shipped.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == pattern);

    [Fact]
    public void Every_unauthenticated_route_carries_the_policy_for_its_class()
    {
        // One [Fact] over the table rather than one [InlineData] per row: each xUnit test
        // case constructs this class, and constructing it boots an application host.
        // The firing tests above and in LoginRateLimitTests prove two of these policies
        // actually reject; this is what stops a route joining one of those classes without a
        // policy attached.
        foreach (var (pattern, policy) in UnauthenticatedRoutePolicies)
        {
            var metadata = EndpointFor(pattern).Metadata.GetMetadata<EnableRateLimitingAttribute>();

            Assert.Equal(policy, metadata?.PolicyName);
        }
    }

    [Fact]
    public void No_probe_route_carries_a_rate_limiting_policy()
    {
        foreach (var pattern in RateLimitPolicies.UnlimitedPaths)
        {
            Assert.Null(EndpointFor(pattern).Metadata.GetMetadata<EnableRateLimitingAttribute>());
        }
    }
}
