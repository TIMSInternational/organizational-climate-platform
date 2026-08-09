using ClimateProject.Api;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
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
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using System.Text;
using System.Threading.RateLimiting;

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

        if (policy.UsesTransactionPoolerPort)
        {
            // WARNING, NOT A HARD FAILURE -- DELIBERATELY. THE LIVE SECRET STILL SAYS 6543.
            //
            // Every other startup guard in this file throws, because #189 established that a
            // deploy which boots misconfigured is worse than one that refuses to boot. This
            // one is the exception, and only because of ordering: the fix is a value in AWS
            // Secrets Manager (climate-project-api/prod/database-connection-string), not a
            // value in this repository, and it has not been changed yet. Throwing here would
            // mean the next deploy of *this commit* fails its App Runner health check and
            // rolls back -- turning a service that is intermittently slow into one that is
            // entirely down, in order to complain about a value the deploy cannot fix.
            //
            // TODO(#220): once the secret is flipped from 6543 to 5432 and a deploy has come
            // up green on it, harden this into a throw like the guards above, so the port
            // cannot silently regress. That change is safe only in that order.
            logger.LogWarning(
                "Database connection string uses port {Port}, the Supabase Supavisor TRANSACTION " +
                "pooler. This service holds pooled connections open across statements, which " +
                "transaction mode cannot support: it is the cause of the intermittent /ready " +
                "timeouts in issue #220. Expected port {ExpectedPort} (the SESSION pooler -- same " +
                "host, same credentials). Fix the Secrets Manager value " +
                "'climate-project-api/prod/database-connection-string'; it cannot be fixed from " +
                "this repository.",
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

builder.Services.AddDbContext<ClimateProjectDbContext>((sp, options) =>
    options.UseNpgsql(sp.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString));

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
    })
    // Forces the Configure delegate above to run at host-startup time (via the
    // options-validation hosted service that runs after builder.Build()), so a
    // missing/empty TrackingJwtSecret fails fast at startup instead of on the
    // first inbound request (which would otherwise 500 on every request,
    // including /health). Running after builder.Build() still correctly picks
    // up WebApplicationFactory test config overrides -- see the lazy-resolution
    // comment above.
    .ValidateOnStart();

builder.Services.AddAuthorization();

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

// POST /microclimates/{id}/responses is the app's only unauthenticated write surface (approved
// 2026-07-31 for microclimates configured with AnonymousResponses). With no per-respondent
// identity and no persisted individual response rows to reconcile against later, a single
// visitor/bot holding the microclimate's GUID could otherwise inflate ResponseCount/
// EngagementLevel/the word cloud without bound. Partition per client IP -- generous enough for
// legitimate shared-IP participation (office NAT, etc.) but bounded against a scripted flood.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    // POST /surveys/{id}/responses and GET /surveys/{id}/respond (#118). Its own policy
    // rather than the microclimate one -- the partition and limits live with the
    // endpoints, in SurveyResponseEndpoints.
    options.AddPolicy(
        SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy,
        SurveyResponseEndpoints.PartitionResponseSubmission);
});

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

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapOpenApi();

app.MapGet("/", () => Results.Redirect("/health"));

// Liveness. Deliberately a static literal with no dependency probe: this is what
// App Runner's own health check polls (HealthCheckPath in the service template), and
// tying that to the database would let a transient Postgres blip convince App Runner
// the container is dead and tear down a service whose process is perfectly healthy.
// Use /ready for "can this instance actually serve traffic".
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
app.MapSystemStatusEndpoints();
app.MapDashboardEndpoints();

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
