using System.Net;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Answers "which client is this request from?" for rate-limiting partitions only.
///
/// <para>
/// <b>Why this exists at all.</b> The two rate limiters that predate #146 (see
/// <see cref="Endpoints.MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy"/> and
/// <see cref="Endpoints.SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy"/>)
/// partitioned on <c>HttpContext.Connection.RemoteIpAddress</c>, which is the socket peer.
/// In production this service runs on AWS App Runner
/// (<c>infra/aws/climate-project-api-prod-service.yml</c>), where requests reach the
/// container through an AWS-managed proxy, so the socket peer is that proxy and every
/// caller in the world lands in ONE partition. A per-IP limit that behaves that way is
/// worse than no limit: the first thirty respondents in a minute exhaust the bucket for
/// everyone. No forwarded-header handling was configured anywhere in the app before this
/// type -- the note in <c>Endpoints/SurveyAuditTrail.cs</c> records the same absence, and
/// relies on it.
/// </para>
/// <para>
/// <b>Why not <c>UseForwardedHeaders</c>.</b> That middleware rewrites
/// <c>Connection.RemoteIpAddress</c> for the whole pipeline, which would silently change
/// what <c>SurveyActor.IpAddress</c> writes into <c>survey_audit_logs</c> -- a deliberate
/// decision recorded in <c>SurveyAuditTrail.cs</c> and audit-trail territory rather than
/// rate-limiting territory. Confining the header trust to this type means a mistake in it
/// can only mis-bucket a rate limit; it can never forge an audit record.
/// </para>
/// <para>
/// <b>Failure modes, deliberately asymmetric.</b> With
/// <see cref="TrustedProxyHopCount"/> at 0 (the default, and what local development and the
/// test suite run) the socket peer is used and no header is trusted. With a positive hop
/// count, an absent or unparseable <c>X-Forwarded-For</c> falls back to the socket peer, so
/// misconfiguring this on a directly-exposed host degrades to today's behaviour rather than
/// to an open door. The residual risk is the other direction: on a host a client can reach
/// without passing through the trusted proxy, a forged header buys a fresh partition per
/// request, i.e. no limit. App Runner's container is not reachable that way, which is why
/// the trust is expressed as a per-deployment setting rather than switched on everywhere.
/// </para>
/// </summary>
public sealed class ClientIpResolver
{
    /// <summary>Partition key used when no address can be determined at all.</summary>
    public const string UnknownPartitionKey = "unknown";

    /// <summary>The header this type reads when <see cref="TrustedProxyHopCount"/> is positive.</summary>
    public const string ForwardedForHeaderName = "X-Forwarded-For";

    public ClientIpResolver(int trustedProxyHopCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(trustedProxyHopCount);
        TrustedProxyHopCount = trustedProxyHopCount;
    }

    /// <summary>
    /// How many proxies sit between the client and this process, all of which append to
    /// <c>X-Forwarded-For</c>. 0 means "no proxy, use the socket peer". 1 -- the App Runner
    /// case -- means the client address is the LAST entry of the header, because the single
    /// trusted proxy appended the address it saw. The semantics match
    /// <c>ForwardedHeadersOptions.ForwardLimit</c> so the two cannot be read differently.
    /// </summary>
    public int TrustedProxyHopCount { get; }

    /// <summary>
    /// The partition key for <paramref name="httpContext"/>: a normalised IP address, or
    /// <see cref="UnknownPartitionKey"/> when there is none (which happens under
    /// <c>TestServer</c>, where there is no socket).
    /// </summary>
    public string Resolve(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (TrustedProxyHopCount > 0
            && TryReadForwardedFor(httpContext.Request.Headers[ForwardedForHeaderName], TrustedProxyHopCount, out var forwarded))
        {
            return forwarded;
        }

        return httpContext.Connection.RemoteIpAddress?.ToString() ?? UnknownPartitionKey;
    }

    /// <summary>
    /// Picks the <paramref name="trustedProxyHopCount"/>-th entry counting from the right of
    /// an <c>X-Forwarded-For</c> value, and normalises it to a bare IP address.
    ///
    /// <para>
    /// Counting from the right is the only direction that is not attacker-controlled: a
    /// client may send any prefix it likes, and each proxy appends. Entries that do not
    /// parse as an address (with or without a port) are rejected rather than used verbatim,
    /// because an unparseable partition key is attacker-chosen free text and would let one
    /// caller mint unlimited partitions.
    /// </para>
    /// </summary>
    internal static bool TryReadForwardedFor(
        IEnumerable<string?> headerValues,
        int trustedProxyHopCount,
        out string clientIp)
    {
        clientIp = string.Empty;

        var entries = headerValues
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .SelectMany(value => value!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .ToArray();

        var index = entries.Length - trustedProxyHopCount;
        if (index < 0 || index >= entries.Length)
        {
            return false;
        }

        return TryNormalise(entries[index], out clientIp);
    }

    private static bool TryNormalise(string entry, out string clientIp)
    {
        // IPAddress first: IPEndPoint.TryParse also accepts a bare address, but IPAddress
        // rejects "1.2.3.4:5678", so trying it first keeps the two cases distinguishable.
        if (IPAddress.TryParse(entry, out var address))
        {
            clientIp = address.ToString();
            return true;
        }

        if (IPEndPoint.TryParse(entry, out var endpoint))
        {
            clientIp = endpoint.Address.ToString();
            return true;
        }

        clientIp = string.Empty;
        return false;
    }
}
