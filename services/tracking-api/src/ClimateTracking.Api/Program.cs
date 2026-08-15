using System.Security.Claims;
using ClimateTracking.Api.Endpoints;
using ClimateTracking.Application.Auth;
using ClimateTracking.Infrastructure.ExternalApi;
using ClimateTracking.Infrastructure.Persistence;
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
    options.DefaultPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .AddRequirements(new MatchingTenantRequirement(procomerCompanyId))
        .Build();
});

var app = builder.Build();

app.UseCors("Frontend");

app.UseAuthentication();
app.UseAuthorization();

app.MapOpenApi();

app.MapGet("/", () => Results.Redirect("/health"));

app.MapGet("/health", () => Results.Ok(new
{
    service = "climate-tracking-api",
    status = "ok"
}));

app.MapGet("/version", () => Results.Ok(new VersionResponse(
    Service: "climate-tracking-api",
    Runtime: Environment.Version.ToString(),
    Environment: app.Environment.EnvironmentName)));

app.MapGet("/api/whoami", (ClaimsPrincipal user) => Results.Ok(user.GetCurrentUser()))
    .RequireAuthorization();

app.MapPlanesAccionEndpoints();
app.MapDashboardEndpoints();

app.Run();

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment);

public partial class Program;
