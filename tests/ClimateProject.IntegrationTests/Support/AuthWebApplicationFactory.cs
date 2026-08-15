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
    /// regression test has to be able to read one. <c>SharedHostTests</c> asserts against it.
    /// Incremented in <see cref="CreateHost"/>, which runs exactly once per host, and never in
    /// the constructor -- constructing a factory is free, and the whole point of the lazy-host
    /// shapes already in this suite is that a constructed factory need not become a host.
    /// </para>
    /// </summary>
    public static int HostsBuilt => Volatile.Read(ref _hostsBuilt);

    /// <summary>
    /// Counts the database commands this application sends. Reset it immediately before the
    /// request under measurement — signup, login and every other setup call go through the
    /// same counter. See <see cref="CommandCountingInterceptor"/> for why round trips are
    /// counted here rather than inferred from generated SQL.
    /// </summary>
    public CommandCountingInterceptor CommandCounter { get; } = new();

    protected override IHost CreateHost(IHostBuilder builder)
    {
        Interlocked.Increment(ref _hostsBuilt);
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
    /// only ever in the permissive direction; the one test that drives a limit to its edge,
    /// <c>LoginRateLimitTests</c>, does it on a single client and is unaffected.
    /// <c>SharedHostTests.One_caller_exhausting_the_authentication_limit_does_not_refuse_another</c>
    /// is the proof, and it fails if this stamping is removed.
    /// </para>
    /// <para>
    /// The addresses come from the IPv6 documentation prefix 2001:db8::/32 (RFC 3849): unique
    /// per client, guaranteed unroutable, and -- unlike free text -- accepted by
    /// <c>ClientIpResolver</c>, which rejects anything that does not parse as an address.
    /// </para>
    /// </summary>
    protected override void ConfigureClient(HttpClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        base.ConfigureClient(client);

        var caller = Interlocked.Increment(ref _callersIssued);
        client.DefaultRequestHeaders.Add(
            ClientIpResolver.ForwardedForHeaderName,
            string.Create(CultureInfo.InvariantCulture, $"2001:db8::{caller:x}"));
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
                ["RateLimiting:TrustedProxyHopCount"] = "1",
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
