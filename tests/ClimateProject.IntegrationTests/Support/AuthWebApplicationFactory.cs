using System.Globalization;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace ClimateProject.IntegrationTests.Support;

public class AuthWebApplicationFactory(string connectionString) : WebApplicationFactory<Program>
{
    public const string TestJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
    public const string TestInternalApiKey = "integration-test-internal-api-key";

    private static int _hostsBuilt;
    private static int _callersIssued;

    /// <summary>
    /// How many application hosts this process has built, across every instance of this type.
    ///
    /// <para>
    /// The instrument for #279, kept rather than thrown away: the bug is a count, so the
    /// regression test has to be able to read one. <c>SharedHostTests</c> asserts an absolute
    /// bound on it -- see <see cref="HostBudget"/>. Incremented in <see cref="CreateHost"/>,
    /// which runs exactly once per host, and never in the constructor: constructing a factory
    /// is free, and the whole point of the lazy-host shapes already in this suite is that a
    /// constructed factory need not become a host.
    /// </para>
    /// <para>
    /// The counter is incremented BEFORE the budget below is checked, deliberately. A breach
    /// therefore leaves a reading above the budget rather than throwing the evidence away,
    /// which is what lets <c>SharedHostTests</c>'s bound fail on its own rather than only ever
    /// being fatally pre-empted by the guard in <see cref="CreateHost"/>.
    /// </para>
    /// </summary>
    public static int HostsBuilt => Volatile.Read(ref _hostsBuilt);

    /// <summary>
    /// <b>The whole of #279, expressed as a number the run cannot exceed.</b> Every instance of
    /// this type in this assembly, together, may build this many application hosts in one
    /// process -- not per class, not per collection, per RUN.
    ///
    /// <para>
    /// Nothing outside this type builds one: every test class in the "Postgres" collection
    /// reaches <see cref="PostgresContainerFixture.App"/> instead, and the "AppHost" classes
    /// use a bare <c>WebApplicationFactory&lt;Program&gt;</c> that never passes through here.
    /// So this constant bounds the Postgres collection's host count for the assembly, which is
    /// exactly the quantity #279 is about, and it does so in every filtered run and at every
    /// point in it -- a bound a test reading two snapshots of <see cref="HostsBuilt"/> around
    /// its own work cannot give, because it only ever measures its own window.
    /// </para>
    /// <para>
    /// The seven, and why each is allowed:
    /// <list type="number">
    ///   <item><description>
    ///     <see cref="PostgresContainerFixture"/> -- the one host the whole collection shares.
    ///   </description></item>
    ///   <item><description>
    ///     <c>AuditPoolPressureTests</c> (one <c>[Fact]</c>) -- a connection pool it cannot grow
    ///     out of IS its experiment, so it needs a different connection string.
    ///   </description></item>
    ///   <item><description>
    ///     <c>NotificationEndpointsTests</c> -- three tests (a failing sender, a bouncing sender,
    ///     a command-counting interceptor) whose customised host IS the test. One each.
    ///   </description></item>
    ///   <item><description>
    ///     <c>InvitationEndpointsTests</c> -- one test, and it is the same reason as the three
    ///     above: a host whose <c>IInvitationEmailSender</c> DELIVERS is the test. The shared
    ///     host deliberately configures no mail provider, which is what every other invitation
    ///     test needs and is what production has been running; that host can therefore only
    ///     ever prove the failure direction. Without this one, "an invitation is recorded as
    ///     sent when the provider takes it" is unprovable, and the assertion that it is NOT
    ///     recorded as sent otherwise would be vacuous -- a test that passes because the code
    ///     never writes that status at all would look identical.
    ///   </description></item>
    ///   <item><description>
    ///     <c>BulkImportEndpointsTests</c> -- one test, and the same reason as 4, on the other
    ///     path that now mints invitations (#372). It is not a duplicate of 4: that host proves
    ///     the SINGLE invitation endpoint promotes to sent, and nothing it asserts would notice
    ///     if bulk import committed its invitations and mailed none of them. Proved rather than
    ///     assumed -- deleting the delivery loop from <c>BulkImportEndpoints</c> compiles, leaves
    ///     every row committed, still answers "invited", and is caught by this test alone.
    ///   </description></item>
    /// </list>
    /// </para>
    /// <para>
    /// Raising this number is a decision, not a formality: it is the budget the bug was, and
    /// every unit of it is a <c>HostFactoryResolver</c> capture handshake that must not race
    /// another. If you need one more host, say which of the reasons above yours is like.
    /// </para>
    /// </summary>
    public const int HostBudget = 7;

    /// <summary>
    /// Counts the database commands this application sends. Reset it immediately before the
    /// request under measurement — signup, login and every other setup call go through the
    /// same counter. See <see cref="CommandCountingInterceptor"/> for why round trips are
    /// counted here rather than inferred from generated SQL.
    /// </summary>
    public CommandCountingInterceptor CommandCounter { get; } = new();

