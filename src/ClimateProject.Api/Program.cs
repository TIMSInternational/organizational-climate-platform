using ClimateProject.Api;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Cors;
using ClimateProject.Application.Email;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.Email;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.OrgStructure;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using System.Globalization;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// Connection string and DB options are resolved from IConfiguration lazily (per
// scope, on first use) rather than read into a local variable here. Reading
// builder.Configuration eagerly at this point in Program.cs would capture
// appsettings values *before* WebApplicationFactory (integration tests) gets a
// chance to inject its in-memory config overrides via ConfigureWebHost/
// ConfigureAppConfiguration -- those overrides are only applied at the point
// builder.Build() is invoked, which is later in this file.
//
// The guard on the connection string used to live inside the AddDbContext delegate below, so
// it only fired when a DbContext was first resolved -- i.e. on the first DB-touching request.
// A deploy with no connection string therefore started successfully, answered /health with
// "ok" (that endpoint is a static literal and resolves no DbContext), reported a healthy
// deploy, and then 500'd every real request. #189. Moving the guard into an options type with
// .ValidateOnStart() makes it fail the host at startup instead, while keeping the lazy
// IConfiguration read the comment above requires: the Configure delegate runs from the
// options-validation hosted service *after* builder.Build(), which is late enough for
// WebApplicationFactory's in-memory overrides to be visible.
//
// The connection string is additionally passed through DatabaseConnectionStringPolicy, which
// bounds the Npgsql pool and reports on the pooler port (#220). Both belong here rather than
// in the AddDbContext delegate below for the same reason the guard above does: this runs once,
// at startup, where its warning is visible in the deploy's logs.
const string DatabaseStartupLogCategory = "ClimateProject.Api.Database";

