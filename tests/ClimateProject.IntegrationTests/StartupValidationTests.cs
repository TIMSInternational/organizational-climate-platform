using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// appsettings.json ships secrets/connection-string placeholders as empty
/// strings ("TrackingJwtSecret": "", "ConnectionStrings:ClimateProject": "",
/// "InternalApiKey": "", "GoogleClientId": ""). An empty string is not null, so a
/// naive "?? throw" null-coalescing guard silently lets it through: the app used to
/// start successfully with a zero-length JWT signing key and then 500 on
/// every request (including /health). These tests prove the app instead
/// fails fast at startup -- before accepting any traffic.
///
/// Two distinct branches of the guard, which is
/// string.IsNullOrWhiteSpace(...) in Program.cs:
///   * Empty_   -- the setting is present but "" (what appsettings.json ships)
///   * Missing_ -- the setting is genuinely absent (null)
///
/// Keeping those apart takes care: because appsettings.json ships "", simply
/// omitting the key from a test's in-memory configuration does *not* produce a
/// null, and the two tests silently collapse onto the same branch. See
/// <see cref="ValidConfiguration"/> for the mechanism. Verified originally by narrowing the
/// production guard to "is null" and confirming the two TrackingJwtSecret tests then
/// disagree -- Empty_ fails, Missing_ passes.
///
/// <para>
/// #189 extended this from one setting to four. Only TrackingJwtSecret used
/// AddOptions(...).ValidateOnStart(); ConnectionStrings:ClimateProject, InternalApiKey and the
/// CORS policy all failed at *request* time instead, which is invisible to /health and
/// therefore invisible to a deploy canary. Two consequences for how these tests are written:
/// </para>
/// <para>
/// 1. Because several settings are now validated at startup, every test must supply a
/// complete, valid configuration and override exactly the one setting under test -- otherwise
/// whichever validator happens to run first throws and the assertion passes or fails for the
/// wrong reason. <see cref="ValidConfiguration"/> exists to make that hard to get wrong.
/// </para>
/// <para>
/// 2. Assertions are made on <b>host start</b>, not on a request. See
/// <see cref="CaptureStartupException"/> for why that distinction is load-bearing rather than
/// stylistic.
/// </para>
/// </summary>
[Collection("AppHost")]
public class StartupValidationTests
{
    /// <summary>
    /// How many times to re-attempt a host capture that lost the teardown race. Five, because
    /// the observed rate under heavy load was roughly one attempt in four, which puts five
    /// consecutive losses far below the noise floor of the suite it lives in -- while still
    /// being a bounded number that fails loudly rather than looping.
    /// </summary>
    private const int HostCaptureAttempts = 5;

    private const string ValidConnectionString = "Host=localhost;Database=unused;Username=unused;Password=unused";
    private const string ValidTrackingJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
    private const string ValidInternalApiKey = "integration-test-internal-api-key";
    private const string ValidGoogleClientId = "test-google-client-id";

    // Shaped like the two production connection strings, differing only in the port -- which
    // is the entire difference between the two Supavisor modes, and the entire content of
    // #220. Neither host is ever dialled; startup only reads the port out of the string.
    private const string TransactionPoolerConnectionString =
        "Host=localhost;Port=6543;Database=unused;Username=unused;Password=unused";

    private const string SessionPoolerConnectionString =
        "Host=localhost;Port=5432;Database=unused;Username=unused;Password=unused";

