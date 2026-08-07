namespace ClimateProject.Api.Infrastructure;

// Options types that exist so their required settings can be validated at *host start*
// rather than on the first request that happens to need them (#189).
//
// appsettings.json ships every secret as an empty string rather than an absent key, so an
// empty string is the value a forgotten deployment secret actually produces. Guards over
// these must therefore use string.IsNullOrWhiteSpace, not "?? throw" -- and, more
// importantly, must fire before the service starts accepting traffic. Otherwise the app
// starts, /health (a static literal that touches nothing) reports "ok", the deploy is
// recorded as successful, and only real requests fail.
//
// Each is populated by a Configure<IConfiguration> delegate in Program.cs that throws on a
// missing value, paired with .ValidateOnStart(). The delegate still reads IConfiguration
// lazily -- it runs from the options-validation hosted service after builder.Build() -- so
// WebApplicationFactory's in-memory test overrides are honoured. That is the same mechanism
// TrackingJwtSecret already used, generalised to the settings that lacked it.

/// <summary>
/// The Postgres connection string. Validated at startup so a deploy with no connection
/// string fails visibly instead of 500ing every DB-touching route.
/// </summary>
public sealed class DatabaseOptions
{
    public string ConnectionString { get; set; } = string.Empty;

    // The remaining properties are what DatabaseConnectionStringPolicy decided about the
    // string above, captured once at startup so that GET /admin/system/status can report it
    // (#147). They are stored rather than recomputed on demand for two reasons: the policy is
    // not idempotent in what it *reports* (re-applying it to an already-bounded string would
    // claim the pool size was operator-supplied), and recomputing would mean an endpoint
    // handling the raw connection string. None of these is a secret -- a port number and a
    // pool bound carry no host, database, username or password -- and nothing anywhere
    // exposes ConnectionString itself.

    /// <summary>Effective Postgres port, either as configured or Npgsql's default.</summary>
    public int Port { get; set; }

    /// <summary>
    /// <see langword="true"/> when <see cref="Port"/> is Supabase Supavisor's transaction
    /// pooler, which this service must not use. Reported at startup as a warning and, since
    /// #147, on the diagnostics endpoint too -- the warning is only visible to whoever reads
    /// the deploy logs, and #220 went unnoticed for exactly that reason.
    /// </summary>
    public bool UsesTransactionPoolerPort { get; set; }

    /// <summary>Effective Npgsql maximum pool size.</summary>
    public int MaxPoolSize { get; set; }

    /// <summary>
    /// <see langword="true"/> when the connection string did not specify a pool bound and the
    /// policy default was applied; <see langword="false"/> when an operator set one.
    /// </summary>
    public bool MaxPoolSizeDefaulted { get; set; }
}

/// <summary>
/// The static bearer token guarding <c>/api/internal/*</c>. Validated at startup only;
/// <see cref="InternalApiKeyFilter"/> still reads the key from IConfiguration itself and
/// keeps its own fail-closed check as defence in depth.
/// </summary>
public sealed class InternalApiOptions
{
    public string ApiKey { get; set; } = string.Empty;
}

/// <summary>
/// Google sign-in configuration.
/// </summary>
/// <remarks>
/// <para>
/// <c>GoogleClientId</c> is the one setting of the four in #189 that cannot simply be made
/// mandatory. An environment with Google sign-in switched off has no reason to configure it,
/// and failing startup there would be wrong -- #189 says exactly this, and says the right
/// shape is "validate at startup <em>if</em> Google login is enabled", which needs a flag
/// that did not exist.
/// </para>
/// <para>
/// <c>GoogleAuth:Required</c> is that flag, and it is the whole of it: default
/// <see langword="false"/>, so local development, CI and any Google-disabled deployment are
/// unaffected; set to <see langword="true"/> in an environment that depends on Google login
/// (production) and a missing client id then fails the host at startup like the other three.
/// </para>
/// <para>
/// Deliberately not done here: turning the Google login <em>endpoint</em> into a clean 501
/// when unconfigured. It currently throws from <c>GoogleTokenVerifier</c>'s constructor and
/// surfaces as a 500 on that one route. That is an endpoint-behaviour change rather than
/// startup validation, so it is a separate issue rather than smuggled into a size:S one.
/// </para>
/// </remarks>
public sealed class GoogleAuthOptions
{
    public string? ClientId { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId);
}