builder.Services.AddOptions<DatabaseOptions>()
    .Configure<IConfiguration, ILoggerFactory>((options, configuration, loggerFactory) =>
    {
        var connectionString = configuration.GetConnectionString("ClimateProject");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Missing ConnectionStrings:ClimateProject configuration.");
        }

        var policy = DatabaseConnectionStringPolicy.Apply(connectionString);
        var logger = loggerFactory.CreateLogger(DatabaseStartupLogCategory);

        // WARN OR THROW ON THE TRANSACTION POOLER -- THE DEPLOYMENT CHOOSES WHICH (#220).
        //
        // The guards in this file for settings that are required in every environment -- the
        // connection string above, InternalApiKey, TrackingJwtSecret -- throw outright, because
        // #189 established that a deploy which boots misconfigured is worse than one that
        // refuses to boot. The two settings that are not required everywhere, GoogleClientId
        // and the Email block, already guard themselves conditionally instead; both are below.
        // This guard cannot throw outright yet, and the reason is ordering rather
        // than principle: the wrong value lives in AWS Secrets Manager
        // (climate-project-api/prod/database-connection-string), not in this repository, and
        // it has not been changed yet. Throwing on today's production value would mean the
        // next deploy of *this commit* fails its App Runner health check and rolls back --
        // turning a service that is intermittently slow into one that is entirely down, in
        // order to complain about a value the deploy itself cannot fix.
        //
        // So the severity is a per-deployment setting, Database:RequireSessionPooler, in the
        // same shape as GoogleAuth:Required (see StartupOptions.cs) and for the same reason:
        // a guard that must be fatal where it matters and must not be fatal where it does
        // not. It defaults to false, and it can only ever escalate the warning to a failure
        // -- there is no value of it that suppresses the warning, which is what stops it
        // becoming a way to hide the defect rather than a way to ratchet it shut.
        //
        // The intended end state, in this order (infra/aws/README.md has the full sequence):
        // flip the secret to 5432, redeploy, confirm 20+ consecutive /ready probes are 200
        // and this warning is gone from the logs, then set Database__RequireSessionPooler to
        // "true" in infra/aws/climate-project-api-prod-service.yml so the port cannot
        // silently regress. That last step is a one-line change to the service template; no
        // step in the sequence requires editing this file again.
        var requireSessionPooler = configuration.GetValue<bool>("Database:RequireSessionPooler");
        var poolerAction = DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
            policy.UsesTransactionPoolerPort,
            requireSessionPooler);

        // One description, used by both branches, so the warning and the startup failure
        // cannot drift into describing the problem differently. Written as a local function
        // rather than two literals for that reason alone.
        string DescribeTransactionPoolerProblem() => string.Format(
            CultureInfo.InvariantCulture,
            "Database connection string uses port {0}, the Supabase Supavisor TRANSACTION " +
            "pooler. This service holds pooled connections open across statements, which " +
            "transaction mode cannot support: it is the cause of the intermittent /ready " +
            "timeouts in issue #220. Expected port {1} (the SESSION pooler -- same host, " +
            "same credentials, different port). Fix the Secrets Manager value " +
            "'climate-project-api/prod/database-connection-string'; it cannot be fixed from " +
            "this repository.",
            policy.Port,
            DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort);

        if (poolerAction == TransactionPoolerAction.Fail)
        {
            throw new InvalidOperationException(
                DescribeTransactionPoolerProblem()
                + " This deployment sets Database:RequireSessionPooler=true, so this is a "
                + "startup failure rather than a warning.");
        }

        if (poolerAction == TransactionPoolerAction.Warn)
        {
            // Port and ExpectedPort are passed as their own arguments, not only baked into
            // {TransactionPoolerProblem}, so log aggregation can query the port as a field
            // rather than by substring-matching the rendered sentence. That mattered before
            // this rewrite and would have been lost by folding everything into one
            // pre-rendered string.
            logger.LogWarning(
                "{TransactionPoolerProblem} Set Database:RequireSessionPooler=true once the "
                + "secret is on the session pooler, to make this a startup failure instead. "
                + "(Port={Port}, ExpectedPort={ExpectedPort}.)",
                DescribeTransactionPoolerProblem(),
                policy.Port,
                DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort);
        }

        if (policy.MaxPoolSizeApplied)
        {
            logger.LogInformation(
                "Applied default Npgsql Maximum Pool Size of {MaxPoolSize}; the connection string " +
                "did not specify one (#220). Set 'Maximum Pool Size' in the connection string to " +
                "override.",
                policy.MaxPoolSize);
        }

        options.ConnectionString = policy.ConnectionString;

        // Carry the policy's findings forward so GET /admin/system/status can report them
        // (#147). The warning above only reaches whoever reads the deploy logs.
        options.Port = policy.Port;
        options.UsesTransactionPoolerPort = policy.UsesTransactionPoolerPort;
        options.MaxPoolSize = policy.MaxPoolSize;
        options.MaxPoolSizeDefaulted = policy.MaxPoolSizeApplied;
    })
    .ValidateOnStart();

// AuditLogAppendOnlyInterceptor makes an UPDATE or DELETE of an audit row throw rather than
// succeed (#143). Registered on the context itself, not in one endpoint, because the property
// wanted is "nothing in this process can rewrite the trail" -- see the interceptor for what
// that does and does not cover, and for why the complete version is a database grant.
builder.Services.AddDbContext<ClimateProjectDbContext>((sp, options) => options
    .UseNpgsql(sp.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString)
    .AddInterceptors(AuditLogAppendOnlyInterceptor.Instance));

// One per request, shared by the audit middleware and whichever handler runs. Handlers use it
// to name what they did; nothing about it can stop a row being written. See AuditEntry.
builder.Services.AddScoped<AuditEntry>();

// InternalApiKey guards /api/internal/*, which TrackingInternalEndpoints maps unconditionally.
// Before #189 an unset key meant those routes were mapped and every call 500'd with "Internal
// API is not configured." -- a failure documented in README.md and infra/aws/README.md but not
// prevented, and invisible to /health. Unlike GoogleClientId there is no environment where the
// key is legitimately absent, so refusing to start is strictly better: a deploy that forgets
// the secret fails its health check and rolls back, rather than coming up with the tracking
// integration silently dead. InternalApiKeyFilter keeps its own fail-closed check as defence
// in depth -- see the note there.
builder.Services.AddOptions<InternalApiOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        var internalApiKey = configuration["InternalApiKey"];
        if (string.IsNullOrWhiteSpace(internalApiKey))
        {
            throw new InvalidOperationException("Missing InternalApiKey configuration.");
        }

        options.ApiKey = internalApiKey;
    })
    .ValidateOnStart();

