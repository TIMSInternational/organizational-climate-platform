using ClimateProject.Application.Auditing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing.Patterns;

namespace ClimateProject.Api.Infrastructure.Auditing;

/// <summary>
/// Endpoint metadata that tells <see cref="AuditWritingMiddleware"/> to write no row for a
/// request it would otherwise audit (#143).
/// </summary>
/// <remarks>
/// There is one on purpose, and it is meant to stay almost unused. Its whole value is that an
/// exemption is a visible, greppable, named thing rather than an endpoint quietly not being
/// reached: <c>AuditCoverageTests</c> asserts the set of exempt mutating routes is exactly the
/// set listed in the test, so adding one to a new endpoint fails the build until somebody
/// writes the reason down next to the other reasons.
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public sealed class AuditExemptAttribute(string reason) : Attribute
{
    /// <summary>Why this endpoint writes no audit row. Not stored; read by humans and by the coverage test.</summary>
    public string Reason { get; } = reason;
}

/// <summary>
/// Endpoint metadata that opts a **non-mutating** endpoint into the audit trail (#143).
/// </summary>
/// <remarks>
/// Mutating endpoints need no marker -- the middleware audits every POST/PUT/PATCH/DELETE
/// whether or not anyone remembered to say so, which is the entire reason #143 asked for a
/// cross-cutting mechanism. Reads are the opposite case: auditing every GET would bury the
/// trail in dashboard polling, so the ones that matter (a report view, an export) declare
/// themselves.
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public sealed class AuditSensitiveReadAttribute(string verb) : Attribute
{
    /// <summary>One of <see cref="AuditVerbs"/> -- normally <c>read</c> or <c>export</c>.</summary>
    public string Verb { get; } = verb;
}

/// <summary>What the middleware decided to do about one request, and why.</summary>
/// <param name="IsAudited">True when a row must be written.</param>
/// <param name="Resource">The derived <c>audit_logs.resource</c>. Empty when not audited.</param>
/// <param name="Action">The derived <c>audit_logs.action</c>. Empty when not audited.</param>
/// <param name="SkipReason">Why no row is written. Null when <paramref name="IsAudited"/> is true.</param>
public readonly record struct AuditDecision(
    bool IsAudited,
    string Resource,
    string Action,
    string? SkipReason)
{
    public static AuditDecision Skip(string reason) => new(false, string.Empty, string.Empty, reason);

    public static AuditDecision Audit(string resource, string action) => new(true, resource, action, null);
}

/// <summary>
/// The rule for whether a request is audited, and under what action and resource name (#143).
///
/// ## Why this is a decision function and not a list
///
/// The issue's requirement is that the mechanism be cross-cutting "because per-endpoint audit
/// calls are guaranteed to be forgotten somewhere". A registry mapping route -> action is the
/// same defect wearing a different hat: a new endpoint is absent from it by default. So the
/// only input here is what the request already is -- its HTTP method and its route pattern --
/// and the default for a mutating method is *audited*. An endpoint has to carry
/// <see cref="AuditExemptAttribute"/> to escape, and that is checked by a test.
///
/// ## Why the resource is derived from the route pattern
///
/// The pattern, not the request path: <c>/surveys/{id:guid}/status</c> and not
/// <c>/surveys/8a1.../status</c>, so every request to one endpoint groups under one resource
/// name regardless of which row it touched. Parameter segments are dropped and the static ones
/// joined with dots, giving <c>surveys.status</c>, <c>admin.benchmarks.metrics</c>,
/// <c>profile.password</c>. Derivation cannot be forgotten and cannot drift from the routing
/// table, which a hand-maintained name per endpoint can do both of.
///
/// A handler that knows a better name says so through <see cref="AuditEntry"/> -- that is
/// enrichment of a row that is already being written, not permission to be audited.
/// </summary>
public static class AuditPolicy
{
    /// <summary>Mirrors <c>audit_logs.action</c>'s column width (AuditLogConfiguration).</summary>
    public const int MaxActionLength = 100;

    /// <summary>Mirrors <c>audit_logs.resource</c>'s column width.</summary>
    public const int MaxResourceLength = 100;

    /// <summary>Mirrors <c>audit_logs.resource_id</c>'s column width.</summary>
    public const int MaxResourceIdLength = 255;

    /// <summary>Mirrors <c>audit_logs.ip_address</c>'s column width.</summary>
    public const int MaxIpAddressLength = 64;

    /// <summary>Mirrors <c>audit_logs.user_agent</c>'s column width.</summary>
    public const int MaxUserAgentLength = 500;

    /// <summary>Mirrors <c>audit_logs.error_message</c>'s column width.</summary>
    public const int MaxErrorMessageLength = 2000;

    /// <summary>
    /// The resource name used when a route pattern has no static segment at all to name it
    /// after. <c>audit_logs.resource</c> is NOT NULL, so something has to be written; this is
    /// deliberately conspicuous, and <c>AuditCoverageTests</c> fails if any mutating route in
    /// the application derives it.
    /// </summary>
    public const string UnnameableResource = "unknown";

