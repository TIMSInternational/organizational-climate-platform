using ClimateProject.Application.Notifications;
using ClimateProject.Infrastructure.Email;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Workers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// The worker host's counterpart of <see cref="StartupValidationTests"/> and
/// <see cref="EmailDeliveryRegistrationTests"/> (#275).
///
/// <para>
/// Why the worker needs its own copies of guards the API already proves: the worker host is
/// composed by <c>WorkerHostFactory</c>, not by the API's <c>Program.cs</c>, and it used to
/// register the logging notification stub <em>unconditionally</em> -- a divergence every
/// API-side test was structurally blind to.
/// <see cref="A_configured_provider_replaces_the_stub_in_the_worker_too"/> is the test that
/// fails against that registration, and the stakes are higher here than in the API: a worker
/// has no /health endpoint, no request log and no UI, so six scheduled jobs marking mail
/// "sent" while delivering nothing would be visible nowhere at all.
/// </para>
/// <para>
/// Every host here is built by calling <c>WorkerHostFactory.Create</c> directly, with
/// configuration passed as command-line arguments -- the provider
/// <c>Host.CreateApplicationBuilder</c> registers last, so these values win over whatever
/// appsettings.json happens to sit in the test output directory. That direct call is also why
/// this class does not join the "AppHost" collection: the hazard that collection guards
/// against is <c>HostFactoryResolver</c>'s process-global capture handshake, which only
/// <c>WebApplicationFactory</c> boots go through. (Assembly-level parallelization is disabled
/// anyway; see <c>Support/AssemblyParallelism.cs</c>.)
/// </para>
/// <para>
/// Nothing here is ever dialled. Scheduling is disabled in every test so no job timer ticks
/// against the nonexistent database host, and resolving a sender opens no connection.
/// <c>.ValidateOnStart()</c> runs regardless of that switch -- it is an
/// <c>IStartupValidator</c>, not a hosted service -- which is what lets these tests start a
/// host with every job idle and still observe the fail-fast guard.
/// </para>
/// <para>
/// Mutation-tested 2026-08-15, each guard broken one at a time in <c>WorkerHostFactory</c>,
/// with only the expected tests failing each time:
/// </para>
/// <para>
/// * reverting the <c>INotificationSender</c> factory to the unconditional stub fails
///   <see cref="A_configured_provider_replaces_the_stub_in_the_worker_too"/> and nothing
///   else -- which is the blindness this class exists to end;<br/>
/// * deleting <c>.ValidateOnStart()</c> fails the half-configured test <em>and</em> the
///   warning test, the second because the report is written when the options are first
///   resolved and <c>ValidateOnStart</c> is what forces that resolution to happen at start;<br/>
/// * deleting the <c>EmailDeliveryStartupReport.Write</c> call fails only the warning test;<br/>
/// * narrowing the connection-string guard to <c>is null</c> -- the naive guard the API's
///   startup tests were originally written against, which an empty placeholder slips past --
///   fails only the empty-connection-string test.
/// </para>
/// <para>
/// Re-run that experiment if you touch any of them: this suite has shipped a guard test
/// that passed with its guard removed before.
/// </para>
/// </summary>
public class WorkerStartupValidationTests
{
    private const string ValidConnectionString = "Host=localhost;Database=unused;Username=unused;Password=unused";

    private static string[] ValidArgs(params string[] overrides) =>
    [
        $"--ConnectionStrings:ClimateProject={ValidConnectionString}",
        // Every job idle, so a *started* host spins no timer that would dial the database.
        // WorkerSchedulingOptions.Enabled exists for exactly this "process up, schedule not
        // yet trusted" shape.
        "--Scheduling:Enabled=false",
        .. overrides,
    ];

    private static string[] ConfiguredEmailArgs(params string[] overrides) => ValidArgs(
    [
        "--Email:Provider=smtp",
        "--Email:SmtpHost=smtp.example.invalid",
        "--Email:FromAddress=no-reply@example.com",
        "--Email:AppBaseUrl=https://app.example.com",
        .. overrides,
    ]);

    [Fact]
    public void Empty_connection_string_fails_host_creation()
    {
        // Explicitly empty rather than omitted: appsettings.json files from both referenced
        // hosts race into this test project's output directory, and one of them ships the
        // connection string as "". Overriding to "" pins the branch under test no matter
        // which file won the copy.
        var exception = Record.Exception(
            () => WorkerHostFactory.Create(ValidArgs("--ConnectionStrings:ClimateProject=")));

        Assert.NotNull(exception);
        Assert.True(
            ExceptionChainMentions(exception, "ConnectionStrings:ClimateProject"),
            $"Expected the exception chain to mention ConnectionStrings:ClimateProject. Actual: {exception}");
    }

    /// <summary>
    /// The case the whole email guard exists for, on the host where it matters most. A
    /// provider selected but a value forgotten is not "mail is off": without the guard this
    /// process boots, ticks six jobs, and every one of them records deliveries that never
    /// happened.
    /// </summary>
    [Fact]
    public async Task Half_configured_email_fails_startup_rather_than_ticking_jobs_that_mark_mail_sent()
    {
        using var host = WorkerHostFactory.Create(ValidArgs(
            "--Email:Provider=smtp",
            "--Email:SmtpHost=smtp.example.invalid",
            "--Email:AppBaseUrl=https://app.example.com"));

        var exception = await Record.ExceptionAsync(() => host.StartAsync());

        Assert.NotNull(exception);
        Assert.True(
            ExceptionChainMentions(exception, "Email:FromAddress"),
            $"Expected the exception chain to mention Email:FromAddress (fail-fast startup guard). Actual: {exception}");
    }