// GoogleClientId is conditionally required -- see GoogleAuthOptions for why it cannot just be
// mandatory, and what GoogleAuth:Required is for.
builder.Services.AddOptions<GoogleAuthOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        options.ClientId = configuration["GoogleClientId"];

        if (configuration.GetValue("GoogleAuth:Required", false) && !options.IsConfigured)
        {
            throw new InvalidOperationException(
                "Missing GoogleClientId configuration (required because GoogleAuth:Required is true).");
        }
    })
    .ValidateOnStart();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();

// Same lazy-resolution reasoning as above applies to TrackingJwtSecret: it's
// read from IConfiguration when JwtBearerOptions is first resolved (at request
// time), not eagerly here, so test-time overrides take effect.
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IConfiguration>((options, configuration) =>
    {
        var trackingJwtSecret = configuration["TrackingJwtSecret"];
        if (string.IsNullOrWhiteSpace(trackingJwtSecret))
        {
            throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");
        }

        // Without this, the handler remaps well-known claim names ("sub" -> NameIdentifier
        // URI, "role" -> Role URI, etc.) before CurrentUser reads them by their raw names.
        // Must match climate-tracking's Program.cs exactly for token compatibility.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(trackingJwtSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            NameClaimType = "sub",
        };

        // Revocation (#284). The signature and lifetime checks above say the token was minted
        // by a holder of the secret and has not expired; this says the session it represents
        // has not been ended since. It runs here, in authentication, rather than in the
        // authorization policy below, for two reasons: the refusal is a 401 (the client's
        // authFetch turns that into "sign in again", which is exactly what happened), and
        // authentication also covers endpoints that read a token without RequireAuthorization.
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = SecurityStampValidation.ValidateAsync,
        };
    })
    // Forces the Configure delegate above to run at host-startup time (via the
    // options-validation hosted service that runs after builder.Build()), so a
    // missing/empty TrackingJwtSecret fails fast at startup instead of on the
    // first inbound request (which would otherwise 500 on every request,
    // including /health). Running after builder.Build() still correctly picks
    // up WebApplicationFactory test config overrides -- see the lazy-resolution
    // comment above.
    .ValidateOnStart();

// Every authorized endpoint in this app uses the bare RequireAuthorization(), i.e. this
// policy -- so adding the deactivation check here enforces it product-wide in one place (#280).
//
// It reads the token's own isActive claim rather than the database, so no token minted by
// another issuer against the shared TrackingJwtSecret is locked out for lacking a claim it
// never wrote (see HasDeactivatedAccountClaim). What it buys is that a token saying
// "deactivated" is refused by the API itself. Before this, the only thing anywhere that read
// that claim was a client-side redirect in the SPA.
//
// It is a second line of defence, not the fix: every path that mints a token -- /auth/login,
// /auth/signup, /auth/google, /auth/refresh and POST /invitations/{token}/accept -- goes
// through AuthEndpoints.IssueTokenForAsync, which refuses to mint one in the first place.
//
// Neither layer revokes a token that was issued while the account was still ACTIVE, because
// neither reads anything but the claim the token was minted with. What revokes it is #284's
// stamp: the JwtBearerEvents hook above refuses any token whose stamp claim no longer matches
// the row -- a token with NO stamp claim bypasses the hook (it returns early), which is empty
// within the 24h lifetime unless another minter shares the signing secret --
// and since #286 the two paths that deactivate an account rotate the column --
// `PUT /admin/users/{id}` and the GDPR erasure's SubjectErasure.AnonymiseAccount. So a
// deactivated user's next request TO THIS API is a 401 rather than a 200 for up to the
// token's 24h lifetime. This policy stays as the second line of defence it was written to
// be, not as the thing that ends a session.
//
// Scope that claim to this API and no further. services/tracking-api validates tokens against
// the same shared TrackingJwtSecret, reads the isActive claim the token was minted with, and
// has no OnTokenValidated hook and no access to users.security_stamp -- so a token minted here
// before a deactivation keeps authorising requests THERE until it expires. Ending a session
// across both services needs the stamp check (or an equivalent) on that side too, and nothing
// in this repository does it today.
//
// (This comment used to say "no per-request user lookup is added" of the policy. That is
// still true of the policy, but no longer true of the request: #284's OnTokenValidated hook
// reads the acting user's stamp on every request whose token carries the claim.)
builder.Services.AddAuthorization(options =>
{
    options.DefaultPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireAssertion(context => !context.User.HasDeactivatedAccountClaim())
        .Build();
});