    /// <summary>
    /// A complete configuration that starts the host cleanly, with <paramref name="overrides"/>
    /// applied on top. Every value goes into a single in-memory provider added *after*
    /// appsettings.json, so an override of <see langword="null"/> yields a genuine null rather
    /// than falling back to the "" that appsettings.json ships -- which is what makes the
    /// Missing_ cases distinguishable from the Empty_ cases at all.
    /// </summary>
    private static Dictionary<string, string?> ValidConfiguration(params (string Key, string? Value)[] overrides)
    {
        var configuration = new Dictionary<string, string?>
        {
            // Not exercised by /health (no DbContext is resolved there), but the connection
            // string is validated at startup as of #189, so it must be present and non-empty in
            // every test that is not specifically testing its absence.
            ["ConnectionStrings:ClimateProject"] = ValidConnectionString,
            ["TrackingJwtSecret"] = ValidTrackingJwtSecret,
            ["InternalApiKey"] = ValidInternalApiKey,
            ["GoogleClientId"] = ValidGoogleClientId,
            // The API co-hosts the scheduled jobs (#275). The hosts in this class that DO
            // start must not tick them against the unused connection string; a test that
            // wants the jobs on says so through an override, like every other setting here.
            ["Scheduling:Enabled"] = "false",
        };

        foreach (var (key, value) in overrides)
        {
            configuration[key] = value;
        }

        return configuration;
    }

    /// <summary>
    /// Starts the host and returns whatever it threw, <b>without issuing a request</b>.
    /// </summary>
    /// <remarks>
    /// <c>CreateClient()</c> builds and starts the host (WebApplicationFactory's EnsureServer
    /// calls Host.Start), which runs the options-validation hosted service. No HTTP request is
    /// sent, so a failure observed here can only have come from startup.
    /// <para>
    /// Note it must be <c>CreateClient()</c> and not <c>factory.Services</c>, even though the
    /// latter reads as the more direct way to say "just start the host". When Host.Start throws,
    /// WebApplicationFactory disposes the provider, and a subsequent read of the Services
    /// property then throws ObjectDisposedException *instead of* the real startup exception --
    /// intermittently, depending on internal ordering. That passed locally three times and
    /// failed once in CI on Empty_GoogleClientId_fails_startup_when_google_auth_is_required,
    /// reporting "Cannot access a disposed object" while the log showed the intended
    /// "Missing GoogleClientId configuration" had been raised correctly. CreateClient()
    /// propagates the original exception and is the path the original two tests here used
    /// reliably for months. Do not "simplify" this back to factory.Services.
    /// </para>
    /// <para>
    /// That distinction is the whole point. These tests originally asserted through a
    /// GET /health, which conflates "fails at startup" with "fails on the first request" -- and
    /// those genuinely differ for the settings #189 is about, since /health resolves no
    /// DbContext and no internal-API filter.
    /// </para>
    /// <para>
    /// Guard-the-guard result, measured rather than assumed. Deleting .ValidateOnStart() from
    /// the four registrations added by #189 fails <b>6 of these 9</b> fail-fast tests:
    /// both ConnectionString cases, both InternalApiKey cases, and both
    /// GoogleClientId-when-required cases. Three still pass, each for a known reason:
    /// </para>
    /// <para>
    /// * the two TrackingJwtSecret cases -- JwtBearerOptions keeps its own ValidateOnStart, which
    ///   the experiment does not touch;<br/>
    /// * the CORS case -- CorsOptions is *already* resolved during Host.Start, because
    ///   UseCors("Frontend") constructs CorsMiddleware while the pipeline is built and
    ///   DefaultCorsPolicyProvider resolves IOptions&lt;CorsOptions&gt; in its constructor. That
    ///   test therefore documents real behaviour but does not prove ValidateOnStart does
    ///   anything for CorsOptions -- and the call is labelled as belt-and-braces in Program.cs
    ///   for exactly that reason.
    /// </para>
    /// <para>
    /// If you add a setting here, run that experiment on it too. A startup-validation test that
    /// passes without the startup validation is worse than no test.
    /// </para>
    /// </remarks>
    private static Exception? CaptureStartupException(Dictionary<string, string?> configuration)
    {
        Exception? captured = null;

        for (var attempt = 1; attempt <= HostCaptureAttempts; attempt++)
        {
            captured = CaptureStartupExceptionOnce(configuration);

            if (!IsHostCaptureRace(captured))
            {
                return captured;
            }
        }

        // Never silently pass. If every attempt lost the race we have learned nothing about
        // the guard under test, and saying so is the only honest outcome.
        Assert.Fail(
            $"The host-capture handshake lost its race on all {HostCaptureAttempts} attempts, so the "
            + "startup guard could not be observed. This is infrastructure, not the guard: see "
            + $"{nameof(IsHostCaptureRace)}. Last exception: {captured}");
        return captured;
    }

