using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Scheduling;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// The regression test for #279: the "Postgres" collection must build ONE application host,
/// and sharing it must not make the tests interfere with each other.
///
/// <para>
/// #279 is an intermittent 300s <c>HostFactoryResolver</c> capture timeout that has aborted
/// full runs at 41 and 73 minutes. Its cause is a count -- see
/// <see cref="PostgresContainerFixture"/> for the numbers -- so the guard has to be able to
/// read one, which is what <see cref="AuthWebApplicationFactory.HostsBuilt"/> exists for.
/// </para>
/// <para>
/// <b>What it asserts is an ABSOLUTE bound, and the distinction is the whole point.</b> The
/// first version of this class read <c>HostsBuilt</c> before and after its own five touches
/// of the shared host and asserted the two were equal. That measures a window, not a run: it
/// would have stayed green while some other class in the assembly booted a host per test
/// case, because that class's boots fall outside the window. <c>HostsBuilt</c> is a
/// process-wide monotone counter, so the bound that actually says something is
/// <see cref="AuthWebApplicationFactory.HostBudget"/> -- a ceiling on the whole run, true at
/// every instant of it and therefore assertable at whatever instant this class runs.
/// </para>
/// <para>
/// The bound is enforced twice on purpose, and neither is redundant.
/// <see cref="AuthWebApplicationFactory.CreateHost"/> refuses the boot that breaches it, which
/// is order-independent and works in a filtered run that never executes this class at all;
/// the assertion here is what fails if that refusal is ever softened, and it can fail on its
/// own because the counter is incremented before the refusal.
/// </para>
/// <para>
/// <b>Mutation-proved</b> by reverting <c>LoginEndpointTests</c> (six test cases) to
/// <c>new AuthWebApplicationFactory(postgres.ConnectionString)</c> in its constructor -- a real
/// reintroduction of the bug, in a class the change converted, not a poke at the fixture --
/// and running that class with this one: the refusal threw on the 6th and 7th hosts, and this
/// assertion then failed reading 7. Note what each half proves. The refusal is
/// order-independent; THIS assertion is not, since it can only see boots that happened before
/// it ran, and in that run <c>LoginEndpointTests</c> happened to run first. That is why the
/// refusal is the primary guard and this is the check on the refusal. Mutating
/// <see cref="PostgresContainerFixture.App"/> itself would NOT be a proof of either -- that is
/// the property the sharing tests below assert, so breaking it is a tautology.
/// </para>
/// </summary>
[Collection("Postgres")]
public class SharedHostTests(PostgresContainerFixture postgres)
{
    /// <summary>
    /// The host one earlier test case in this class saw. Static on purpose: xUnit constructs a
    /// new instance of this class for every <c>[Fact]</c>, so a static is the only thing that
    /// can observe whether two instances got the same host, and it is exactly the per-instance
    /// construction that #279 is about.
    /// </summary>
    private static AuthWebApplicationFactory? _hostSeenByAnEarlierTest;

    private static readonly Lock Gate = new();

    /// <summary>
    /// The bound on the run, not on this test's own window. See the class remarks for why the
    /// difference is the entire content of this assertion.
    /// </summary>
    [Fact]
    public void The_run_never_builds_more_application_hosts_than_the_budget()
    {
        // Touch the shared host first so the lower bound is not vacuous: whatever else this
        // filtered run contains, at least the fixture's own host exists by the time we read.
        _ = postgres.App.Services;

        // The reading is process-wide and monotone, so this is a statement about everything the
        // run has built so far, whatever ran before this class. Both ends are asserted: an
        // upper bound alone would still pass against an instrument stuck at zero, which is the
        // way a counter-based guard usually dies.
        Assert.InRange(AuthWebApplicationFactory.HostsBuilt, 1, AuthWebApplicationFactory.HostBudget);
    }

