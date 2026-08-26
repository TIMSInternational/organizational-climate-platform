using System.Globalization;
using System.Net;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace ClimateProject.IntegrationTests.Security;

/// <summary>
/// The rate limiter, exercised through the real pipeline (#146).
///
/// <para>
/// No database is configured beyond a syntactically valid connection string pointed at
/// nothing. Most routes used here never reach one: <c>/health</c>, <c>/version</c> and
/// <c>/</c> are static, an unmatched path has no handler, <c>/api/internal/*</c> is refused by
/// <c>InternalApiKeyFilter</c> without a key, <c>/survey-links/{token}</c> returns 404 from
/// <c>SurveyAccessTokens.HasExpectedShape</c> before it queries, and <c>POST /auth/login</c>
/// with blank credentials returns 400 from the handler's own first guard. <c>/ready</c> and
/// <c>POST /invitations/{token}/accept</c> do try to reach Postgres and answer 503 and 500
/// respectively -- which is why the tests that use them assert on whether the limiter refused
/// the request, not on a domain status. That is what makes it affordable to fire a limit to
/// exhaustion here rather than asserting on route metadata and hoping the middleware is wired
/// up.
/// </para>
/// <para>
/// <b>Callers are told apart by <c>X-Forwarded-For</c>.</b> Under <c>TestServer</c> there is
/// no socket, so <c>Connection.RemoteIpAddress</c> is null for every request and every caller
/// would otherwise share one partition. Setting <c>RateLimiting:TrustedProxyHopCount</c> to 1
/// is what the App Runner deployment does, and it is the only way to prove from a test that a
/// limiter buckets by caller at all -- which is the coverage gap
/// <c>ClientIpResolverTests</c> alone cannot close, since it never puts the resolver behind a
/// limiter.
/// </para>
/// </summary>
[Collection("AppHost")]
public class RateLimitingTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string CallerOne = "203.0.113.1";
    private const string CallerTwo = "203.0.113.2";

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
        => HostWith(null, overrides);

    private WebApplicationFactory<Program> HostWith(
        CapturingLoggerProvider? logs,
        params (string Key, string Value)[] overrides)
        => _root.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused;Timeout=2",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                    // The API co-hosts the scheduled jobs (#275); test hosts run them idle so
                    // nothing ticks against the unused connection string above.
                    ["Scheduling:Enabled"] = "false",
                };

                foreach (var (key, value) in overrides)
                {
                    settings[key] = value;
                }

                config.AddInMemoryCollection(settings);
            });

            if (logs is not null)
            {
                builder.ConfigureLogging(logging => logging.AddProvider(logs));
            }
        });

    /// <summary>A host that tells callers apart, i.e. the production shape. See class remarks.</summary>
    private WebApplicationFactory<Program> HostBehindOneProxy(params (string Key, string Value)[] overrides)
        => HostWith([("RateLimiting:TrustedProxyHopCount", "1"), .. overrides]);

    private static HttpClient ClientOf(WebApplicationFactory<Program> factory)
        // AllowAutoRedirect off so that a request to "/" is observed as the 302 it is, rather
        // than silently becoming a second request to /health and spending a second permit.
        => factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>
    /// One request from a named caller. The header is set per request rather than on the
    /// client so that one test can drive two callers against one host and one limiter.
    /// </summary>
    private static async Task<HttpStatusCode> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string? forwardedFor = null,
        string? json = null)
    {
        using var request = BuildRequest(method, path, forwardedFor, json);
        using var response = await client.SendAsync(request);

        return response.StatusCode;
    }

    private static HttpRequestMessage BuildRequest(
        HttpMethod method,
        string path,
        string? forwardedFor,
        string? json)
    {
        var request = new HttpRequestMessage(method, new Uri(path, UriKind.Relative));
        if (forwardedFor is not null)
        {
            request.Headers.Add(ClientIpResolver.ForwardedForHeaderName, forwardedFor);
        }

        if (json is not null)
        {
            request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        }

        return request;
    }

    /// <summary>
    /// The body that makes <c>POST /auth/login</c> answer 400 out of the handler's own first
    /// guard, before it queries <c>users</c> -- which is what lets the strictest policy in the
    /// app be fired to exhaustion on a host with no database.
    /// </summary>
    private const string EmptyCredentials = """{"email":"","password":""}""";

    // ------------------------------------------------------------------
    // The probe carve-out. Getting this wrong takes production down.
    // ------------------------------------------------------------------

    [Fact]
    public async Task Health_is_never_limited_however_far_past_the_ceiling_it_goes()
    {
        // /health is no longer what App Runner polls (that is /ready, since #221), but it is
        // still the endpoint reached for by anything asking "is the process up" during an
        // incident -- which is precisely when the global ceiling is most likely to be busy.
        // The ceiling is set to 2 here so that twenty requests is emphatically past it.
        var client = ClientOf(HostWith(("RateLimiting:GlobalPermitsPerMinute", "2")));

        for (var i = 0; i < 20; i++)
        {
            Assert.Equal(HttpStatusCode.OK, await SendAsync(client, HttpMethod.Get, "/health"));
        }
    }

    [Fact]
    public async Task Ready_is_never_limited_however_far_past_the_ceiling_it_goes()
    {
        // /ready is App Runner's health-check target (#221), the deploy gate, and how #220 is
        // monitored -- so this is now the carve-out whose loss takes production down, not
        // merely the one that fails a deploy. It is really requested here rather than
        // asserted as set membership. This
        // host has no reachable database, so every answer is the endpoint's own 503 "not
        // ready" branch -- which is the interesting case, because an instance that cannot
        // reach Postgres is exactly when the probe is being polled hardest and must still
        // never be told to back off. Asserting 503 rather than "not 429" also pins what the
        // twenty requests really did: they reached the handler, twenty times, past a ceiling
        // of two.
        var client = ClientOf(HostWith(("RateLimiting:GlobalPermitsPerMinute", "2")));

        for (var i = 0; i < 20; i++)
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, await SendAsync(client, HttpMethod.Get, "/ready"));
        }
    }

    [Theory]
    [InlineData("/version", HttpStatusCode.OK)]
    [InlineData("/", HttpStatusCode.Redirect)]
    public async Task Paths_nothing_probes_are_not_in_the_carve_out_and_take_the_ceiling(
        string path,
        HttpStatusCode expected)
    {
        // /version and / are unauthenticated and cheap, but nothing polls either: the service
        // template's HealthCheckPath is /health, and /ready is the deploy canary. They were in
        // the carve-out on a "probe path" rationale that does not describe them, so they are
        // ordinary routes now. This is the test that fails if they are put back.
        var client = ClientOf(HostWith(("RateLimiting:GlobalPermitsPerMinute", "2")));

        Assert.Equal(expected, await SendAsync(client, HttpMethod.Get, path));
        Assert.Equal(expected, await SendAsync(client, HttpMethod.Get, path));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendAsync(client, HttpMethod.Get, path));
    }

    [Fact]
    public void The_carve_out_holds_only_what_something_outside_the_product_polls()
    {
        Assert.Equal(["/health", "/ready"], RateLimitPolicies.UnlimitedPaths.Order(StringComparer.Ordinal));
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
            statuses.Add(await SendAsync(client, HttpMethod.Get, "/no-such-route"));
        }

        // The permitted requests are answered normally (404 -- there is no such endpoint, and
        // that is the point: the ceiling applies to unmatched paths too), and the rest are
        // refused. Asserting both halves is deliberate: a limiter set absurdly low would
        // satisfy "a 429 appears" while breaking every real caller.
        Assert.Equal(3, statuses.Count(status => status == HttpStatusCode.NotFound));
        Assert.Equal(5, statuses.Count(status => status == HttpStatusCode.TooManyRequests));
    }

    [Fact]
    public void The_shipped_ceilings_are_far_above_any_human_rate()
    {
        // Guards the other side of the test above: the limits the product actually ships with
        // are these, not the deliberately tiny ones the pipeline tests configure.
        Assert.Equal(600, new RateLimitingOptions().GlobalPermitsPerMinute);
        Assert.Equal(3000, new RateLimitingOptions().InternalPermitsPerMinute);
        Assert.Equal(0, new RateLimitingOptions().TrustedProxyHopCount);
        Assert.Equal(TimeSpan.FromMinutes(1), RateLimitPolicies.GlobalWindow);
    }

    // ------------------------------------------------------------------
    // The caller is the forwarded caller, not the socket peer (App Runner)
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_global_ceiling_buckets_by_the_forwarded_caller_not_the_socket_peer()
    {
        // The whole point of ClientIpResolver: behind App Runner every request arrives from
        // the same socket peer, so a limiter keyed on it puts the entire internet in one
        // bucket. Two callers, one host, one limiter: exhausting the first must leave the
        // second untouched.
        var client = ClientOf(HostBehindOneProxy(("RateLimiting:GlobalPermitsPerMinute", "2")));

        Assert.Equal(HttpStatusCode.NotFound, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerOne));
        Assert.Equal(HttpStatusCode.NotFound, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerOne));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerOne));

        Assert.Equal(HttpStatusCode.NotFound, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerTwo));
    }

    [Fact]
    public async Task The_authentication_policy_buckets_by_the_forwarded_caller()
    {
        var client = ClientOf(HostBehindOneProxy());

        for (var i = 0; i < RateLimitPolicies.AuthenticationPermitsPerWindow; i++)
        {
            Assert.Equal(
                HttpStatusCode.BadRequest,
                await SendAsync(client, HttpMethod.Post, "/auth/login", CallerOne, EmptyCredentials));
        }

        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await SendAsync(client, HttpMethod.Post, "/auth/login", CallerOne, EmptyCredentials));
        Assert.Equal(
            HttpStatusCode.BadRequest,
            await SendAsync(client, HttpMethod.Post, "/auth/login", CallerTwo, EmptyCredentials));
    }

    [Fact]
    public void Every_address_keyed_partition_resolves_its_caller_through_ClientIpResolver()
    {
        // The two response-submission policies cannot be fired without a database, so they
        // are asserted on the key they produce instead. Without this, all four partitions
        // could be reverted to Connection.RemoteIpAddress -- undoing the entire App Runner
        // fix -- with every request-driven test in this file still green, because TestServer
        // has no socket peer for the revert to differ from.
        var context = ContextBehindOneProxy(forwardedFor: "203.0.113.7", socketPeer: "198.51.100.9");

        var keys = new[]
        {
            RateLimitPolicies.PartitionGlobal(context).PartitionKey,
            RateLimitPolicies.PartitionPublicLink(context).PartitionKey,
            MicroclimateEndpoints.PartitionResponseSubmission(context).PartitionKey,
            SurveyResponseEndpoints.PartitionResponseSubmission(context).PartitionKey,
        };

        foreach (var key in keys)
        {
            Assert.Contains("203.0.113.7", key, StringComparison.Ordinal);
            Assert.DoesNotContain("198.51.100.9", key, StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// An <see cref="HttpContext"/> shaped like one App Runner delivers: a socket peer that is
    /// the proxy, and the real caller in the last <c>X-Forwarded-For</c> entry.
    /// </summary>
    private static DefaultHttpContext ContextBehindOneProxy(string forwardedFor, string socketPeer)
    {
        var services = new ServiceCollection();
        services.AddSingleton(new ClientIpResolver(trustedProxyHopCount: 1));
        services.AddOptions<RateLimitingOptions>();

        var context = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
        };

        context.Connection.RemoteIpAddress = IPAddress.Parse(socketPeer);
        context.Request.Path = "/surveys/00000000-0000-0000-0000-000000000000/responses";
        context.Request.Headers[ClientIpResolver.ForwardedForHeaderName] = forwardedFor;

        return context;
    }

    // ------------------------------------------------------------------
    // The two token classes, at their shipped limits
    // ------------------------------------------------------------------

    /// <summary>
    /// Every route in the public-token class looks its token up in Postgres as its first act,
    /// so on this database-less host a permitted request answers 500 rather than a domain
    /// status. That is fine for what these two tests assert -- whether the limiter let the
    /// request reach the handler at all -- and is why they read "not 429" rather than a
    /// success code. <c>LoginRateLimitTests</c> is where a limiter is fired against a real
    /// Postgres.
    /// </summary>
    private const string AcceptPath = "/invitations/{0}/accept";

    [Fact]
    public async Task An_invitation_token_is_limited_at_the_shipped_permit_count()
    {
        var client = ClientOf(Shipped);
        var path = string.Format(CultureInfo.InvariantCulture, AcceptPath, "replayed-token-aaaaaaaaaaaa");

        for (var i = 0; i < RateLimitPolicies.PublicTokenPermitsPerWindow; i++)
        {
            Assert.NotEqual(HttpStatusCode.TooManyRequests, await SendAsync(client, HttpMethod.Post, path));
        }

        using var request = BuildRequest(HttpMethod.Post, path, forwardedFor: null, json: null);
        using var refused = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.NotNull(refused.Headers.RetryAfter);
    }

    [Fact]
    public async Task Exhausting_one_invitation_token_does_not_refuse_a_different_one()
    {
        // The bucket is the token, not the caller: both requests below come from the same
        // client. An invitation names one person, so a replay of it must not be able to hide
        // behind a botnet's address pool, and a full bucket can only inconvenience that
        // person.
        var client = ClientOf(Shipped);
        var exhausted = string.Format(CultureInfo.InvariantCulture, AcceptPath, "exhausted-token-aaaaaaaaaaaa");

        for (var i = 0; i <= RateLimitPolicies.PublicTokenPermitsPerWindow; i++)
        {
            await SendAsync(client, HttpMethod.Post, exhausted);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, await SendAsync(client, HttpMethod.Post, exhausted));
        Assert.NotEqual(
            HttpStatusCode.TooManyRequests,
            await SendAsync(
                client,
                HttpMethod.Post,
                string.Format(CultureInfo.InvariantCulture, AcceptPath, "untouched-token-bbbbbbbbbbbb")));
    }

    [Fact]
    public async Task A_share_link_is_bucketed_by_its_caller_and_never_by_its_token()
    {
        // The availability half of #146, and the opposite of the rule above. One survey has
        // ONE share link and every respondent uses it, so a token-keyed bucket would be a
        // bucket shared by a whole company: the 21st employee to open the link in a minute
        // refused, and anyone holding the deliberately public URL able to keep the survey shut
        // for everyone from a single address.
        //
        // Both halves are asserted. Same caller, different token -> still refused (the token
        // is not what is being counted). Different caller, the exhausted token -> served (a
        // flood costs the flooder their own bucket and nobody else's).
        var client = ClientOf(HostBehindOneProxy());
        const string exhausted = "/survey-links/exhausted-link-token-aaaa";

        for (var i = 0; i < RateLimitPolicies.PublicLinkPermitsPerWindow; i++)
        {
            Assert.Equal(HttpStatusCode.NotFound, await SendAsync(client, HttpMethod.Get, exhausted, CallerOne));
        }

        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await SendAsync(client, HttpMethod.Get, exhausted, CallerOne));
        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await SendAsync(client, HttpMethod.Get, "/survey-links/some-other-link-token-bb", CallerOne));
        Assert.Equal(
            HttpStatusCode.NotFound,
            await SendAsync(client, HttpMethod.Get, exhausted, CallerTwo));
    }

    // ------------------------------------------------------------------
    // What a rejection writes to the log
    // ------------------------------------------------------------------

    /// <summary>
    /// The <c>Microsoft.AspNetCore</c> log level <c>appsettings.json</c> ships, restored here
    /// because <c>appsettings.Development.json</c> raises it to Information and
    /// <c>WebApplicationFactory</c> hosts run as Development.
    ///
    /// <para>
    /// It matters, and stating why is the point of pinning it: at Information,
    /// <c>Microsoft.AspNetCore.Hosting.Diagnostics</c> writes "Request starting ... {url}" for
    /// every request, which puts the raw URL -- and therefore any token in it -- into the log
    /// regardless of what this branch's own code does. That is a pre-existing, deliberate
    /// local-debugging setting, not something #146 introduced or can fix from inside a
    /// partition function; what #146 owns is that the limiter's own record is clean, and the
    /// tests below assert that across the whole sink under the level the service actually
    /// deploys with.
    /// </para>
    /// </summary>
    private static readonly (string Key, string Value) ShippedAspNetCoreLogLevel =
        ("Logging:LogLevel:Microsoft.AspNetCore", "Warning");

    [Fact]
    public async Task A_rejection_names_the_route_template_and_never_the_token_in_the_path()
    {
        // The routes in the public-token class carry a bearer credential in their path: an
        // invitation token is exactly what lets its holder answer a survey as that person.
        // A rejection happens when one is being replayed or reloaded, i.e. while it is live,
        // so logging Request.Path would ship valid credentials to CloudWatch -- the same ones
        // SurveyDistributionEndpoints keeps out of notifications rows on purpose.
        //
        // The token below also carries a percent-encoded newline. Request.Path is DECODED, so
        // logging it would let a caller forge a second line inside the very log category #158
        // is told to alert on.
        var logs = new CapturingLoggerProvider();
        var client = ClientOf(HostWith(logs, ShippedAspNetCoreLogLevel));
        const string path = "/invitations/SUPERSECRET-TOKEN%0AINJECTED-LOG-LINE/accept";

        for (var i = 0; i <= RateLimitPolicies.PublicTokenPermitsPerWindow; i++)
        {
            await SendAsync(client, HttpMethod.Post, path);
        }

        var rejections = logs.Records
            .Where(record => record.Category == RateLimitPolicies.RejectionLogCategory)
            .ToArray();

        Assert.NotEmpty(rejections);
        Assert.All(rejections, record => Assert.Equal(LogLevel.Warning, record.Level));
        Assert.Contains(rejections, record => record.Message.Contains("/invitations/{token}/accept", StringComparison.Ordinal));

        // Over every record the host wrote, not just the rejections: a token that reached any
        // sink is a leaked token whichever category it landed in.
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("SUPERSECRET", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("INJECTED", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains('\n', StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_rejection_on_an_unmatched_path_names_no_path_at_all()
    {
        // The unmatched case has no route template to fall back to, and the obvious fallback
        // -- the path the caller asked for -- is attacker-controlled free text. It is a
        // literal instead.
        var logs = new CapturingLoggerProvider();
        var client = ClientOf(HostWith(
            logs,
            ShippedAspNetCoreLogLevel,
            ("RateLimiting:GlobalPermitsPerMinute", "1")));

        await SendAsync(client, HttpMethod.Get, "/no-such-route-CANARY");
        await SendAsync(client, HttpMethod.Get, "/no-such-route-CANARY");

        var rejections = logs.Records
            .Where(record => record.Category == RateLimitPolicies.RejectionLogCategory)
            .ToArray();

        Assert.NotEmpty(rejections);
        Assert.All(rejections, record => Assert.Contains(RateLimitPolicies.UnmatchedRouteName, record.Message, StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("CANARY", StringComparison.Ordinal));
    }

    // ------------------------------------------------------------------
    // The internal service surface
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_internal_surface_has_its_own_bucket_and_its_own_ceiling()
    {
        // /api/internal/* is server-to-server (ClimateTracking.Api and .Workers, through
        // ClimateProjectClient) and is gated by InternalApiKeyFilter rather than a JWT, so
        // there is no "sub" claim for the global ceiling to key on and the whole integration
        // would otherwise share one human-sized address bucket with any browser traffic from
        // the same egress address.
        var client = ClientOf(HostBehindOneProxy(
            ("RateLimiting:GlobalPermitsPerMinute", "1"),
            ("RateLimiting:InternalPermitsPerMinute", "4")));

        for (var i = 0; i < 4; i++)
        {
            Assert.NotEqual(
                HttpStatusCode.TooManyRequests,
                await SendAsync(client, HttpMethod.Get, "/api/internal/nodos?company_id=x", CallerOne));
        }

        Assert.Equal(
            HttpStatusCode.TooManyRequests,
            await SendAsync(client, HttpMethod.Get, "/api/internal/nodos?company_id=x", CallerOne));

        // The same caller's single global permit is untouched by the four requests above --
        // the two buckets are separate, which is the whole point.
        Assert.Equal(HttpStatusCode.NotFound, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerOne));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendAsync(client, HttpMethod.Get, "/no-such-route", CallerOne));
    }

    // ------------------------------------------------------------------
    // Which policy is attached where
    // ------------------------------------------------------------------

    /// <summary>
    /// The policy each unauthenticated route is expected to carry. This is the "is it the
    /// RIGHT policy" half; <see cref="Every_route_reachable_without_a_token_is_in_a_named_class_or_an_explicit_exemption"/>
    /// is the "did anyone add a route and forget" half, and it derives its list from the
    /// endpoint table rather than from this one.
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
        ("/survey-links/{token}", RateLimitPolicies.PublicLink),
        // #139. Same shape as /survey-links/{token} -- one token, many holders -- so the same
        // caller-keyed policy, and for the same reason: keying a shared secret by the secret
        // gives an enumerator a fresh bucket per guess.
        ("/shared/reports/{token}", RateLimitPolicies.PublicLink),
        ("/microclimates/{id:guid}/responses", MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy),
        ("/surveys/{id:guid}/responses", SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy),
        ("/surveys/{id:guid}/respond", SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy),
    ];

    /// <summary>
    /// Routes that answer an unauthenticated caller and deliberately carry no named policy,
    /// with the reason each is here. Anything not in this set and not in
    /// <see cref="UnauthenticatedRoutePolicies"/> fails the derived test below, which is the
    /// direction that catches a route nobody thought about.
    ///
    /// <list type="bullet">
    /// <item><c>/health</c> and <c>/ready</c> are <see cref="RateLimitPolicies.UnlimitedPaths"/>
    /// -- exempt from every limiter, deliberately, because App Runner reads a 429 from them as
    /// an outage.</item>
    /// <item><c>/</c>, <c>/version</c> and the OpenAPI document are cheap static responses that
    /// nothing polls; the global ceiling is the right bound for them and
    /// <see cref="Paths_nothing_probes_are_not_in_the_carve_out_and_take_the_ceiling"/> proves
    /// it applies.</item>
    /// <item><c>GET /microclimates/{id:guid}</c> is anonymous but is the same route an
    /// authenticated admin reads a microclimate through, so an address-keyed policy would
    /// bucket a whole office of admins together. Global ceiling, keyed per user for the
    /// authenticated half.</item>
    /// <item><c>/api/internal/*</c> is not anonymous at all -- <c>InternalApiKeyFilter</c>
    /// gates it -- but it is key-gated rather than JWT-gated, so it has no <c>[Authorize]</c>
    /// metadata to recognise it by. It has its own ceiling inside
    /// <see cref="RateLimitPolicies.PartitionGlobal"/>.</item>
    /// </list>
    /// </summary>
    private static readonly IReadOnlySet<string> RoutesCoveredByTheCeilingAlone =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "/",
            "/health",
            "/ready",
            "/version",
            "/openapi/{documentName}.json",
            "/microclimates/{id:guid}",
            "/api/internal/nodos",
            "/api/internal/personas",
            "/api/internal/ciclos-encuesta",
            "/api/internal/hallazgos",
            "/api/internal/send-notification",
        };

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
        // The firing tests above and in LoginRateLimitTests prove these policies actually
        // reject; this is what stops a route being given the wrong one.
        foreach (var (pattern, policy) in UnauthenticatedRoutePolicies)
        {
            var metadata = EndpointFor(pattern).Metadata.GetMetadata<EnableRateLimitingAttribute>();

            Assert.Equal(policy, metadata?.PolicyName);
        }
    }

    [Fact]
    public void Every_route_reachable_without_a_token_is_in_a_named_class_or_an_explicit_exemption()
    {
        // Derived from EndpointDataSource, not from a list someone maintains: the failure this
        // closes is a NEW anonymous route joining one of the classes above with no policy
        // attached and nothing noticing. A route is reachable without a bearer token when it
        // carries no IAuthorizeData at all, or carries IAllowAnonymous that overrides one.
        var reachableWithoutAToken = Shipped.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint =>
                endpoint.Metadata.GetMetadata<IAuthorizeData>() is null
                || endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .ToArray();

        var unbounded = reachableWithoutAToken
            .Where(endpoint => endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>() is null)
            .Select(endpoint => endpoint.RoutePattern.RawText ?? endpoint.DisplayName ?? "(unnamed)")
            .Where(pattern => !RoutesCoveredByTheCeilingAlone.Contains(pattern))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Empty(unbounded);

        // And the exemption list cannot rot into a list of routes that no longer exist, which
        // is how an exemption list quietly stops constraining anything.
        var live = reachableWithoutAToken
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .ToHashSet(StringComparer.Ordinal);
        var stale = RoutesCoveredByTheCeilingAlone
            .Where(pattern => !live.Contains(pattern))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Empty(stale);
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