    private static Exception? CaptureStartupExceptionOnce(Dictionary<string, string?> configuration)
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(configuration));
        });

        // No request is issued -- CreateClient() only builds/starts the host and hands back an
        // HttpClient. That is what separates "failed at startup" from "failed on first request".
        return Record.Exception(() => factory.CreateClient());
    }

    /// <summary>
    /// True for the one failure that means "we never got to see the guard", as opposed to
    /// "the guard did not fire".
    ///
    /// <para>
    /// Program.cs uses top-level statements, so <c>WebApplicationFactory</c> cannot call a
    /// builder method -- it goes through <c>HostFactoryResolver</c>, which runs the entry point
    /// on a background thread and hands the captured <c>IHost</c> to a <c>DeferredHost</c>.
    /// These tests deliberately configure the app to <b>throw during startup</b>, so two threads
    /// then race: the entry point tearing the half-built host down, and
    /// <c>DeferredHost.StartAsync</c> reading <c>_host.Services</c> to start it. When teardown
    /// wins, the caller gets <c>ObjectDisposedException: 'IServiceProvider'</c> instead of the
    /// real validation failure -- the guard did fire, we just could not see it.
    /// </para>
    /// <para>
    /// Why a retry is safe here, which is the part worth checking before touching this:
    /// it can only ever convert *this* signature into another attempt. A guard that has been
    /// deleted produces <b>no exception at all</b>, and a guard that fires for the wrong reason
    /// produces a real exception with the wrong text; neither matches, so both still fail on the
    /// first attempt. The "delete .ValidateOnStart() and watch 6 of 9 fail" experiment described
    /// above therefore still holds -- re-run it if you change this.
    /// </para>
    /// <para>
    /// Measured 2026-08-06. The flake had been CI-only and was documented in
    /// <c>Support/AppHostCollection.cs</c> as never reproducible locally. It reproduces under
    /// load: with an unrelated Testcontainers suite saturating the machine, these three classes
    /// failed <b>2 runs in 5</b>; on an idle machine, <b>0 in 15</b>. That is also why the
    /// AppHost collection alone was not enough -- it serialises these three against each other,
    /// but this race needs no second host at all, only a slow enough machine. A 2-core CI runner
    /// running the full suite is exactly that.
    /// </para>
    /// </summary>
    private static bool IsHostCaptureRace(Exception? exception)
        => exception is ObjectDisposedException disposed
           && (disposed.ObjectName == "IServiceProvider"
               || disposed.Message.Contains("IServiceProvider", StringComparison.Ordinal));

    /// <summary>
    /// The category Program.cs logs the #220 startup findings under (its
    /// <c>DatabaseStartupLogCategory</c> constant). Duplicated as a literal because Program.cs
    /// uses top-level statements, so a local const in it is not addressable from here.
    /// </summary>
    private const string DatabaseStartupLogCategory = "ClimateProject.Api.Database";

    /// <summary>
    /// Starts the host with a capturing <see cref="ILoggerProvider"/> attached and returns
    /// everything logged while it started. Used for the guards whose only production-visible
    /// effect is a log line, which <see cref="CaptureStartupException"/> cannot observe at all.
    /// </summary>
    /// <remarks>
    /// Same no-request discipline as <see cref="CaptureStartupException"/>: <c>CreateClient()</c>
    /// builds and starts the host and nothing else is sent, so every record returned was emitted
    /// during startup. No retry loop, because these configurations are the ones that start
    /// <em>cleanly</em> — the teardown race documented on <see cref="IsHostCaptureRace"/> only
    /// exists when startup throws.
    /// </remarks>
    private static IReadOnlyList<LogRecord> CaptureStartupLogs(Dictionary<string, string?> configuration)
    {
        var provider = new CapturingLoggerProvider();

        using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(configuration));
            builder.ConfigureLogging(logging => logging.AddProvider(provider));
        }))
        {
            using var client = factory.CreateClient();
        }

        return provider.Records;
    }

    private sealed record LogRecord(
        string Category,
        LogLevel Level,
        string Message,
        IReadOnlyDictionary<string, object?> Properties);

    /// <summary>
    /// Records every entry, keeping the structured state separate from the rendered message so
    /// a test can assert on a named property rather than on a substring of the sentence.
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

        // Deliberately not clearing the records: the host disposes its providers, and the test
        // reads them afterwards.
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
            {
                var properties = new Dictionary<string, object?>(StringComparer.Ordinal);

                if (state is IReadOnlyList<KeyValuePair<string, object?>> values)
                {
                    foreach (var (key, value) in values)
                    {
                        // "{OriginalFormat}" is the unrendered template, not a property.
                        if (key != "{OriginalFormat}")
                        {
                            properties[key] = value;
                        }
                    }
                }

                sink(new LogRecord(category, logLevel, formatter(state, exception), properties));
            }
        }
    }

    private static void AssertFailsStartupMentioning(
        Dictionary<string, string?> configuration,
        string expectedMention)
    {
        var exception = CaptureStartupException(configuration);

        Assert.NotNull(exception);
        Assert.True(
            ExceptionChainMentions(exception, expectedMention),
            $"Expected the exception chain to mention {expectedMention} (fail-fast startup guard). Actual: {exception}");
    }

    [Fact]
    public void Empty_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("TrackingJwtSecret", string.Empty)),
            "TrackingJwtSecret");

    [Fact]
    public void Missing_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("TrackingJwtSecret", null)),
            "TrackingJwtSecret");

    [Fact]
    public void Empty_ConnectionString_fails_startup_instead_of_500ing_every_db_route() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("ConnectionStrings:ClimateProject", string.Empty)),
            "ConnectionStrings:ClimateProject");

    [Fact]
    public void Missing_ConnectionString_fails_startup_instead_of_500ing_every_db_route() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("ConnectionStrings:ClimateProject", null)),
            "ConnectionStrings:ClimateProject");

    [Fact]
    public void Empty_InternalApiKey_fails_startup_instead_of_500ing_every_internal_route() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("InternalApiKey", string.Empty)),
            "InternalApiKey");

    [Fact]
    public void Missing_InternalApiKey_fails_startup_instead_of_500ing_every_internal_route() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("InternalApiKey", null)),
            "InternalApiKey");

    /// <summary>
    /// CorsOriginMatcher throws on a wildcard pattern containing no '*'. Without ValidateOnStart
    /// on CorsOptions that throw lands on the first request through UseCors, so a typo in
    /// Cors:AllowedWildcardOrigins boots a service that 500s every request.
    /// </summary>
    [Fact]
    public void Malformed_wildcard_cors_origin_fails_startup_instead_of_500ing_every_request() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("Cors:AllowedWildcardOrigins:0", "https://no-star.example.com")),
            "must contain '*'");

    /// <summary>
    /// GoogleClientId is conditionally required -- see GoogleAuthOptions. With
    /// GoogleAuth:Required false (the default, and what appsettings.json ships) a
    /// Google-disabled environment must still start, because failing there would be wrong.
    /// This is the test that stops a future "make it consistent with the others" change from
    /// silently breaking every deployment that does not use Google sign-in.
    /// </summary>
    [Fact]
    public void Missing_GoogleClientId_does_not_fail_startup_when_google_auth_is_not_required()
    {
        var exception = CaptureStartupException(
            ValidConfiguration(("GoogleClientId", null), ("GoogleAuth:Required", "false")));

        Assert.Null(exception);
    }

    [Fact]
    public void Empty_GoogleClientId_fails_startup_when_google_auth_is_required() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("GoogleClientId", string.Empty), ("GoogleAuth:Required", "true")),
            "GoogleClientId");

    [Fact]
    public void Missing_GoogleClientId_fails_startup_when_google_auth_is_required() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(("GoogleClientId", null), ("GoogleAuth:Required", "true")),
            "GoogleClientId");

    // -- Database:RequireSessionPooler, the #220 ratchet. ---------------------------------
    //
    // Same conditional shape as GoogleAuth:Required above, for a different reason. The
    // defect is a Secrets Manager value this repository cannot edit: production's runtime
    // connection string is on Supabase's transaction pooler (port 6543), which Npgsql's
    // connection pool cannot use safely, and roughly half of all /ready probes hang for
    // thirty seconds as a result. The flag is what lets the guard be armed *after* that
    // value is fixed rather than before, and these three tests pin each step of that
    // sequence -- including, crucially, that the last step is safe to take.
    //
    // No database is contacted by any of them: nothing resolves a DbContext during startup,
    // so the port in the connection string is read and judged but never dialled.

    /// <summary>
    /// Step 1, and the state production is in today: the port is wrong, the guard is not
    /// armed, and the service must still start. Arming the guard before the secret is fixed
    /// would turn an intermittently-slow service into a service that fails its App Runner
    /// health check and rolls back, so this test is what stops a future "make it consistent
    /// with the other guards" change from taking production down.
    /// </summary>
    [Fact]
    public void Transaction_pooler_port_does_not_fail_startup_when_session_pooler_is_not_required()
    {
        var exception = CaptureStartupException(ValidConfiguration(
            ("ConnectionStrings:ClimateProject", TransactionPoolerConnectionString),
            ("Database:RequireSessionPooler", "false")));

        Assert.Null(exception);
    }

    /// <summary>
    /// Step 3, the ratchet itself: once armed, the transaction pooler is a startup failure
    /// rather than a log line nobody reads. #220 survived for weeks precisely because the
    /// only signal was a warning in the deploy log.
    /// </summary>
    [Fact]
    public void Transaction_pooler_port_fails_startup_when_session_pooler_is_required() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(
                ("ConnectionStrings:ClimateProject", TransactionPoolerConnectionString),
                ("Database:RequireSessionPooler", "true")),
            "TRANSACTION pooler");

    /// <summary>
    /// The end state, and the test that makes step 3 safe to perform: with the secret on the
    /// session pooler, arming the guard changes nothing about whether the host starts. If
    /// this ever fails, arming the flag in
    /// <c>infra/aws/climate-project-api-prod-service.yml</c> would break the deploy.
    /// </summary>
    [Fact]
    public void Session_pooler_port_starts_cleanly_with_the_guard_armed()
    {
        var exception = CaptureStartupException(ValidConfiguration(
            ("ConnectionStrings:ClimateProject", SessionPoolerConnectionString),
            ("Database:RequireSessionPooler", "true")));

        Assert.Null(exception);
    }

    /// <summary>
    /// Step 2's acceptance signal, and the only #220 behaviour production actually executes
    /// today — the flag ships as <c>false</c>, so the warning below is 100% of what the guard
    /// does on the live service.
    ///
    /// <para>
    /// It needs its own test because <c>infra/aws/README.md</c> makes this log line the gate on
    /// step 2 ("Confirm also that the <c>TRANSACTION pooler</c> warning is <b>gone</b> from the
    /// App Runner logs"), and a gate whose absence nobody checks passes vacuously. Nothing else
    /// can see it: measured 2026-08-10 by making the <c>Warn</c> branch in Program.cs
    /// unreachable, this test was the <em>only</em> failure anywhere — the other 17 tests in
    /// this class and all 1086 unit tests stayed green with the guard's entire
    /// production-visible output deleted.
    /// </para>
    /// <para>
    /// <c>Port</c> and <c>ExpectedPort</c> are asserted as structured properties rather than as
    /// substrings of the rendered text, because that is the difference the assertion is meant
    /// to protect: a log aggregator can filter on <c>Port = 6543</c> only while they are
    /// separate arguments to <c>LogWarning</c>.
    /// </para>
    /// </summary>
    [Fact]
    public void Transaction_pooler_port_warns_at_startup_when_session_pooler_is_not_required()
    {
        var records = CaptureStartupLogs(ValidConfiguration(
            ("ConnectionStrings:ClimateProject", TransactionPoolerConnectionString),
            ("Database:RequireSessionPooler", "false")));

        var warning = Assert.Single(
            records,
            record => record.Category == DatabaseStartupLogCategory && record.Level == LogLevel.Warning);

        Assert.Contains("TRANSACTION pooler", warning.Message, StringComparison.Ordinal);
        Assert.Contains("#220", warning.Message, StringComparison.Ordinal);
        Assert.Contains("Database:RequireSessionPooler", warning.Message, StringComparison.Ordinal);
        Assert.True(warning.Properties.TryGetValue("Port", out var port), "Port is not a log property.");
        Assert.Equal("6543", port?.ToString());
        Assert.True(
            warning.Properties.TryGetValue("ExpectedPort", out var expectedPort),
            "ExpectedPort is not a log property.");
        Assert.Equal("5432", expectedPort?.ToString());
    }

    /// <summary>
    /// The other half of step 2's acceptance signal: once the secret is on the session pooler
    /// the warning must actually stop, otherwise "the warning is gone" is not a usable check on
    /// whether the new value was read. Pairs with the test above — together they pin that the
    /// log line tracks the port rather than being emitted (or suppressed) unconditionally.
    /// </summary>
    [Fact]
    public void Session_pooler_port_emits_no_transaction_pooler_warning()
    {
        var records = CaptureStartupLogs(ValidConfiguration(
            ("ConnectionStrings:ClimateProject", SessionPoolerConnectionString),
            ("Database:RequireSessionPooler", "false")));

        Assert.DoesNotContain(
            records,
            record => record.Category == DatabaseStartupLogCategory
                      && record.Level == LogLevel.Warning);
    }

    /// <summary>
    /// Mail configuration is conditionally required in the same shape GoogleClientId is
    /// (#100). Local development, CI and this very suite all run with no provider, so absent
    /// mail configuration must start cleanly -- the whole integration suite would otherwise
    /// stop booting.
    /// </summary>
    [Fact]
    public void Missing_email_configuration_does_not_fail_startup()
    {
        Assert.Null(CaptureStartupException(ValidConfiguration(("Email:Provider", null))));
    }

    /// <summary>
    /// The case this guard exists for. A provider selected but a required value forgotten is
    /// not "mail is off": it is a service that boots, reports healthy, marks every
    /// notification <c>sent</c>, and delivers nothing -- the #189 failure one setting further
    /// along.
    /// </summary>
    [Fact]
    public void Half_configured_email_fails_startup_rather_than_silently_dropping_mail() =>
        AssertFailsStartupMentioning(
            ValidConfiguration(
                ("Email:Provider", "smtp"),
                ("Email:SmtpHost", "smtp.example.com"),
                ("Email:AppBaseUrl", "https://app.example.com")),
            "Email:FromAddress");

    /// <summary>
    /// A fully configured provider starts. It never connects here -- nothing is sent during
    /// host start -- so this asserts the configuration path, not deliverability.
    ///
    /// <para>
    /// Only three email cases live in this class, and that is deliberate: every host boot here
    /// is a boot of the structural hazard <c>AppHostCollection</c> documents, so what belongs
    /// in an integration test is that <c>EmailOptions.Validate</c> is <em>reached at startup</em>
    /// and that a valid configuration boots. Which individual setting produces which message is
    /// exhaustively covered by <c>EmailOptionsTests</c>, which needs no host at all.
    /// </para>
    /// </summary>
    [Fact]
    public void Fully_configured_email_starts_cleanly()
    {
        Assert.Null(CaptureStartupException(ValidConfiguration(
            ("Email:Provider", "smtp"),
            ("Email:SmtpHost", "smtp.example.com"),
            ("Email:FromAddress", "no-reply@example.com"),
            ("Email:AppBaseUrl", "https://app.example.com"))));
    }

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
}
