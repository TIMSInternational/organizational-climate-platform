using System.Net;
using ClimateProject.Api.Infrastructure;
using Microsoft.AspNetCore.Http;

namespace ClimateProject.IntegrationTests.Security;

/// <summary>
/// The partition key every address-keyed rate limit in the app is built from (#146).
///
/// <para>
/// These are the tests that stand in for a production-shaped deployment: behind App Runner
/// the socket peer is an AWS proxy, so <c>Connection.RemoteIpAddress</c> is the same value
/// for every caller in the world, and a per-address limit built on it throttles everyone
/// together. Nothing available here can observe App Runner, so what is asserted instead is
/// the exact rule the deployment relies on -- and, just as importantly, that the default
/// configuration trusts no header at all.
/// </para>
/// </summary>
public class ClientIpResolverTests
{
    private static HttpContext ContextWith(string? socketPeer, params string[] forwardedForValues)
    {
        var context = new DefaultHttpContext();

        if (socketPeer is not null)
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse(socketPeer);
        }

        if (forwardedForValues.Length > 0)
        {
            context.Request.Headers[ClientIpResolver.ForwardedForHeaderName] = forwardedForValues;
        }

        return context;
    }

    [Fact]
    public void Default_configuration_ignores_the_forwarded_header_entirely()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 0);

        var key = resolver.Resolve(ContextWith("10.0.0.9", "203.0.113.7"));

        Assert.Equal("10.0.0.9", key);
    }

    [Fact]
    public void One_trusted_proxy_uses_the_last_forwarded_entry_rather_than_the_socket_peer()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith("10.0.0.9", "203.0.113.7"));

        Assert.Equal("203.0.113.7", key);
    }

    [Fact]
    public void A_client_supplied_prefix_cannot_displace_the_entry_the_trusted_proxy_appended()
    {
        // The attack this defends: the caller sends its own X-Forwarded-For hoping to choose
        // its bucket. The trusted proxy appends the address it actually saw, so counting from
        // the right is the only direction that is not attacker-controlled.
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith("10.0.0.9", "1.1.1.1, 2.2.2.2", "203.0.113.7"));

        Assert.Equal("203.0.113.7", key);
    }

    [Fact]
    public void Two_trusted_proxies_step_two_entries_in_from_the_right()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 2);

        var key = resolver.Resolve(ContextWith("10.0.0.9", "198.51.100.4, 203.0.113.7"));

        Assert.Equal("198.51.100.4", key);
    }

    [Fact]
    public void A_missing_header_falls_back_to_the_socket_peer()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith("10.0.0.9"));

        Assert.Equal("10.0.0.9", key);
    }

    [Fact]
    public void Too_few_entries_for_the_configured_hop_count_falls_back_to_the_socket_peer()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 3);

        var key = resolver.Resolve(ContextWith("10.0.0.9", "203.0.113.7"));

        Assert.Equal("10.0.0.9", key);
    }

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("")]
    [InlineData("   ")]
    public void An_unparseable_entry_is_refused_rather_than_used_as_a_partition_key(string entry)
    {
        // If free text were accepted as a key, one caller could mint a fresh partition per
        // request and the limit would never fire at all.
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith("10.0.0.9", entry));

        Assert.Equal("10.0.0.9", key);
    }

    [Theory]
    [InlineData("203.0.113.7:41234", "203.0.113.7")]
    [InlineData("[2001:db8::1]:41234", "2001:db8::1")]
    [InlineData("2001:db8::1", "2001:db8::1")]
    public void A_port_on_the_forwarded_entry_is_stripped_so_one_caller_is_one_partition(
        string entry,
        string expected)
    {
        // A proxy that appends "address:port" would otherwise give every TCP connection from
        // one caller its own bucket.
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith("10.0.0.9", entry));

        Assert.Equal(expected, key);
    }

    [Fact]
    public void No_socket_and_no_header_yields_the_unknown_key_rather_than_throwing()
    {
        var resolver = new ClientIpResolver(trustedProxyHopCount: 1);

        var key = resolver.Resolve(ContextWith(socketPeer: null));

        Assert.Equal(ClientIpResolver.UnknownPartitionKey, key);
    }

    [Fact]
    public void A_negative_hop_count_is_refused_at_construction()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new ClientIpResolver(-1));
    }
}