builder.Services.AddCors();
builder.Services.AddOptions<CorsOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        var allowedWildcardOrigins = configuration.GetSection("Cors:AllowedWildcardOrigins").Get<string[]>() ?? [];
        var matcher = new CorsOriginMatcher(allowedOrigins, allowedWildcardOrigins);

        options.AddPolicy("Frontend", policy => policy
            .SetIsOriginAllowed(matcher.IsAllowed)
            .AllowAnyHeader()
            .AllowAnyMethod());
    })
    // Belt-and-braces, and deliberately labelled as such rather than as a fix (#189).
    //
    // An empty CORS allowlist is legitimate config, so unlike the three settings above there is
    // nothing "missing" to guard against. CorsOriginMatcher's constructor *does* throw on a
    // wildcard pattern with no '*' in it -- but that already fails at host start today, without
    // this call: UseCors("Frontend") builds CorsMiddleware while the pipeline is constructed
    // during Host.Start, and DefaultCorsPolicyProvider resolves IOptions<CorsOptions> in its
    // constructor.
    //
    // Measured, not assumed. Deleting .ValidateOnStart() from the four registrations added here
    // fails 6 of the 9 fail-fast tests in StartupValidationTests and leaves the CORS one green,
    // even when the test asserts on host start and issues no request. So this line changes no
    // behaviour now; it is kept only so that the guarantee survives someone later moving
    // UseCors behind a conditional, which would otherwise silently remove the eager resolution.
    .ValidateOnStart();

builder.Services.AddScoped<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IGoogleTokenVerifier, GoogleTokenVerifier>();

// Mail provider configuration (#100). Conditionally required, in the shape #189 established
// for GoogleClientId: nothing is mandatory while Email:Provider is 'none' (local dev, CI and
// the integration suite all run that way and must keep starting), but selecting a provider
// makes the settings it cannot work without mandatory -- and a half-configured provider then
// fails the host at startup rather than booting into a service that reports every notification
// as sent and delivers none. See EmailOptions for the full rule.
builder.Services.AddOptions<EmailOptions>()
    .Configure<IConfiguration, ILoggerFactory>((options, configuration, loggerFactory) =>
    {
        configuration.GetSection("Email").Bind(options);

        if (options.Validate() is { } error)
        {
            throw new InvalidOperationException(error);
        }

        EmailDeliveryStartupReport.Write(
            loggerFactory.CreateLogger(EmailDeliveryStartupReport.LogCategory),
            options);
    })
    .ValidateOnStart();

// Unwrapped so Infrastructure can take EmailOptions directly and stay free of an options
// dependency. Resolved lazily like every other options read in this file, so
// WebApplicationFactory's in-memory overrides are still honoured.
builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<EmailOptions>>().Value);

// Singleton, and that is load-bearing: the rate limiter paces sends process-wide, so a
// per-request instance would pace nothing. See EmailSendRateLimiter.
builder.Services.AddSingleton(sp => new EmailSendRateLimiter(sp.GetRequiredService<EmailOptions>().MaxSendsPerSecond));
builder.Services.AddScoped<IEmailTransport, SmtpEmailTransport>();

