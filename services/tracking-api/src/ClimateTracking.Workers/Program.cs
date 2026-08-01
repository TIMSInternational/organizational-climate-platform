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

var cacheSyncIntervalMinutes = builder.Configuration.GetValue<double?>("CacheSyncIntervalMinutes") ?? 15;
builder.Services.AddSingleton<IHostedService>(sp => new CacheSyncWorker(
    sp.GetRequiredService<IServiceScopeFactory>(),
    sp.GetRequiredService<IClimateProjectClient>(),
    sp.GetRequiredService<ILogger<CacheSyncWorker>>(),
    TimeSpan.FromMinutes(cacheSyncIntervalMinutes)));
builder.Services.AddHostedService<DailySemaforoWorker>();

var host = builder.Build();
host.Run();
