using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Infrastructure.ExternalApi;
using ClimateTracking.Infrastructure.Persistence;
using ClimateTracking.Workers;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("ClimateTracking")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:ClimateTracking configuration.");

builder.Services.AddDbContext<ClimateTrackingDbContext>(options =>
    options.UseNpgsql(connectionString));

// IsNullOrWhiteSpace, not `?? throw`, for the reason ClimateTracking.Api/Program.cs gives at
// length (#153): appsettings.json ships this blank, so the null check never fired. The damage
// here is different from the Api's -- a blank tenant is passed to ClimateProjectClient, whose
// every call becomes `?company_id=` against climate-project-api, so the cache sync 400s or
// silently syncs nothing rather than over-authorising -- but the misconfiguration is the same
// one, and it should be refused in the same place: before the host starts.
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

var cacheSyncIntervalMinutes = builder.Configuration.GetValue<double?>("CacheSyncIntervalMinutes") ?? 15;
builder.Services.AddSingleton<IHostedService>(sp => new CacheSyncWorker(
    sp.GetRequiredService<IServiceScopeFactory>(),
    sp.GetRequiredService<IClimateProjectClient>(),
    sp.GetRequiredService<ILogger<CacheSyncWorker>>(),
    TimeSpan.FromMinutes(cacheSyncIntervalMinutes)));
builder.Services.AddHostedService<DailySemaforoWorker>();

var host = builder.Build();
host.Run();
