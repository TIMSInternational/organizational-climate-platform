using System.Globalization;
using System.Threading.RateLimiting;
using ClimateProject.Api.Endpoints;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Settings for the rate limiter. Bound from the <c>RateLimiting</c> configuration section;
/// the defaults here are the production values, so an unconfigured deployment is limited
/// rather than unlimited.
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
    /// The coarse ceiling applied to every request except the probe paths, per caller. It is
    /// deliberately far above any human's traffic: its job is to bound a flood, not to shape
    /// normal use, and the per-class policies below it are what actually defend the sensitive
    /// surfaces. Configurable so that a test can prove the limiter fires without issuing six
    /// hundred requests.
    /// </summary>
    public int GlobalPermitsPerMinute { get; set; } = RateLimitPolicies.DefaultGlobalPermitsPerMinute;
}

/// <summary>
/// The rate-limiting policy set (#146), and the one place that says which endpoint class
/// gets which limit.
///
/// <para>
/// <b>The classes, and why they are not one global limit.</b> Authentication is the only
/// surface where a few requests per minute is already suspicious, so it gets the tightest
/// bucket. Public token-addressed routes are the ones an attacker can enumerate or replay
/// without any credential, so they are bucketed by the token rather than by the caller --
/// bucketing them by caller alone would let a botnet replay one invitation freely. Public
/// submission keeps the two per-surface policies that already existed.
/// </para>
/// <para>
/// Underneath all of them, and in addition to them, every non-probe request also passes
/// <see cref="RateLimitingOptions.GlobalPermitsPerMinute"/> -- keyed by user id once the
/// caller is authenticated, so a shared office address cannot make colleagues compete for
/// one bucket, and one compromised account cannot saturate the service for its tenant. That
/// is the class the ordinary authenticated API falls into, and it is why routes with no
/// policy of their own are still bounded.
/// </para>
/// <para>
/// <b>The probe carve-out is load-bearing.</b> <c>/health</c> is what App Runner's own
/// health check polls (<c>HealthCheckConfiguration.Path</c> in the service template, every
/// 10 seconds) and <c>/ready</c> is how #220 is monitored. A 429 to either reads to App
/// Runner as an unhealthy instance and would tear the service down -- a rate limiter that
/// causes the outage it was added to prevent. <see cref="UnlimitedPaths"/> is the exemption
/// and <c>RateLimitingTests</c> proves it holds above the limit.
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
    /// The unauthenticated, token-addressed routes: invitation acceptance, the survey
    /// invitation state routes, and public survey link resolution.
    /// </summary>
    public const string PublicToken = "public-token";

    /// <summary>Requests per window per caller on <see cref="Authentication"/>.</summary>
    public const int AuthenticationPermitsPerWindow = 20;

    /// <summary>Requests per window per token on <see cref="PublicToken"/>.</summary>
    public const int PublicTokenPermitsPerWindow = 20;

    /// <summary>Default for <see cref="RateLimitingOptions.GlobalPermitsPerMinute"/>.</summary>
    public const int DefaultGlobalPermitsPerMinute = 600;

    public static readonly TimeSpan AuthenticationWindow = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan PublicTokenWindow = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan GlobalWindow = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Paths that are never rate limited, at any layer. All four are unauthenticated on
    /// purpose and none of them touches user-supplied input: <c>/</c> is a static redirect,
    /// <c>/health</c> and <c>/version</c> are static literals, and <c>/ready</c> issues one
    /// <c>SELECT 1</c>. See the class remarks for what a 429 on <c>/health</c> or
    /// <c>/ready</c> would cost.
    /// </summary>
    public static readonly IReadOnlySet<string> UnlimitedPaths =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "/", "/health", "/ready", "/version" };

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
                options => options.TrustedProxyHopCount >= 0 && options.GlobalPermitsPerMinute > 0,
                "RateLimiting:TrustedProxyHopCount must be >= 0 and RateLimiting:GlobalPermitsPerMinute must be > 0.")
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
    /// </summary>
    internal static RateLimitPartition<string> PartitionGlobal(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (IsUnlimitedPath(httpContext.Request.Path))
        {
            return RateLimitPartition.GetNoLimiter("probe");
        }

        // "sub" rather than ClaimTypes.NameIdentifier: JwtBearerOptions sets
        // MapInboundClaims = false in Program.cs, so the raw claim name is what is present.
        var subject = httpContext.User.FindFirst("sub")?.Value;
        var key = string.IsNullOrEmpty(subject)
            ? "ip:" + ClientIpFor(httpContext)
            : "user:" + subject;

        var permitLimit = httpContext.RequestServices
            .GetRequiredService<IOptions<RateLimitingOptions>>().Value.GlobalPermitsPerMinute;

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: key,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = GlobalWindow,
                QueueLimit = 0,
            });
    }

    /// <summary>
    /// Partitions a token-addressed public route by its <c>{token}</c> route value, so one
    /// invitation cannot be replayed thousands of times regardless of how many addresses the
    /// replays come from. A request that somehow carries no token falls back to the caller's
    /// address rather than sharing a single bucket with every other caller.
    /// </summary>
    internal static RateLimitPartition<string> PartitionPublicToken(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        var token = httpContext.Request.RouteValues.TryGetValue("token", out var routeValue)
            ? routeValue as string
            : null;

        // The token itself is the partition key. It stays in memory and is never logged --
        // OnRejectedAsync deliberately logs the route pattern and caller address instead,
        // because a survey invitation token is a bearer credential.
        var key = string.IsNullOrEmpty(token)
            ? "public-token:ip:" + ClientIpFor(httpContext)
            : "public-token:" + token;

        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: key,
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = PublicTokenPermitsPerWindow,
                Window = PublicTokenWindow,
                QueueLimit = 0,
            });
    }

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
    /// Makes a rejection observable and actionable: a warning naming the policy and the
    /// caller, and a <c>Retry-After</c> so a well-behaved client backs off instead of
    /// hammering. Without this an attack against a limited endpoint looks exactly like
    /// silence in the logs, which is the failure mode #158 exists to close.
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
                "Rate limit rejected {Method} {Path} for caller {ClientIp} under policy {Policy}.",
                httpContext.Request.Method,
                httpContext.Request.Path.Value,
                ClientIpFor(httpContext),
                policyName);

        return ValueTask.CompletedTask;
    }
}
