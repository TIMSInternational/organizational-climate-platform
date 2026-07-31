using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text;

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
    var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString("ClimateProject")
        ?? throw new InvalidOperationException("Missing ConnectionStrings:ClimateProject configuration.");
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
        var trackingJwtSecret = configuration["TrackingJwtSecret"]
            ?? throw new InvalidOperationException("Missing TrackingJwtSecret configuration.");

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
    });

builder.Services.AddAuthorization();

builder.Services.AddScoped<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();

builder.Services.AddOpenApi();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

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

app.Run();

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment);

public partial class Program;