    /// <summary>
    /// The other half of the count: repeatedly reaching for the shared host must not build one.
    /// A window measurement, and honest about being one -- it says the property holds for these
    /// five touches, which is all it can say. The bound above is what covers the run.
    /// </summary>
    [Fact]
    public void Touching_the_shared_host_does_not_build_another()
    {
        _ = postgres.App.Services;
        var before = AuthWebApplicationFactory.HostsBuilt;

        for (var i = 0; i < 5; i++)
        {
            _ = postgres.App.Services;
            postgres.App.CreateClient().Dispose();
        }

        Assert.Equal(before, AuthWebApplicationFactory.HostsBuilt);
    }

    [Fact]
    public void Test_case_one_sees_the_same_host_as_its_sibling() => AssertSameHostAsTheOtherTestCase();

    [Fact]
    public void Test_case_two_sees_the_same_host_as_its_sibling() => AssertSameHostAsTheOtherTestCase();

    /// <summary>
    /// Order-independent by construction: whichever of the two sibling test cases runs first
    /// records the host, and the second compares against it. Both must be present for the
    /// comparison to happen at all, which is why the assertion lives in a helper rather than
    /// in one named test.
    /// </summary>
    private void AssertSameHostAsTheOtherTestCase()
    {
        lock (Gate)
        {
            if (_hostSeenByAnEarlierTest is null)
            {
                _hostSeenByAnEarlierTest = postgres.App;
                return;
            }

            Assert.Same(_hostSeenByAnEarlierTest, postgres.App);
        }
    }

    /// <summary>
    /// The OTHER hazard a shared host acquired with #275: the API co-hosts six scheduled
    /// jobs, and if the factory's <c>Scheduling:Enabled=false</c> ever stopped taking effect,
    /// this host would tick them against the shared database for the whole run -- the
    /// dispatch worker marking notifications "sent" mid-assertion, retention sweeps deleting
    /// rows tests just seeded. Deterministic, not racy: both the disabled early-return and
    /// the enabled path's heartbeat registration run synchronously inside host start (see
    /// <c>ApiSchedulingCoHostTests</c>), so an enabled host reads as non-empty here from its
    /// first instant. Mutation-proved by deleting the factory's override: this fails with
    /// all six jobs registered, and nothing else in a quick filtered run notices.
    /// </summary>
    [Fact]
    public void The_shared_host_runs_with_scheduling_off_so_no_job_ticks_behind_the_tests()
    {
        var heartbeats = postgres.App.Services.GetRequiredService<WorkerHeartbeats>();

        Assert.Empty(heartbeats.Snapshot());
    }

    /// <summary>
    /// The hazard a shared host creates, and the proof that
    /// <see cref="AuthWebApplicationFactory.ConfigureClient"/> closes it.
    ///
    /// <para>
    /// Under <c>TestServer</c> there is no socket peer, so without per-client addressing every
    /// request in the process shares one authentication partition of 20 permits a minute. This
    /// spends that whole partition from one client and then asks whether a second client can
    /// still log in. It is written as one test rather than two because the exhaustion and the
    /// unaffected caller have to be in the same minute-long window to mean anything.
    /// </para>
    /// </summary>
    [Fact]
    public async Task One_caller_exhausting_the_authentication_limit_does_not_refuse_another()
    {
        using var greedy = postgres.App.CreateClient();

        HttpStatusCode last = HttpStatusCode.OK;
        for (var attempt = 0; attempt <= RateLimitPolicies.AuthenticationPermitsPerWindow; attempt++)
        {
            var response = await greedy.PostAsJsonAsync(
                "/auth/login",
                new LoginRequest($"nobody-{Guid.NewGuid():N}@shared-host.test", "not-the-password"));
            last = response.StatusCode;
        }

        // Both halves are asserted: a limit that never fires would make the second half
        // vacuous, and the second half is the one that catches a shared partition.
        Assert.Equal(HttpStatusCode.TooManyRequests, last);

        using var bystander = postgres.App.CreateClient();
        var served = await bystander.PostAsJsonAsync(
            "/auth/login",
            new LoginRequest($"nobody-{Guid.NewGuid():N}@shared-host.test", "not-the-password"));

        Assert.NotEqual(HttpStatusCode.TooManyRequests, served.StatusCode);
    }
}
