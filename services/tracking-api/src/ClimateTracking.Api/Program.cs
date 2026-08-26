using System.Security.Claims;
using ClimateTracking.Api;
using ClimateTracking.Api.Endpoints;
using ClimateTracking.Application.Auth;
using ClimateTracking.Infrastructure.ExternalApi;
using ClimateTracking.Infrastructure.Persistence;
using ClimateTracking.Workers;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("ClimateTracking")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:ClimateTracking configuration.");

builder.Services.AddDbContext<ClimateTrackingDbContext>(options =>
    options.UseNpgsql(connectionString));

var trackingJwtSecret = builder.Configuration["TrackingJwtSecret"]
    ?? throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");

// IsNullOrWhiteSpace, not `?? throw` (#153). appsettings.json ships `"ProcomerCompanyId": ""`,
// so a deployment that forgets to override it has a present-but-blank value: the null check
// this replaced never fired, the host started, and MatchingTenantRequirement was built with
// "" as the tenant everyone is compared against. climate-project-api mints
// `companyId: user.CompanyId?.ToString() ?? string.Empty`, so its company-less super_admins
// carry a blank companyId claim -- which that blank expectation matched, handing every one of
// them this tenant's whole API. Refusing to start is the only safe reading of "no tenant
// configured"; MatchingTenantHandler holds the same line at authorization time.
var procomerCompanyId = builder.Configuration["ProcomerCompanyId"];
if (string.IsNullOrWhiteSpace(procomerCompanyId))
{
    throw new InvalidOperationException("Missing ProcomerCompanyId configuration.");
}

builder.Services.AddClimateProjectClient(new ClimateProjectClientOptions
{
    BaseUrl = builder.Configuration["ClimateProjectBaseUrl"]
        ?? throw new InvalidOperationException("Missing ClimateProjectBaseUrl configuration."),
    InternalApiKey = builder.Configuration["ClimateProjectInternalApiKey"]
        ?? throw new InvalidOperationException("Missing ClimateProjectInternalApiKey configuration."),
    ProcomerCompanyId = procomerCompanyId,
});

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Both values come from TrackingTokenValidation and nothing else is set here, so the
        // contract this service accepts tokens under is one referenceable thing rather than a
        // handful of literals in a startup file (#153). ClimateProject.IntegrationTests
        // compiles against that same type to prove a token minted over there is accepted here.
        options.MapInboundClaims = TrackingTokenValidation.MapInboundClaims;
        options.TokenValidationParameters = TrackingTokenValidation.CreateParameters(trackingJwtSecret);
    });

// ONE PROCESS, TWO JOBS (#219). This host IS the scheduler: CacheSyncWorker and
// DailySemaforoWorker run inside the API image, the deployment #275 chose for climate-project,
// and ClimateTracking.Workers' own Program.cs is kept unbuilt as the documented opt-out.
//
// Not a preference. App Runner requires the container to bind the configured port and pass a
// health check, and ClimateTracking.Workers is a Host, not a WebApplication, so it never binds
// one -- a second App Runner service running the Workers image is not an option that was
// rejected, it is not available. Without this line the tracking service deploys, serves HTTP
// and syncs nothing: the *_cache tables stay empty, so every nodo and persona NAME in the
// plans list and in the .xlsx export renders blank, and no 30-day/15-day/vencimiento
// notification is ever sent.
//
// Safe at any instance count: both jobs tick under a Postgres transaction-scoped advisory
// lease (see IJobLease), so N API instances are exactly one scheduler. That matters most for
// DailySemaforoWorker, whose "already sent?" check is a read followed by a write -- two
// instances without the lease both read "not sent" and the client gets duplicate reminders.
// Workers:Enabled (default true) is read at host start, which is what lets the integration
// suite run every test host with the jobs idle.
builder.Services.AddClimateTrackingWorkers(builder.Configuration);

builder.Services.AddOpenApi();

builder.Services.AddCors();
builder.Services.AddOptions<Microsoft.AspNetCore.Cors.Infrastructure.CorsOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        options.AddPolicy("Frontend", policy => policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod());
    });