// The two delivery seams (#97 left both stubbed; #100 fills them in). Resolved from
// configuration rather than registered as a fixed type -- a factory rather than an `if` over
// builder.Configuration, because reading configuration eagerly here would capture appsettings
// values before test-time overrides are applied, the same reason the connection string at the
// top of this file is read lazily.
//
// Unconfigured keeps the logging stubs, which deliver nothing and report success. That state
// is announced by a startup WARNING (EmailDeliveryStartupReport) so it cannot be mistaken for
// working delivery.
builder.Services.AddScoped<IInvitationEmailSender>(sp => sp.GetRequiredService<EmailOptions>().IsConfigured
    ? ActivatorUtilities.CreateInstance<EmailInvitationEmailSender>(sp)
    : ActivatorUtilities.CreateInstance<LoggingInvitationEmailSender>(sp));

builder.Services.AddScoped<INotificationSender>(sp => sp.GetRequiredService<EmailOptions>().IsConfigured
    ? ActivatorUtilities.CreateInstance<EmailNotificationSender>(sp)
    : ActivatorUtilities.CreateInstance<LoggingNotificationSender>(sp));

builder.Services.AddOpenApi();

// Rate limiting (#146). Every policy, limit and partition key lives in RateLimitPolicies;
// this line is only the registration. Two of the policies predate #146 (the microclimate and
// survey public-submission surfaces) and are unchanged in their limits -- what #146 added is
// the authentication and public-token classes, a coarse global ceiling with an explicit
// carve-out for the App Runner probe paths, and a shared notion of "which caller is this"
// that is not the socket peer. See RateLimitPolicies and ClientIpResolver.
builder.Services.AddClimateProjectRateLimiting();

// Security response headers and the request-body ceiling (#146). See SecurityHardening.
builder.Services.AddClimateProjectSecurityOptions();

// Kestrel's own body ceiling, raised from its 30 MiB default to the upload ceiling so that
// Kestrel does not reject a legitimate bulk import before the middleware has decided which
// ceiling applies. The middleware is what enforces the strict default per request.
builder.WebHost.ConfigureKestrel((context, kestrelOptions) =>
    kestrelOptions.Limits.MaxRequestBodySize =
        context.Configuration.GetValue<long?>("Security:MaxUploadBodyBytes")
        ?? new SecurityOptions().MaxUploadBodyBytes);

var app = builder.Build();

// Whole-repo previously had NO exception middleware anywhere in this pipeline, so
// any unhandled exception (most commonly a DbUpdateException from a unique-index
// violation the endpoint didn't pre-check for) reached the client as a bare 500
// with no body -- e.g. BulkImportEndpoints hitting the global users.email unique
// index, or a demographic-field key collision. This is a deliberately generic,
// last-resort safety net: individual endpoints should still pre-check and return
// a specific 409 with a helpful message where that's feasible (see
// DemographicFieldEndpoints.CreateAsync), this only stops a residual/racy
// constraint violation from surfacing as an opaque, bodiless crash.
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        var isUniqueViolation = exception is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } };

        context.Response.ContentType = "application/json";
        context.Response.StatusCode = isUniqueViolation ? StatusCodes.Status409Conflict : StatusCodes.Status500InternalServerError;
        var message = isUniqueViolation
            ? "The request conflicts with existing data."
            : "An unexpected error occurred.";
        await context.Response.WriteAsJsonAsync(new { message });
    });
});

// Before UseCors so the headers are attached to every response the pipeline can produce,
// including the exception handler's 500 above.
app.UseClimateProjectSecurityHeaders();

app.UseCors("Frontend");

// After UseCors so a 413 still carries the CORS headers the browser needs in order to read
// it, and before authentication so an oversized body is refused without a token or database
// round trip.
app.UseClimateProjectRequestSizeLimit();

app.UseAuthentication();

// Between authentication and authorization, on purpose (#143). After UseAuthentication because
// it reads HttpContext.User to attribute the row; before UseAuthorization so that a mutating
// request refused by the authorization middleware is still recorded, rather than disappearing
// before anything sees it. That second half only helps when the caller is identifiable -- a
// 403 for a deactivated account is recorded, a 401 with no token cannot be, because
// audit_logs.company_id is NOT NULL and there is no tenant to file it under.
//
// It audits every POST/PUT/PATCH/DELETE that reaches an endpoint, with no per-endpoint opt-in
// -- that is the whole requirement of the issue.
app.UseAuditLogging();

app.UseAuthorization();
app.UseRateLimiter();

app.MapOpenApi();

