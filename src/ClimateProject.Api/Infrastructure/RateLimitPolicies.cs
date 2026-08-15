using System.Globalization;
using System.Threading.RateLimiting;
using ClimateProject.Api.Endpoints;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Settings for the rate limiter. Bound from the <c>RateLimiting</c> configuration section.
///
/// <para>
/// The permit ceilings below default to the shipped production values, so an unconfigured
/// deployment is limited rather than unlimited. <see cref="TrustedProxyHopCount"/> is the
/// exception and deliberately so: it defaults to 0 (trust no header) and production
/// overrides it to 1 in <c>infra/aws/climate-project-api-prod-service.yml</c>, because the
/// right value is a property of the host's network position and not of the product.
/// </para>
/// </summary>
public sealed class RateLimitingOptions
{
    /// <summary>
    /// Passed to <see cref="ClientIpResolver.TrustedProxyHopCount"/>. Default 0 -- no header
    /// is trusted -- so local development, CI and the integration suite behave exactly as
    /// they did before #146. Deployments that sit behind a proxy set it; see the App Runner
    /// service template.
    /// </summary>
    public int TrustedProxyHopCount { get; set; }

    /// <summary>
    /// The coarse ceiling applied per caller to every request except the probe paths and the
    /// internal service surface. It is deliberately far above any human's traffic: its job is
    /// to bound a flood, not to shape normal use, and the per-class policies below it are what
    /// actually defend the sensitive surfaces. Configurable so that a test can prove the
    /// limiter fires without issuing six hundred requests.
    /// </summary>
    public int GlobalPermitsPerMinute { get; set; } = RateLimitPolicies.DefaultGlobalPermitsPerMinute;

    /// <summary>
    /// The ceiling for <c>/api/internal/*</c>, per caller, instead of
    /// <see cref="GlobalPermitsPerMinute"/>.
    ///
    /// <para>
    /// That surface is server-to-server: <c>ClimateTracking.Api</c> and
    /// <c>ClimateTracking.Workers</c> both reach it through <c>ClimateProjectClient</c>, from
    /// a small number of egress addresses, so the whole tracking integration would otherwise
    /// land in one human-sized bucket and a worker sweep would refuse the interactive service
    /// sharing its address. What the sweep actually costs at scale has not been measured
    /// against production, which is why this is a configuration value with a generous default
    /// rather than a constant.
    /// </para>
    /// </summary>
    public int InternalPermitsPerMinute { get; set; } = RateLimitPolicies.DefaultInternalPermitsPerMinute;
}

