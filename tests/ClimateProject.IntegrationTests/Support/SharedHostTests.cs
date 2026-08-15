using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;

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
/// A test that merely passed against the shared fixture would keep passing if someone
/// reintroduced a per-class factory; asserting the count is what does not.
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

    [Fact]
    public void Touching_the_shared_host_does_not_build_another()
    {
        // Read after the first touch, so the fixture's own build (which may or may not have
        // happened yet in this filtered run) is outside the window being measured.
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
