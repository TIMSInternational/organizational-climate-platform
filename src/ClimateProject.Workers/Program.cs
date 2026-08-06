using ClimateProject.Application.Notifications;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Workers;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

// Same connection string, same policy as the API (#220): the pool bound, and the Supavisor
// transaction-pooler port reported. A worker is if anything more exposed to the unbounded-pool
// problem than a request handler, because each tick holds a connection for the whole of a
// transaction rather than for the whole of a request.
var connectionString = builder.Configuration.GetConnectionString("ClimateProject");
if (string.IsNullOrWhiteSpace(connectionString))
{
    // Refusing to start beats starting and silently never sending anything, which is the exact
    // failure mode #101 exists to prevent -- and a worker has no /health endpoint to give the
    // game away.
    throw new InvalidOperationException("Missing ConnectionStrings:ClimateProject configuration.");
}

var databasePolicy = DatabaseConnectionStringPolicy.Apply(connectionString);

builder.Services.AddDbContext<ClimateProjectDbContext>(options =>
    options.UseNpgsql(databasePolicy.ConnectionString));

// The same stub the API registers. Replacing it with a real provider is #100, in one place for
// both hosts.
builder.Services.AddScoped<INotificationSender, LoggingNotificationSender>();

builder.Services.AddClimateProjectScheduling(builder.Configuration);

var host = builder.Build();

var startupLogger = host.Services.GetRequiredService<ILoggerFactory>()
    .CreateLogger("ClimateProject.Workers.Startup");

if (databasePolicy.UsesTransactionPoolerPort)
{
    // Warning, not a throw, for the same reason as the API's identical guard: the value lives
    // in Secrets Manager, not in this repository, and refusing to boot would stop the
    // scheduler in order to complain about something the deploy cannot fix. See #220.
    startupLogger.LogWarning(
        "Database connection string uses port {Port}, the Supabase Supavisor TRANSACTION pooler. Scheduled jobs hold " +
        "a transaction open across statements and take transaction-scoped advisory locks, neither of which " +
        "transaction pooling supports reliably. Expected port {ExpectedPort} (the SESSION pooler).",
        databasePolicy.Port,
        DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort);
}

if (databasePolicy.MaxPoolSizeApplied)
{
    startupLogger.LogInformation(
        "Applied default Npgsql Maximum Pool Size of {MaxPoolSize}; the connection string did not specify one.",
        databasePolicy.MaxPoolSize);
}

host.Run();