/// <summary>
/// The rate-limiting policy set (#146), and the one place that says which endpoint class
/// gets which limit.
///
/// <para>
/// <b>The classes, and why they are not one global limit.</b> Authentication is the only
/// surface where a few requests per minute is already suspicious, so it gets the tightest
/// bucket. Public submission keeps the two per-surface policies that already existed.
/// </para>
/// <para>
/// <b>Token-addressed routes split in two, and the split is the whole of the design.</b>
/// <see cref="PublicToken"/> buckets by the token, which is right when one token names one
/// person -- an invitation. Replaying that token is the attack, and a caller-keyed bucket
/// would let a botnet spread the replay across enough addresses that it never fires; the
/// only person a full bucket can inconvenience is the one invitee. <see cref="PublicLink"/>
/// buckets by the caller, which is right when one token is handed to everybody -- the survey
/// share link. Bucketing THAT by the token points the limiter at the wrong thing: every
/// recipient of one company's link would compete for one bucket, so a company mailing its
/// staff would refuse its own respondents, and anyone holding the deliberately-public URL
/// could hold the survey closed for the whole company from a single address. The token is
/// not a secret worth defending there -- it is the address of a public page.
/// </para>
/// <para>
/// Underneath all of them, and in addition to them, every request outside
/// <see cref="UnlimitedPaths"/> also passes a coarse ceiling,
/// <see cref="RateLimitingOptions.GlobalPermitsPerMinute"/> -- keyed by user id once the
/// caller is authenticated, so a shared office address cannot make colleagues compete for one
/// bucket, and one compromised account cannot saturate the service for its tenant. That is
/// the class the ordinary authenticated API falls into, and it is why routes with no policy
/// of their own are still bounded. <c>/api/internal/*</c> is the one surface that takes a
/// different ceiling there (<see cref="RateLimitingOptions.InternalPermitsPerMinute"/>,
/// keyed by address, because it is machine traffic with no JWT); see
/// <see cref="PartitionGlobal"/>.
/// </para>
/// <para>
/// <b>The probe carve-out is load-bearing, and holds only what needs it.</b> <c>/ready</c>
/// is what App Runner's own health check polls (<c>HealthCheckConfiguration.Path</c> in the
/// service template, every 20 seconds since #221) as well as being the deploy gate and the
/// #220 monitor; <c>/health</c> is the liveness endpoint a human reaches for. A 429 to the
/// polled one reads to App Runner as an unhealthy instance and would tear the service down
/// -- a rate limiter that causes the outage it was added to prevent. Both are
/// <see cref="UnlimitedPaths"/> and nothing else is: <c>/version</c> and <c>/</c> are cheap
/// and unauthenticated, and although the deploy and the daily drift check do read
/// <c>/version</c>, they read it once each, so it takes the ordinary ceiling like any other
/// route. <c>RateLimitingTests</c> proves both halves.
/// </para>
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// <c>POST /auth/login</c>, <c>POST /auth/signup</c>, <c>POST /auth/google</c>.
    ///
    /// <para>
    /// <b>What this is not.</b> It is a rate limit, not an account lockout. It bounds how
    /// fast one caller can guess; it does nothing about a botnet trying one password against
    /// ten thousand accounts from ten thousand addresses, because that is a per-ACCOUNT
    /// counter and a per-account counter has to survive a process restart and be shared
    /// between App Runner instances to mean anything. This service has nowhere to put such
    /// state -- there is no cache tier, and a column for it would be a schema change. An
    /// in-process counter was considered and rejected: it would be per-instance, would reset
    /// on every deploy, and would hand an attacker a way to lock a known user out on demand.
    /// #146 leaves that to a follow-up that can decide where the state lives.
    /// </para>
    /// </summary>
    public const string Authentication = "authentication";

    /// <summary>
    /// The unauthenticated routes where one token names one person: invitation acceptance and
    /// the survey invitation state routes. Bucketed by the token. Not the share link -- see
    /// <see cref="PublicLink"/> and the class remarks.
    /// </summary>
    public const string PublicToken = "public-token";

    /// <summary>
    /// <c>GET /survey-links/{token}</c>: one token, held by everyone the survey was sent to.
    /// Bucketed by the caller, because bucketing a shared secret by the secret makes every
    /// holder of it compete for one bucket. See the class remarks.
    /// </summary>
    public const string PublicLink = "public-link";

    /// <summary>Requests per window per caller on <see cref="Authentication"/>.</summary>
    public const int AuthenticationPermitsPerWindow = 20;

    /// <summary>Requests per window per token on <see cref="PublicToken"/>.</summary>
    public const int PublicTokenPermitsPerWindow = 20;

    /// <summary>
    /// Requests per window per caller on <see cref="PublicLink"/>: two a second, sustained.
    ///
    /// <para>
    /// A respondent opens a share link once, so this only ever binds where many people share
    /// one egress address -- an office behind a NAT would have to produce more than two opens
    /// a second for a full minute to see a 429. What it bounds is what a single address can
    /// make the route's <c>SELECT</c> on <c>survey_distributions.public_url</c> cost, and a
    /// flood costs the flooder their own bucket and no one else's. If a genuinely large
    /// single-address site ever does hit this, raise the number; do not go back to keying on
    /// the token, which is the failure this replaced.
    /// </para>
    /// </summary>
    public const int PublicLinkPermitsPerWindow = 120;

    /// <summary>Default for <see cref="RateLimitingOptions.GlobalPermitsPerMinute"/>.</summary>
    public const int DefaultGlobalPermitsPerMinute = 600;

    /// <summary>Default for <see cref="RateLimitingOptions.InternalPermitsPerMinute"/>.</summary>
    public const int DefaultInternalPermitsPerMinute = 3000;

    public static readonly TimeSpan AuthenticationWindow = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan PublicTokenWindow = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan PublicLinkWindow = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan GlobalWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Paths that are never rate limited, at any layer, because something outside the product
    /// polls them and reads a 429 as an outage: <c>/ready</c> is App Runner's own health check
    /// target (#221), the deploy gate and the #220 monitor, and <c>/health</c> is the liveness
    /// endpoint. Both are unauthenticated on purpose and neither touches user-supplied input
    /// -- <c>/health</c> is a static literal and <c>/ready</c> issues one <c>SELECT 1</c>.
    /// Removing <c>/ready</c> because it is "only" the deploy gate is the specific mistake to
    /// avoid: since #221 it is the polled one, and a 429 there gets instances replaced.
    /// Nothing else belongs here; see the class remarks for why <c>/</c> and <c>/version</c>
    /// were removed.
    /// </summary>
    public static readonly IReadOnlySet<string> UnlimitedPaths =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "/health", "/ready" };

    /// <summary>
    /// The log category the rejection warnings are written under, so #158 has a name to
    /// alert on rather than a substring of a message.
    /// </summary>
    public const string RejectionLogCategory = "ClimateProject.Api.RateLimiting";

    public static void AddClimateProjectRateLimiting(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddOptions<RateLimitingOptions>()
            .Configure<IConfiguration>((options, configuration) => configuration.GetSection("RateLimiting").Bind(options))
            .Validate(
                options => options.TrustedProxyHopCount >= 0
                    && options.GlobalPermitsPerMinute > 0
                    && options.InternalPermitsPerMinute > 0,
                "RateLimiting:TrustedProxyHopCount must be >= 0, and RateLimiting:GlobalPermitsPerMinute "
                + "and RateLimiting:InternalPermitsPerMinute must be > 0.")
            .ValidateOnStart();

        // Singleton because the resolver is stateless and its hop count is fixed for the
        // life of the process; the partition callbacks below pull it out of RequestServices.
        services.AddSingleton(sp => new ClientIpResolver(
            sp.GetRequiredService<IOptions<RateLimitingOptions>>().Value.TrustedProxyHopCount));

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(PartitionGlobal);

            // The two policies that predate #146. Their limits and their reasons still live
            // beside the endpoints they defend; what changed is that the partition key now
            // comes from ClientIpResolver instead of the raw socket peer.
            options.AddPolicy(
                MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy,
                MicroclimateEndpoints.PartitionResponseSubmission);

            options.AddPolicy(
                SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy,
                SurveyResponseEndpoints.PartitionResponseSubmission);

            options.AddPolicy(Authentication, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: "auth:" + ClientIpFor(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = AuthenticationPermitsPerWindow,
                        Window = AuthenticationWindow,
                        QueueLimit = 0,
                    }));

            options.AddPolicy(PublicToken, PartitionPublicToken);

            options.AddPolicy(PublicLink, PartitionPublicLink);

            options.OnRejected = OnRejectedAsync;
        });
    }

    /// <summary>
    /// The coarse ceiling: per authenticated user when there is one, per caller address when
    /// there is not, and no limiter at all on <see cref="UnlimitedPaths"/>.
    ///
    /// <para>
    /// Keying an authenticated request by user id rather than by address is what makes the
    /// ceiling usable behind a shared office NAT, where every employee presents the same
    /// address. It is safe to read <c>HttpContext.User</c> here because
    /// <c>UseRateLimiter</c> is registered after <c>UseAuthentication</c> in Program.cs.
    /// </para>
    /// <para>
    /// <c>/api/internal/*</c> gets its own key and its own ceiling
    /// (<see cref="RateLimitingOptions.InternalPermitsPerMinute"/>). It is gated by
    /// <see cref="InternalApiKeyFilter"/> and not by a JWT, so there is no <c>sub</c> claim to
    /// key on and it would otherwise fall into the address bucket -- one bucket for the whole
    /// tracking integration, shared with any browser traffic from the same address. Keying on
    /// the path rather than on a validated key is deliberate and has a cost worth stating: a
    /// caller with no key reaches the more generous bucket too. What it buys them is a higher
    /// rate of 401s from a filter that does a constant-time string compare and no I/O, and
    /// their address is still a partition of its own.
    /// </para>
    /// </summary>
    internal static RateLimitPartition<string> PartitionGlobal(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (IsUnlimitedPath(httpContext.Request.Path))
        {
            return RateLimitPartition.GetNoLimiter("probe");
        }

        var options = httpContext.RequestServices
            .GetRequiredService<IOptions<RateLimitingOptions>>().Value;

        if (httpContext.Request.Path.StartsWithSegments(
                TrackingInternalEndpoints.GroupPrefix,
                StringComparison.OrdinalIgnoreCase))
        {
            return FixedWindow(
                "internal:" + ClientIpFor(httpContext),
                options.InternalPermitsPerMinute,
                GlobalWindow);
        }

        // "sub" rather than ClaimTypes.NameIdentifier: JwtBearerOptions sets
        // MapInboundClaims = false in Program.cs, so the raw claim name is what is present.
        var subject = httpContext.User.FindFirst("sub")?.Value;
        var key = string.IsNullOrEmpty(subject)
            ? "ip:" + ClientIpFor(httpContext)
            : "user:" + subject;

        return FixedWindow(key, options.GlobalPermitsPerMinute, GlobalWindow);
    }

    /// <summary>
    /// Partitions an invitation route by its <c>{token}</c> route value, so one invitation
    /// cannot be replayed thousands of times regardless of how many addresses the replays
    /// come from. A request that somehow carries no token falls back to the caller's address
    /// rather than sharing a single bucket with every other caller.
    ///
    /// <para>
    /// Only for tokens that name one person. The share link is one token for a whole company
    /// and is partitioned by <see cref="PartitionPublicLink"/> instead; keying it here would
    /// let any holder of the public URL refuse every other holder.
    /// </para>
    /// <para>
    /// The token itself is the partition key. It stays in memory and is never logged:
    /// <see cref="OnRejectedAsync"/> logs the route pattern (<c>/survey-invitations/{token}</c>,
    /// with the placeholder unexpanded) and the caller address, never
    /// <c>HttpContext.Request.Path</c>, because a survey invitation token is a bearer
    /// credential and a rejection here happens precisely when a live one is in flight.
    /// </para>
    /// </summary>
    internal static RateLimitPartition<string> PartitionPublicToken(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        var token = httpContext.Request.RouteValues.TryGetValue("token", out var routeValue)
            ? routeValue as string
            : null;

        var key = string.IsNullOrEmpty(token)
            ? "public-token:ip:" + ClientIpFor(httpContext)
            : "public-token:" + token;

        return FixedWindow(key, PublicTokenPermitsPerWindow, PublicTokenWindow);
    }

    /// <summary>
    /// Partitions the public share link by caller, not by the token in its path.
    ///
    /// <para>
    /// One <c>survey_distributions</c> row holds one <c>PublicUrl</c> per survey and the web
    /// app's share panel exists to hand that single URL to every respondent, so the token is a
    /// public address rather than a per-caller credential. A token-keyed bucket would make one
    /// company's respondents compete with each other -- the twenty-first person to open the
    /// link in a minute refused -- and would hand anyone holding the URL a way to keep the
    /// survey closed for that company from one address. Per caller, a flood costs the flooder
    /// their own bucket and nobody else's.
    /// </para>
    /// </summary>
    internal static RateLimitPartition<string> PartitionPublicLink(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return FixedWindow(
            "public-link:" + ClientIpFor(httpContext),
            PublicLinkPermitsPerWindow,
            PublicLinkWindow);
    }

    private static RateLimitPartition<string> FixedWindow(string key, int permitLimit, TimeSpan window)
        => RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: key,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
            });

    internal static bool IsUnlimitedPath(PathString path)
        => path.HasValue && UnlimitedPaths.Contains(path.Value!);

    /// <summary>
    /// Resolves the caller address through <see cref="ClientIpResolver"/>. Shared by every
    /// address-keyed partition in the app so that the App Runner proxy problem described on
    /// that type is fixed in one place rather than four.
    /// </summary>
    public static string ClientIpFor(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return httpContext.RequestServices.GetRequiredService<ClientIpResolver>().Resolve(httpContext);
    }

    /// <summary>
    /// Value logged in place of a route when the request matched no endpoint. A literal, so
    /// that the unmatched case cannot smuggle the caller's path into the record either.
    /// </summary>
    internal const string UnmatchedRouteName = "(unmatched)";

    /// <summary>
    /// The route template a rejection is reported under: <c>/survey-links/{token}</c>, with
    /// the placeholder left unexpanded, rather than <c>HttpContext.Request.Path</c>.
    ///
    /// <para>
    /// <b>This is a security control, not tidiness.</b> Every route in the
    /// <see cref="PublicToken"/> class carries a bearer credential in its path -- an
    /// invitation token is exactly what lets its holder answer a survey as that person, and
    /// <c>SurveyDistributionEndpoints</c> keeps those tokens out of <c>notifications</c> rows
    /// so that a CompanyAdmin reading notifications cannot harvest them. Logging the path
    /// would put live ones into CloudWatch, and would do it at the worst moment: the limiter
    /// rejects precisely when a token is being replayed or reloaded, i.e. when it is valid.
    /// </para>
    /// <para>
    /// It also removes the only attacker-controlled field from the record.
    /// <c>Request.Path</c> is percent-DECODED, so a request to
    /// <c>/survey-links/a%0A2099-01-01%20fatal:%20...</c> writes a newline into the
    /// <see cref="RejectionLogCategory"/> stream that #158 alerts on and forges a second log
    /// line. A route template is a compile-time constant from the endpoint table; the method
    /// is an HTTP token Kestrel has already validated; and the caller address comes back from
    /// <see cref="ClientIpResolver"/> normalised through <c>IPAddress</c> or as the literal
    /// <c>unknown</c>. Nothing in the message is free text from the wire.
    /// </para>
    /// </summary>
    internal static string RouteNameFor(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return httpContext.GetEndpoint() is RouteEndpoint routeEndpoint
            ? routeEndpoint.RoutePattern.RawText ?? UnmatchedRouteName
            : UnmatchedRouteName;
    }

    /// <summary>
    /// Makes a rejection observable and actionable: a warning naming the policy and the
    /// caller, and a <c>Retry-After</c> so a well-behaved client backs off instead of
    /// hammering. Without this an attack against a limited endpoint looks exactly like
    /// silence in the logs, which is the failure mode #158 exists to close.
    ///
    /// <para>
    /// What it names is the route template, not the path -- see <see cref="RouteNameFor"/>
    /// for why that is load-bearing rather than cosmetic. The cost is real and accepted: an
    /// operator reading this stream can see which class of route is being hammered and from
    /// where, but cannot tell one token from another. Distinguishing them would mean writing
    /// credentials to a log, and the caller address is the field an investigation needs.
    /// </para>
    /// </summary>
    private static ValueTask OnRejectedAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var httpContext = context.HttpContext;

        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            httpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(NumberFormatInfo.InvariantInfo);
        }

        var policyName = httpContext.GetEndpoint()?.Metadata
            .GetMetadata<EnableRateLimitingAttribute>()?.PolicyName ?? "global";

        httpContext.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger(RejectionLogCategory)
            .LogWarning(
                "Rate limit rejected {Method} {Route} for caller {ClientIp} under policy {Policy}.",
                httpContext.Request.Method,
                RouteNameFor(httpContext),
                ClientIpFor(httpContext),
                policyName);

        return ValueTask.CompletedTask;
    }
}