    /// <summary>
    /// Builds the host, and refuses to build one past <see cref="HostBudget"/>.
    ///
    /// <para>
    /// The refusal is what makes the bound hold everywhere rather than only where a test
    /// happens to look. A reintroduced per-class factory fails HERE, in the test case that
    /// built the host too many, whatever order xUnit chose and whatever filter the run used --
    /// including a filtered run that never executes <c>SharedHostTests</c> at all.
    /// </para>
    /// </summary>
    protected override IHost CreateHost(IHostBuilder builder)
    {
        var built = Interlocked.Increment(ref _hostsBuilt);
        if (built > HostBudget)
        {
            throw new InvalidOperationException(
                $"This run has built {built} application hosts through {nameof(AuthWebApplicationFactory)}, "
                + $"past the budget of {HostBudget} (#279). Almost always this means a test class went "
                + $"back to `new {nameof(AuthWebApplicationFactory)}(postgres.ConnectionString)` in its "
                + $"constructor: xUnit constructs a class once per [Fact], so that is one host per test "
                + $"CASE, and hundreds of live hosts are what makes the HostFactoryResolver capture "
                + $"handshake time out. Use {nameof(PostgresContainerFixture)}.{nameof(PostgresContainerFixture.App)} "
                + $"instead. If the host really must differ, see the enumeration on {nameof(HostBudget)} "
                + "and raise it deliberately.");
        }

        return base.CreateHost(builder);
    }

    /// <summary>
    /// Gives every <see cref="WebApplicationFactory{TEntryPoint}.CreateClient()"/> its own
    /// rate-limiting identity.
    ///
    /// <para>
    /// <b>This is what makes one shared host safe (#279).</b> Under <c>TestServer</c> there is
    /// no socket, so <c>ClientIpResolver</c> resolves every request to the literal
    /// <c>"unknown"</c> and all of them land in ONE partition. That was harmless while each
    /// test case booted a host of its own -- a fresh host meant a fresh limiter -- and is fatal
    /// the moment the host is shared: <c>RateLimitPolicies.AuthenticationPermitsPerWindow</c>
    /// is 20 per minute, and a suite whose every class signs up and logs in would exhaust that
    /// within the first handful of tests and then 429 for the rest of the run.
    /// </para>
    /// <para>
    /// So each client presents a distinct caller address, restoring exactly the isolation a
    /// per-test host used to give for free. The mechanism is the one this suite already uses to
    /// tell callers apart -- a trusted <c>X-Forwarded-For</c> hop, see
    /// <c>RateLimitingTests.HostBehindOneProxy</c> -- not a stubbed-out limiter, so the
    /// limiting middleware still runs on every request and a policy that starts refusing
    /// legitimate traffic is still caught here.
    /// </para>
    /// <para>
    /// It is per client and not per test because the factory cannot see test boundaries. That
    /// is looser than the old behaviour (two clients in one test no longer share a bucket) and
    /// only ever in the permissive direction. Two tests in this collection drive a limit to its
    /// edge -- <c>LoginRateLimitTests</c> and
    /// <c>SharedHostTests.One_caller_exhausting_the_authentication_limit_does_not_refuse_another</c>
    /// -- and each spends its permits from a single client, so neither is affected. The second
    /// is also the proof of this stamping: mutation-tested twice, at #279 and again after the
    /// address format changed, and it fails (the bystander is refused 429) with the stamping
    /// removed.
    /// </para>
    /// <para>
    /// <b>What this gives up, stated rather than glossed over.</b> This is a real change of
    /// behaviour and not only of plumbing: every test in the "Postgres" collection now runs
    /// against a host configured with <c>RateLimiting:TrustedProxyHopCount = 1</c>, where before
    /// they ran on the shipped default of 0. Two things follow, and both were weighed.
    /// </para>
    /// <para>
    /// First, the hop-count-0 path -- the shipped default, where no header is trusted and every
    /// TestServer caller shares one partition -- is no longer exercised anywhere in this
    /// collection. It was never asserted here either; it was incidental, and a claim about it in
    /// <c>LoginRateLimitTests</c> was wrong even before #279, since that test drives its limit
    /// from a single client. The deliberate coverage is in <c>RateLimitingTests</c>
    /// (<c>Traffic_outside_the_carve_out_is_capped_by_the_global_ceiling</c> fires a limit to
    /// exhaustion on a default-configured host, i.e. through the shared "unknown" partition, and
    /// <c>The_shipped_ceilings_are_far_above_any_human_rate</c> asserts the shipped default IS 0)
    /// and in <c>ClientIpResolverTests</c>, which asserts the no-trust rule directly.
    /// <c>RateLimitingTests</c> is in the "AppHost" collection, which #279 did not touch;
    /// <c>ClientIpResolverTests</c> is in no collection at all, because it boots no host.
    /// <b>Accepted</b>: the coverage that was lost was accidental, and the coverage that names
    /// the behaviour is untouched.
    /// </para>
    /// <para>
    /// Second, the direction of the change is permissive: a header is trusted that would not be
    /// in production-with-no-proxy, so a caller here gets its own bucket where it might have
    /// shared one. It cannot hide a limiter that fails to fire -- the middleware still runs on
    /// every request and every partition still has the shipped permit count -- only a limiter
    /// that fires when partitions are shared. That case is exactly what
    /// <c>RateLimitingTests</c> covers above.
    /// </para>
    /// <para>
    /// The addresses come from the IPv6 documentation prefix 2001:db8::/32 (RFC 3849): unique
    /// per client, guaranteed unroutable, and -- unlike free text -- accepted by
    /// <c>ClientIpResolver</c>, which rejects anything that does not parse as an address. See
    /// <see cref="CallerAddress"/> for why the counter is spread over two groups rather than
    /// one, which is not cosmetic.
    /// </para>
    /// </summary>
    protected override void ConfigureClient(HttpClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        base.ConfigureClient(client);

        client.DefaultRequestHeaders.Add(
            ClientIpResolver.ForwardedForHeaderName,
            CallerAddress(Interlocked.Increment(ref _callersIssued)));
    }

