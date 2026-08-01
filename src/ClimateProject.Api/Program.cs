using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Cors;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.OrgStructure;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
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
builder.Services.AddDbContext<ClimateProjectDbContext>((sp, options) =>
{
    var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString("ClimateProject");
    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException("Missing ConnectionStrings:ClimateProject configuration.");
    }

    options.UseNpgsql(connectionString);
});

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
    });

builder.Services.AddScoped<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IGoogleTokenVerifier, GoogleTokenVerifier>();
builder.Services.AddScoped<IInvitationEmailSender, LoggingInvitationEmailSender>();

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

app.MapGet("/health", () => Results.Ok(new
{
    service = "climate-project-api",
    status = "ok"
}));

app.MapGet("/version", () => Results.Ok(new VersionResponse(
    Service: "climate-project-api",
    Runtime: Environment.Version.ToString(),
    Environment: app.Environment.EnvironmentName)));

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
app.MapTrackingPickerEndpoints();
app.MapTrackingInternalEndpoints();
app.MapMicroclimateEndpoints();
app.MapMicroclimateTemplateEndpoints();
app.MapReportEndpoints();

app.Run();

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment);

public partial class Program;