builder.Services.AddSingleton<IAuthorizationHandler, MatchingTenantHandler>();
builder.Services.AddSingleton<IAuthorizationHandler, PlanAccessHandler>();
builder.Services.AddAuthorization(options =>
{
    // A token that fails signature/expiry checks is a 401 (JwtBearer handles that before
    // this runs); a validly-signed token for the wrong tenant is a 403 (authorization),
    // so the company check lives here, not in JwtBearerEvents.OnTokenValidated.
    //
    // The isActive assertion is the same shape and here for the same reason: it is a
    // statement about a validly-authenticated caller, so 403. It brings this service level
    // with climate-project-api, whose default policy has refused a token whose own isActive
    // claim says "false" since #280 while this one accepted it -- the two services validate
    // the same tokens off the same shared secret, and an asymmetry in what they will do with
    // one is exactly the class of gap #153 exists to find. HasDeactivatedAccountClaim (not
    // !GetCurrentUser().IsActive) so that an issuer which never wrote the claim is not locked
    // out; its remarks carry the rest.
    //
    // What this does NOT do is end a session that was live when the account was deactivated:
    // the claim is minted from the account's state at mint time and never changes afterwards.
    // That revocation exists only in climate-project-api, as a SecurityStamp this service
    // cannot see, and the window it leaves open here is stated in
    // docs/decisions/cross-service-session-revocation.md rather than papered over by this
    // check.
    options.DefaultPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireAssertion(context => !context.User.HasDeactivatedAccountClaim())
        .AddRequirements(new MatchingTenantRequirement(procomerCompanyId))
        .Build();
});

var app = builder.Build();

app.UseCors("Frontend");

app.UseAuthentication();
app.UseAuthorization();

app.MapOpenApi();

app.MapGet("/", () => Results.Redirect("/health"));

// LIVENESS. Deliberately touches nothing: it answers "is this process up", and it must keep
// answering 200 while the database is unreachable, because that divergence from /ready below is
// how a lost-Postgres instance is told apart from a dead one. Do NOT point the App Runner
// health check at this -- that is the configuration #221 removed from climate-project, and the
// reason is that an instance which has lost Postgres passes it forever and is never replaced.
app.MapGet("/health", () => Results.Ok(new
{
    service = "climate-tracking-api",
    status = "ok"
}));

// READINESS. What App Runner probes (HealthCheckPath in
// infra/aws/climate-tracking-api-prod-service.yml) and what deploy-tracking-prod.yml's
// 20-consecutive-200s canary polls. Mirrors src/ClimateProject.Api/Program.cs rather than
// inventing a second shape, down to the response field names, because the same eyes read both
// during an incident.
//
// It executes a query. A probe that merely checks a connection object exists cannot fail, and
// a probe that cannot fail lets a dead instance serve errors indefinitely -- that is the
// finding recorded in deploy-prod.yml and the whole reason this endpoint is not /health.
//
// No authorization: App Runner sends no bearer token.
app.MapGet("/ready", async (
    ClimateTrackingDbContext dbContext,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    try
    {
        await dbContext.Database.ExecuteSqlRawAsync("SELECT 1", cancellationToken);

        return Results.Ok(new ReadinessResponse(
            Service: "climate-tracking-api",
            Status: "ready",
            Database: "ok"));
    }
    catch (Exception exception)
    {
        // Logged in full, reported as two fixed words. Npgsql's failure messages carry the
        // host, database name and username of whatever it tried to reach, and this endpoint is
        // unauthenticated -- echoing the exception would hand an anonymous caller a
        // description of the production database.
        loggerFactory
            .CreateLogger("ClimateTracking.Api.Readiness")
            .LogError(exception, "Readiness probe failed: database round-trip did not succeed.");

        return Results.Json(
            new ReadinessResponse(
                Service: "climate-tracking-api",
                Status: "not-ready",
                Database: "unreachable"),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

// Commit and BuiltAt are what make this endpoint able to answer "is what's running actually
// what we shipped?". Without them /version was invariant across code changes and could not
// distinguish a successful deploy from one that silently no-op'd -- the failure that let
// climate-project's production sit 156 commits behind main with every signal green.
// scripts/read-deployed-commit.sh, which both deploy workflows use, requires `commit` to be
// 40 hex characters and treats the sentinel "unknown" as a finding rather than a mismatch.
// See BuildInfo.cs.
app.MapGet("/version", () => Results.Ok(new VersionResponse(
    Service: "climate-tracking-api",
    Runtime: Environment.Version.ToString(),
    Environment: app.Environment.EnvironmentName,
    Commit: BuildInfo.CommitSha,
    BuiltAt: BuildInfo.BuildTimestamp)));

app.MapGet("/api/whoami", (ClaimsPrincipal user) => Results.Ok(user.GetCurrentUser()))
    .RequireAuthorization();

app.MapPlanesAccionEndpoints();
app.MapTrackingSheetExportEndpoints();
app.MapDashboardEndpoints();

app.Run();

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment,
    string Commit,
    string BuiltAt);

/// <summary>
/// <c>GET /ready</c>'s body. Same three fields, same values, as climate-project's -- the canary
/// in deploy-tracking-prod.yml prints this body on failure and the two services should not
/// print it differently.
/// </summary>
internal sealed record ReadinessResponse(string Service, string Status, string Database);

public partial class Program;
