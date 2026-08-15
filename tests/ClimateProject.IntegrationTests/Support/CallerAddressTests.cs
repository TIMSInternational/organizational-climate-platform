using System.Net;
using ClimateProject.Api.Infrastructure;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// The per-client caller address <see cref="AuthWebApplicationFactory.ConfigureClient"/> stamps,
/// asserted at the boundary where the obvious implementation stopped being a valid address.
///
/// <para>
/// <b>Why this is worth a test class of its own.</b> Exhausting the address space is a SILENT
/// failure, which is the only kind worth building a guard for. If the stamped header does not
/// parse, <c>ClientIpResolver.Resolve</c> does not complain -- it falls back to the socket peer,
/// which under <c>TestServer</c> is the literal <c>"unknown"</c>, so every client from that
/// moment on shares one 20-permit authentication partition. That is precisely the failure the
/// stamping exists to prevent, and it would arrive as a 429 storm somewhere unrelated rather
/// than as an error here.
/// </para>
/// <para>
/// No collection attribute and no fixture: these are pure functions of an integer, they boot no
/// host and touch no database, and pinning them to the "Postgres" collection would make a
/// string comparison require Docker. <c>ClientIpResolverTests</c> is already shaped this way.
/// </para>
/// </summary>
public class CallerAddressTests
{
    /// <summary>
    /// Every caller number this process can reach must produce a literal the resolver accepts.
    ///
    /// <para>
    /// The rows are the boundary and its neighbours, not a sample: 0xFFFF is the last caller the
    /// single-group form <c>2001:db8::{caller:x}</c> could represent, and 0x10000 is the first
    /// one it could not -- <c>2001:db8::10000</c>, five hex digits in a 16-bit group. That row
    /// is the regression. <see cref="int.MaxValue"/> is the far end of what
    /// <c>Interlocked.Increment</c> on an <see cref="int"/> can hand out.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(0xFFFF)]
    [InlineData(0x10000)]
    [InlineData(int.MaxValue)]
    public void A_caller_address_parses_and_survives_the_resolver(int caller)
    {
        var address = AuthWebApplicationFactory.CallerAddress(caller);

        // Half one: it is an address at all. IPAddress.TryParse is exactly what
        // ClientIpResolver.TryNormalise runs, so this is that check and not a lookalike.
        Assert.True(
            IPAddress.TryParse(address, out var parsed),
            $"Caller {caller} produced '{address}', which is not a valid IP literal.");

        // Half two: the resolver, configured the way AuthWebApplicationFactory configures the
        // host, returns THIS address rather than falling back to the socket peer. Asserting on
        // the returned key is what catches the silent fallback -- the failure has no exception
        // to assert on, only a wrong partition key.
        Assert.True(
            ClientIpResolver.TryReadForwardedFor([address], trustedProxyHopCount: 1, out var resolved),
            $"The resolver refused '{address}', so every client would fall back to one partition.");
        Assert.Equal(parsed, IPAddress.Parse(resolved));

        // And it stays inside the documentation prefix, so no test can ever address a real host.
        Assert.StartsWith("2001:db8:", address, StringComparison.Ordinal);
    }

    /// <summary>
    /// Distinct callers get distinct partitions -- the property the stamping exists for. Run
    /// across the 16-bit boundary, because that is where a formatting mistake would first make
    /// two callers collide.
    /// </summary>
    [Fact]
    public void No_two_callers_share_an_address_across_the_group_boundary()
    {
        var addresses = Enumerable.Range(0xFFFE, 4)
            .Concat([0, 1, 0x7FFF_FFFF])
            .Select(AuthWebApplicationFactory.CallerAddress)
            .ToArray();

        Assert.Equal(addresses.Length, addresses.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// The one way out of the representable range fails loudly rather than silently. A negative
    /// caller number means <c>Interlocked.Increment</c> wrapped past <see cref="int.MaxValue"/>,
    /// which needs more than two billion clients in one process; the point is that if it ever
    /// happens the run says so instead of quietly sharing a bucket.
    /// </summary>
    [Fact]
    public void A_caller_number_outside_the_representable_range_throws()
        => Assert.Throws<ArgumentOutOfRangeException>(() => AuthWebApplicationFactory.CallerAddress(-1));
}
