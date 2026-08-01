using System.Security.Claims;
using System.Text;
using ClimateTracking.Api.Endpoints;
using ClimateTracking.Application.Auth;
using ClimateTracking.Infrastructure.ExternalApi;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("ClimateTracking")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:ClimateTracking configuration.");

builder.Services.AddDbContext<ClimateTrackingDbContext>(options =>
    options.UseNpgsql(connectionString));

var trackingJwtSecret = builder.Configuration["TrackingJwtSecret"]
    ?? throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");
var procomerCompanyId = builder.Configuration["ProcomerCompanyId"]
    ?? throw new InvalidOperationException("Missing ProcomerCompanyId configuration.");

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
        // Without this, the handler remaps well-known claim names ("sub" -> NameIdentifier
        // URI, "role" -> Role URI, etc.) before CurrentUser reads them by their raw names.
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