app.MapGet("/", () => Results.Redirect("/health"));

// Liveness. Deliberately a static literal with no dependency probe: it answers "is the
// process up", and nothing else. It is NOT what App Runner polls -- that is /ready, as
// of #221, because a literal cannot notice a database an instance has lost, so an
// instance broken that way passed this probe forever and was never replaced. The blip
// risk that argued for polling this instead is handled by the health-check thresholds
// in the service template rather than by the choice of path.
app.MapGet("/health", () => Results.Ok(new
{
    service = "climate-project-api",
    status = "ok"
}));

// Readiness. Unlike /health this performs a real round-trip to Postgres, which is
// what makes it usable as a deploy gate: the previous canary hit /health, so an
// instance with a broken/misconfigured connection string booted, answered the canary
// 200, and the deploy was reported successful. Everything then 500'd on first real
// request. `SELECT 1` is deliberately a query and not `CanConnectAsync` -- the latter
// can be satisfied by a pooler handshake without proving the session can execute.
//
// Returns 503 on failure so orchestrators and the deploy canary can distinguish "not
// ready" from "broken request". The exception is logged but never echoed to the
// caller: this endpoint is unauthenticated, and Npgsql failure messages contain the
// host, database, and username of the production database.
app.MapGet("/ready", async (
    ClimateProjectDbContext dbContext,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    try
    {
        await dbContext.Database.ExecuteSqlRawAsync("SELECT 1", cancellationToken);

        return Results.Ok(new ReadinessResponse(
            Service: "climate-project-api",
            Status: "ready",
            Database: "ok"));
    }
    catch (Exception exception)
    {
        loggerFactory
            .CreateLogger("ClimateProject.Api.Readiness")
            .LogError(exception, "Readiness probe failed: database round-trip did not succeed.");

        return Results.Json(
            new ReadinessResponse(
                Service: "climate-project-api",
                Status: "not-ready",
                Database: "unreachable"),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

// Commit and BuiltAt are what make this endpoint able to answer "is what's running
// actually what we shipped?". Without them /version was invariant across code
// changes and could not distinguish a successful deploy from one that silently
// no-op'd. See BuildInfo.cs.
app.MapGet("/version", () => Results.Ok(new VersionResponse(
    Service: "climate-project-api",
    Runtime: Environment.Version.ToString(),
    Environment: app.Environment.EnvironmentName,
    Commit: BuildInfo.CommitSha,
    BuiltAt: BuildInfo.BuildTimestamp)));

app.MapAuthEndpoints();
app.MapCompanyEndpoints();
app.MapDepartmentEndpoints();
app.MapUserEndpoints();
app.MapProfileEndpoints();
app.MapInvitationEndpoints();
app.MapInvitationAcceptEndpoints();
app.MapSystemSettingsEndpoints();
app.MapDemographicFieldEndpoints();
app.MapBulkImportEndpoints();
app.MapActionPlanEndpoints();
app.MapActionPlanTemplateEndpoints();
app.MapNotificationTemplateEndpoints();
app.MapTrackingPickerEndpoints();
app.MapTrackingInternalEndpoints();
app.MapSurveyEndpoints();
app.MapSurveyResponseEndpoints();
app.MapSurveyDistributionEndpoints();
app.MapSurveyDraftEndpoints();
app.MapSurveyResultsEndpoints();
app.MapSurveyHistoryEndpoints();
app.MapSurveyTemplateEndpoints();
app.MapMicroclimateEndpoints();
app.MapMicroclimateTemplateEndpoints();
app.MapReportEndpoints();
app.MapBenchmarkEndpoints();
app.MapAnalyticsInsightEndpoints();
app.MapAIInsightEndpoints();
app.MapNotificationEndpoints();
app.MapDemographicSnapshotEndpoints();
app.MapSearchEndpoints();
app.MapSystemStatusEndpoints();
app.MapDashboardEndpoints();
app.MapAuditEndpoints();
app.MapGdprEndpoints();

app.Run();

internal sealed record ReadinessResponse(
    string Service,
    string Status,
    string Database);

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment,
    string Commit,
    string BuiltAt);

public partial class Program;
