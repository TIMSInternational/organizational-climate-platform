using ClimateProject.Application.Email;
using ClimateProject.Application.Notifications;
using ClimateProject.Infrastructure.Email;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ClimateProject.Workers;

/// <summary>
/// Composes the worker host: every registration, every startup guard, every startup log line.
///
/// <para>A factory rather than inline top-level statements so the real composition is what
/// gets tested. The API proves its startup guards through <c>WebApplicationFactory</c>; a
/// generic host has no equivalent harness, and a startup guard nobody can observe failing is
/// not a guard. Tests call <see cref="Create"/> with configuration passed as command-line
/// arguments -- a provider <c>Host.CreateApplicationBuilder</c> registers last, so it wins
/// over appsettings.json -- which means what a test boots is what deploys, minus nothing.</para>
/// </summary>
public static class WorkerHostFactory
{
    /// <summary>
    /// Category for this host's copy of the startup mail-delivery report. Deliberately not
    /// <see cref="EmailDeliveryStartupReport.LogCategory"/>, which names the Api: once both
    /// processes emit the report into a shared log stream, an operator chasing undelivered
    /// mail needs the category to say <em>which process</em> cannot send it.
    /// </summary>
    public const string EmailLogCategory = "ClimateProject.Workers.Email";

    public static IHost Create(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        // This project deliberately ships NO appsettings.json. Since #275 the API references
        // this project to co-host the jobs, and a content file named appsettings.json would be
        // copied transitively into the API's build and publish output, racing the API's own
        // appsettings.json for the same path -- the exact nondeterminism the integration test
        // project already documents on WorkerStartupValidationTests. Everything the deleted
        // file set was the code default anyway, except this log filter, which now lives here:
        // EF logs every SQL command at Information, and a scheduler that executes queries on a
        // timer would otherwise fill its log with them.
        builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);

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

        // The append-only guard is registered here as well as in the API (#143). The worker writes no
        // audit rows today, but "nothing rewrites the audit trail" is not a property if it holds in one
        // of the two processes that hold the database credentials.
        builder.Services.AddDbContext<ClimateProjectDbContext>(options => options
            .UseNpgsql(databasePolicy.ConnectionString)
            .AddInterceptors(AuditLogAppendOnlyInterceptor.Instance));

        // Mail delivery, mirroring the API's Program.cs registrations (#100) -- and the mirror is
        // the entire point of this block. Before it, this host registered the logging stub
        // unconditionally, which in a deployed worker (#275) would have six scheduled jobs marking
        // reminders, digests and dispatches "sent" while delivering nothing, with no /health surface
        // and no UI anywhere to give the game away. Same options, same selection rule, same
        // fail-fast: a half-configured Email section refuses to start this host exactly as it
        // refuses to start the API.
        builder.Services.AddOptions<EmailOptions>()
            .Configure<IConfiguration, ILoggerFactory>((options, configuration, loggerFactory) =>
            {
                configuration.GetSection("Email").Bind(options);

                if (options.Validate() is { } error)
                {
                    throw new InvalidOperationException(error);
                }

                EmailDeliveryStartupReport.Write(loggerFactory.CreateLogger(EmailLogCategory), options);
            })
            .ValidateOnStart();

        // Unwrapped for the reason the API unwraps it: Infrastructure takes EmailOptions directly
        // and stays free of an options dependency.
        builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<EmailOptions>>().Value);

        // Singleton, and that is load-bearing: the rate limiter paces sends process-wide, so a
        // per-scope instance would pace nothing. It paces THIS process only -- the API and each
        // worker instance pace themselves independently -- which is the headroom
        // EmailOptions.DefaultMaxSendsPerSecond already budgets for.
        builder.Services.AddSingleton(sp => new EmailSendRateLimiter(sp.GetRequiredService<EmailOptions>().MaxSendsPerSecond));
        builder.Services.AddScoped<IEmailTransport, SmtpEmailTransport>();

        // The transport registrations above are not optional trimmings on this factory line: the
        // real sender resolves them per scope, so copying the selection rule without them would
        // compile, start, and then die inside every dispatch tick -- at runtime, where
        // ScheduledJobWorker catches, logs and retries forever.
        builder.Services.AddScoped<INotificationSender>(sp => sp.GetRequiredService<EmailOptions>().IsConfigured
            ? ActivatorUtilities.CreateInstance<EmailNotificationSender>(sp)
            : ActivatorUtilities.CreateInstance<LoggingNotificationSender>(sp));

        // IInvitationEmailSender, the API's other delivery seam, is deliberately absent: no job in
        // this host resolves it. InvitationReminderJob raises notification rows, and
        // NotificationDispatchWorker delivers those through INotificationSender.
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

        return host;
    }
}