    /// <summary>
    /// The unconfigured direction must keep booting -- local development and CI run the
    /// worker with no provider, exactly as they run the API -- and must keep the stub, which
    /// is the correct sender for that state.
    /// </summary>
    [Fact]
    public async Task Unconfigured_email_starts_cleanly_with_the_logging_stub()
    {
        using var host = WorkerHostFactory.Create(ValidArgs());

        await host.StartAsync();
        try
        {
            using var scope = host.Services.CreateScope();

            Assert.IsType<LoggingNotificationSender>(
                scope.ServiceProvider.GetRequiredService<INotificationSender>());
        }
        finally
        {
            await host.StopAsync();
        }
    }

    /// <summary>
    /// Does the selection rule actually take effect in this host? This test fails against the
    /// registration this class was written to kill: the unconditional
    /// <c>AddScoped&lt;INotificationSender, LoggingNotificationSender&gt;()</c> the worker
    /// carried until #275, which every other test in the suite was blind to because the stub
    /// reports success.
    /// </summary>
    [Fact]
    public void A_configured_provider_replaces_the_stub_in_the_worker_too()
    {
        // No start needed: resolving the sender is the assertion, and it opens no connection.
        using var host = WorkerHostFactory.Create(ConfiguredEmailArgs());
        using var scope = host.Services.CreateScope();

        Assert.IsType<EmailNotificationSender>(
            scope.ServiceProvider.GetRequiredService<INotificationSender>());
    }

    /// <summary>
    /// A fully configured provider must start. Nothing is sent during host start, so this
    /// asserts the configuration path, not deliverability -- same caveat as the API's
    /// Fully_configured_email_starts_cleanly.
    /// </summary>
    [Fact]
    public async Task Fully_configured_email_starts_cleanly()
    {
        using var host = WorkerHostFactory.Create(ConfiguredEmailArgs());

        Assert.Null(await Record.ExceptionAsync(() => host.StartAsync()));
        await host.StopAsync();
    }

    /// <summary>
    /// The real sender's dependency chain (transport, options, rate limiter) resolves in this
    /// host. Registration mistakes in that chain are invisible until a job tick tries to
    /// resolve them -- inside ScheduledJobWorker's catch, where the process logs, retries and
    /// keeps reporting itself alive -- so this is the one place they can fail a build instead.
    /// </summary>
    [Fact]
    public void The_rate_limiter_is_shared_across_scopes_so_it_paces_the_whole_process()
    {
        using var host = WorkerHostFactory.Create(ConfiguredEmailArgs());
        using var first = host.Services.CreateScope();
        using var second = host.Services.CreateScope();

        Assert.Same(
            first.ServiceProvider.GetRequiredService<EmailSendRateLimiter>(),
            second.ServiceProvider.GetRequiredService<EmailSendRateLimiter>());
    }

    /// <summary>
    /// The startup report is the worker's only way to say "I will mark mail sent and deliver
    /// none of it" -- the API at least has request logs that go quiet. Asserted through a
    /// provider attached to the host's own ILoggerFactory, because the report is written when
    /// EmailOptions is first resolved, which StartAsync's validator triggers.
    /// </summary>
    [Fact]
    public async Task Unconfigured_email_warns_at_startup()
    {
        using var host = WorkerHostFactory.Create(ValidArgs());
        var provider = new CapturingLoggerProvider();
        host.Services.GetRequiredService<ILoggerFactory>().AddProvider(provider);

        await host.StartAsync();
        await host.StopAsync();

        var warning = Assert.Single(
            provider.Records,
            record => record.Category == WorkerHostFactory.EmailLogCategory
                      && record.Level == LogLevel.Warning);
        Assert.Contains("NOT CONFIGURED", warning.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Same walk as <c>StartupValidationTests.ExceptionChainMentions</c>. Duplicated rather
    /// than shared because that copy is private and these classes deliberately share no
    /// harness -- one boots through WebApplicationFactory, this one does not.
    /// </summary>
    private static bool ExceptionChainMentions(Exception? exception, string text)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current.Message.Contains(text, StringComparison.Ordinal))
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    if (ExceptionChainMentions(inner, text))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private sealed record LogRecord(string Category, LogLevel Level, string Message);

    /// <summary>
    /// A lean cousin of the capturing provider in <see cref="StartupValidationTests"/>:
    /// category, level and rendered message only, because no test here asserts on structured
    /// properties.
    /// </summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<LogRecord> _records = [];

        public IReadOnlyList<LogRecord> Records
        {
            get
            {
                lock (_records)
                {
                    return _records.ToArray();
                }
            }
        }

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, Add);

        // Deliberately not clearing the records: the host disposes its providers, and the
        // test reads them afterwards.
        public void Dispose()
        {
        }

        private void Add(LogRecord record)
        {
            lock (_records)
            {
                _records.Add(record);
            }
        }

        private sealed class CapturingLogger(string category, Action<LogRecord> sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
                => sink(new LogRecord(category, logLevel, formatter(state, exception)));
        }
    }
}