    /// <summary>
    /// Whether this endpoint can only be reached by a caller the application has identified --
    /// and therefore whether the row <see cref="Decide"/> asks for can actually be written.
    /// </summary>
    /// <remarks>
    /// <c>audit_logs.company_id</c> is NOT NULL behind a RESTRICT foreign key to
    /// <c>companies</c>, so a request whose caller resolves to no user row resolves to no
    /// tenant either, and there is no row that can legally be inserted for it —
    /// <c>AuditWritingMiddleware.WriteAsync</c> logs a warning and abandons the write. Deciding
    /// "audit" for such an endpoint is therefore not the same as auditing it, which is the
    /// distinction <c>AuditCoverageTests.Every_mutating_endpoint_is_audited</c> exists to keep
    /// honest: it asserts this predicate over the live route table against a written-down set,
    /// so a new mutating endpoint that accepts unidentified callers fails the build instead of
    /// quietly joining the blind spot.
    ///
    /// Read off the endpoint's own metadata rather than from a list: an endpoint is authorized
    /// in this application by <c>RequireAuthorization()</c>, which adds <see cref="IAuthorizeData"/>,
    /// and an authorized group opens one route back up with <c>AllowAnonymous()</c>, which adds
    /// <see cref="IAllowAnonymous"/> and wins. Both are what <c>UseAuthorization</c> itself
    /// reads, so this cannot drift from who actually gets in.
    /// </remarks>
    public static bool RequiresIdentifiedCaller(Endpoint? endpoint)
        => endpoint is not null
            && endpoint.Metadata.GetMetadata<IAllowAnonymous>() is null
            && endpoint.Metadata.GetMetadata<IAuthorizeData>() is not null;

    /// <summary>POST, PUT, PATCH, DELETE. Everything else is a read as far as auditing goes.</summary>
    public static bool IsMutatingMethod(string method)
        => HttpMethods.IsPost(method)
            || HttpMethods.IsPut(method)
            || HttpMethods.IsPatch(method)
            || HttpMethods.IsDelete(method);

    /// <summary>The verb half of the action for a mutating method.</summary>
    public static string VerbFor(string method)
    {
        if (HttpMethods.IsPost(method)) return AuditVerbs.Create;
        if (HttpMethods.IsDelete(method)) return AuditVerbs.Delete;

        // PUT and PATCH both. Anything else never reaches here -- IsMutatingMethod gates it.
        return AuditVerbs.Update;
    }

    /// <summary>
    /// Whether this request is audited, and under what names.
    /// </summary>
    /// <param name="endpoint">The matched endpoint, from <c>HttpContext.GetEndpoint()</c>.</param>
    /// <param name="method">The request's HTTP method.</param>
    public static AuditDecision Decide(Endpoint? endpoint, string method)
    {
        // Nothing matched the route table: there is no resource to name and no handler that
        // could have changed anything. A 404 that never reached an endpoint is a routing fact,
        // not an audit event.
        if (endpoint is null)
        {
            return AuditDecision.Skip("no endpoint matched the request");
        }

        if (endpoint.Metadata.GetMetadata<AuditExemptAttribute>() is { } exempt)
        {
            return AuditDecision.Skip($"endpoint is marked audit-exempt: {exempt.Reason}");
        }

        var mutating = IsMutatingMethod(method);
        var sensitiveRead = endpoint.Metadata.GetMetadata<AuditSensitiveReadAttribute>();

        if (!mutating && sensitiveRead is null)
        {
            return AuditDecision.Skip(
                "non-mutating request on an endpoint that does not declare its reads sensitive");
        }

        var resource = DeriveResource(endpoint);
        var verb = mutating ? VerbFor(method) : sensitiveRead!.Verb;

        return AuditDecision.Audit(resource, Truncate($"{resource}.{verb}", MaxActionLength));
    }

    /// <summary>
    /// The resource name for an endpoint: its route pattern's static segments, lower-cased and
    /// joined with dots.
    /// </summary>
    /// <remarks>
    /// Returns <see cref="UnnameableResource"/> for a pattern made entirely of parameters, and
    /// for an endpoint that is not a <see cref="RouteEndpoint"/> at all (nothing in this
    /// application maps one, but <c>GetMetadata</c> is not a guarantee).
    /// </remarks>
    public static string DeriveResource(Endpoint? endpoint)
        => endpoint is RouteEndpoint route
            ? DeriveResource(route.RoutePattern)
            : UnnameableResource;

    /// <summary>The same derivation, straight from a pattern -- what the coverage test calls.</summary>
    public static string DeriveResource(RoutePattern pattern)
    {
        var names = pattern.PathSegments
            .Where(segment => segment.IsSimple && segment.Parts.Count == 1)
            .Select(segment => segment.Parts[0])
            .OfType<RoutePatternLiteralPart>()
            .Select(part => part.Content.ToLowerInvariant())
            .ToList();

        return names.Count == 0
            ? UnnameableResource
            : Truncate(string.Join('.', names), MaxResourceLength);
    }

    /// <summary>Trims to a column width. Postgres rejects an over-length varchar rather than truncating.</summary>
    public static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value[..maxLength];

    /// <summary>Null-or-blank in, null out; otherwise trimmed and capped at the column's width.</summary>
    public static string? TruncateOptional(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }
}