    /// <summary>
    /// The caller address for the <paramref name="caller"/>-th client this process has issued:
    /// a distinct, parseable literal inside 2001:db8::/32.
    ///
    /// <para>
    /// <b>Why two groups, and why this is a separate, tested function.</b> The obvious form,
    /// <c>$"2001:db8::{caller:x}"</c>, is a valid literal only while the counter fits in one
    /// 16-bit group. At 65,536 clients it becomes <c>2001:db8::10000</c> -- five hex digits in
    /// a group that holds four -- which <c>ClientIpResolver.TryNormalise</c> rejects. Nothing
    /// would report that: <c>Resolve</c> falls back to the socket peer, which under
    /// <c>TestServer</c> is the literal <c>"unknown"</c>, so EVERY client from that point on
    /// would collapse into the single 20-permit partition this whole mechanism exists to
    /// avoid, and the suite would fail as an unexplained 429 storm rather than as an error.
    /// Splitting the counter across two groups makes the whole of a positive <c>int</c>
    /// representable, and <c>ThrowIfNegative</c> turns the only remaining way out of that range
    /// -- more than two billion clients in one process -- into a loud failure instead of a
    /// silent one. <c>CallerAddressTests</c> asserts both halves at the 0xFFFF boundary that
    /// used to break, and it is a pure function precisely so that assertion costs no host.
    /// </para>
    /// </summary>
    internal static string CallerAddress(int caller)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(caller);

        return string.Create(
            CultureInfo.InvariantCulture,
            $"2001:db8:{(caller >> 16) & 0xFFFF:x4}:{caller & 0xFFFF:x4}::1");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ClimateProject"] = connectionString,
                ["TrackingJwtSecret"] = TestJwtSecret,
                ["InternalApiKey"] = TestInternalApiKey,
                ["GoogleClientId"] = "test-google-client-id",

                // One trusted hop, so ClientIpResolver reads the X-Forwarded-For that
                // ConfigureClient stamps. Without this the header is ignored (hop count 0
                // trusts nothing) and every client shares one rate-limit partition.
                //
                // This DIFFERS from the shipped default of 0, and from what these tests ran on
                // before #279. It is the production App Runner value, and what it costs is
                // written down on ConfigureClient rather than left for a reader to discover.
                ["RateLimiting:TrustedProxyHopCount"] = "1",

                // Scheduling stays OFF in every host this factory builds (#275). The API
                // co-hosts the six scheduled jobs, and their Enabled switch defaults to true
                // because production must tick with no extra configuration -- but a test host
                // that ticks is a second writer racing every test in this collection: the
                // dispatch worker marking notifications "sent" mid-assertion, retention
                // sweeps deleting rows a test just seeded. Same switch, same value, same
                // reason as WorkerStartupValidationTests' hosts. This override only works
                // because the workers read Enabled lazily, at host start -- see
                // SchedulingServiceCollectionExtensions for why that is load-bearing --
                // and ApiSchedulingCoHostTests proves both directions.
                ["Scheduling:Enabled"] = "false",
            });
        });

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IGoogleTokenVerifier>();
            services.AddScoped<IGoogleTokenVerifier, FakeGoogleTokenVerifier>();

            // ConfigureDbContext, not a second AddDbContext and not AddSingleton<IInterceptor>.
            // The first would be ignored (AddDbContext TryAdds its options) and the second
            // does nothing at all — EF has no convention that discovers loose IInterceptor
            // registrations, which was measured here: the counter read 0 on every route.
            // ConfigureDbContext appends to the options Program.cs already built, so the
            // connection string and everything else stays exactly as the app configured it.
            services.ConfigureDbContext<ClimateProjectDbContext>(
                options => options.AddInterceptors(CommandCounter));
        });
    }

    public async Task ApplyMigrationsAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        await db.Database.MigrateAsync();
    }
}
