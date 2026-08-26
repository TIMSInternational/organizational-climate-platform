using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auditing;

/// <summary>
/// The completeness half of #143: whatever the audit middleware does, it has to do it to
/// **every** mutating endpoint the application maps -- and where it demonstrably cannot, that
/// has to be a written-down set rather than a discovery.
///
/// ## Why this reads the route table instead of calling every endpoint
///
/// There are 80-odd mutating routes. Driving all of them over HTTP would need a valid body, a
/// valid tenant and a valid role for each, and the test would then be measuring the fixtures as
/// much as the mechanism -- and the endpoint added next week would still be absent from it,
/// which is the exact failure mode the issue asked to be designed out.
///
/// So this asks the live <see cref="EndpointDataSource"/> -- the same routing table the server
/// dispatches on -- for every route, and puts each one through
/// <see cref="AuditPolicy.Decide(Endpoint?, string)"/>, which is the function the middleware
/// itself calls. A new endpoint is in this test the moment it is mapped, because nobody has to
/// add it. <c>AuditLoggingTests</c> is the other half: it proves the decision this asserts
/// actually results in a row on the way through.
///
/// ## Deciding "audit" is not the same as auditing
///
/// <see cref="AuditPolicy.Decide(Endpoint?, string)"/> answers "should there be a row", and it
/// says yes for every mutating method. Whether there *is* one also depends on the request
/// having a resolvable tenant, because <c>audit_logs.company_id</c> is NOT NULL: a mutating
/// endpoint that accepts unidentified callers writes nothing, and used to do so with every
/// test here green. So <see cref="Every_mutating_endpoint_is_audited"/> asserts both halves,
/// and pins the second against <see cref="UnattributableMutatingRoutes"/> -- the blind set
/// cannot grow, shrink or move without this test failing.
/// </summary>
[Collection("Postgres")]
public class AuditCoverageTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;

    public AuditCoverageTests(PostgresContainerFixture postgres) => _postgres = postgres;

    private AuthWebApplicationFactory Factory => _postgres.App;

    public Task InitializeAsync()
    {
        // The endpoint data source this class reads is populated when the host is built, which
        // the collection fixture has already done. Touching Services rather than creating a
        // client keeps that dependency stated; no request is sent and nothing here touches the
        // database.
        _ = Factory.Services;
        return Task.CompletedTask;
    }

    // Nothing to dispose: the host belongs to the collection fixture (#279).
    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// The mutating routes allowed to write no audit row.
    /// </summary>
    /// <remarks>
    /// Empty, and meant to stay that way. An exemption is a hole in the trail, so the set is
    /// asserted exactly rather than as an upper bound: marking a new endpoint
    /// <c>[AuditExempt]</c> fails this test until somebody adds it here, next to the reasons
    /// for the others. That is the only way an endpoint can opt out at all.
    /// </remarks>
    private static readonly string[] ExpectedExemptRoutes = [];

    /// <summary>
    /// The non-mutating routes that declare their reads sensitive, as "METHOD /pattern".
    /// </summary>
    /// <remarks>
    /// Asserted exactly, in both directions. Adding a marker without adding it here fails, and
    /// so does silently dropping one from an endpoint that has it today -- which is the
    /// regression that matters, because a read that stops being audited looks like nothing at
    /// all.
    /// </remarks>
    private static readonly string[] ExpectedSensitiveReadRoutes =
    [
        "GET /admin/reports/{id:guid}",
        "GET /audit/export",
        "GET /surveys/{id:guid}/results",
    ];

    private IReadOnlyList<(string Method, string Pattern, Endpoint Endpoint)> Routes()
    {
        var source = Factory.Services.GetRequiredService<EndpointDataSource>();
        var routes = new List<(string, string, Endpoint)>();

        foreach (var endpoint in source.Endpoints.OfType<RouteEndpoint>())
        {
            var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods;
            if (methods is null)
            {
                continue;
            }

            foreach (var method in methods)
            {
                routes.Add((method, endpoint.RoutePattern.RawText ?? string.Empty, endpoint));
            }
        }

        return routes;
    }

    private IReadOnlyList<(string Method, string Pattern, Endpoint Endpoint)> MutatingRoutes()
        => Routes().Where(r => AuditPolicy.IsMutatingMethod(r.Method)).ToList();

    /// <summary>
    /// Guards the guard. Every assertion below is vacuously true over an empty route table, and
    /// an empty route table is exactly what a mis-resolved <see cref="EndpointDataSource"/>
    /// would produce.
    /// </summary>
    [Fact]
    public void The_route_table_this_test_reads_is_the_real_one()
    {
        var routes = Routes();

        // A group's own prefix route -- MapGroup("/admin/departments") + MapPost("") -- comes
        // back with a trailing slash, so this matches on the prefix rather than on equality.
        // The derivation is unaffected: an empty trailing segment contributes no name.
        Assert.Contains(
            routes,
            r => r.Method == "POST" && r.Pattern.StartsWith("/admin/departments", StringComparison.Ordinal));
        Assert.Contains(routes, r => r is { Method: "GET", Pattern: "/audit/logs" });
        Assert.True(
            MutatingRoutes().Count >= 70,
            $"only {MutatingRoutes().Count} mutating routes were found; the data source is probably not the app's");
    }

    /// <summary>
    /// The mutating routes that write no row however the policy decides, because they accept a
    /// caller the application never identifies.
    /// </summary>
    /// <remarks>
    /// Not an allowance -- a measurement, asserted exactly in both directions so that it is a
    /// deliberate act to change it. Adding a mutating endpoint without
    /// <c>RequireAuthorization()</c>, or opening an authorized one up with
    /// <c>AllowAnonymous()</c>, fails <see cref="Every_mutating_endpoint_is_audited"/> until
    /// the route is written down here; giving one of these an identified caller fails it too,
    /// so the list cannot go stale in the flattering direction either.
    ///
    /// Why they cannot be audited today: <c>audit_logs.company_id</c> is NOT NULL behind a
    /// RESTRICT foreign key, so a request with no user row behind it has no tenant to file
    /// under. Closing that is a nullable-column migration, which this wave permits only on
    /// another branch -- docs/decisions/audit-logging.md carries it as outstanding work.
    /// <c>AuditLoggingTests.An_unidentified_mutation_writes_no_row</c> pins the same fact
    /// behaviourally, so this list is not the only thing standing between the gap and a
    /// silent change.
    /// </remarks>
    private static readonly string[] UnattributableMutatingRoutes =
    [
        "POST /api/internal/send-notification",
        "POST /auth/google",
        "POST /auth/login",
        "POST /auth/signup",
        "POST /invitations/{token}/accept",
        "POST /microclimate-invitations/{token}/completed",
        "POST /microclimate-invitations/{token}/opened",
        "POST /microclimate-invitations/{token}/participated",
        "POST /microclimate-invitations/{token}/started",
        "POST /microclimates/{id:guid}/responses",
        "POST /survey-invitations/{token}/completed",
        "POST /survey-invitations/{token}/opened",
        "POST /survey-invitations/{token}/started",
        "POST /surveys/{id:guid}/responses",
    ];

    /// <summary>
    /// Every mutating route is decided "audit", and every one of them can actually produce the
    /// row -- except the written-down set that cannot.
    /// </summary>
    /// <remarks>
    /// Both halves, because the first alone was the defect: <see cref="AuditPolicy.Decide"/>
    /// returns Audit for any mutating method that is not <c>[AuditExempt]</c>, so an endpoint
    /// added with no authorization passed this test while writing nothing at all. The second
    /// half is what makes the completeness claim falsifiable -- see
    /// <see cref="UnattributableMutatingRoutes"/>.
    /// </remarks>
    [Fact]
    public void Every_mutating_endpoint_is_audited()
    {
        var unaudited = MutatingRoutes()
            .Where(r => !AuditPolicy.Decide(r.Endpoint, r.Method).IsAudited)
            .Select(r => $"{r.Method} {r.Pattern}: {AuditPolicy.Decide(r.Endpoint, r.Method).SkipReason}")
            .ToList();

        Assert.Empty(unaudited);

        var cannotBeAttributed = MutatingRoutes()
            .Where(r => !AuditPolicy.RequiresIdentifiedCaller(r.Endpoint))
            .Select(r => $"{r.Method} {r.Pattern}")
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.Equal(
            UnattributableMutatingRoutes.Order(StringComparer.Ordinal).ToList(),
            cannotBeAttributed);
    }

    /// <summary>
    /// Every mutating endpoint has a name to be filed under.
    /// </summary>
    /// <remarks>
    /// <see cref="AuditPolicy.UnnameableResource"/> is what a route pattern made entirely of
    /// parameters falls back to. Nothing maps one today, and this is what stops one appearing
    /// unnoticed: a trail where several unrelated endpoints all file under "unknown" cannot
    /// answer "what happened to this" for any of them.
    /// </remarks>
    [Fact]
    public void Every_mutating_endpoint_derives_a_real_resource_name()
    {
        var unnameable = MutatingRoutes()
            .Where(r => AuditPolicy.Decide(r.Endpoint, r.Method).Resource == AuditPolicy.UnnameableResource)
            .Select(r => $"{r.Method} {r.Pattern}")
            .ToList();

        Assert.Empty(unnameable);
    }

    /// <summary>And the action is the resource plus a verb, within the column's width.</summary>
    [Fact]
    public void Every_mutating_endpoint_derives_an_action_that_fits_the_column()
    {
        foreach (var route in MutatingRoutes())
        {
            var decision = AuditPolicy.Decide(route.Endpoint, route.Method);

            Assert.StartsWith(decision.Resource + ".", decision.Action, StringComparison.Ordinal);
            Assert.True(
                decision.Action.Length <= AuditPolicy.MaxActionLength,
                $"{route.Method} {route.Pattern} derives an over-long action: {decision.Action}");
            Assert.True(
                decision.Resource.Length <= AuditPolicy.MaxResourceLength,
                $"{route.Method} {route.Pattern} derives an over-long resource: {decision.Resource}");
        }
    }

    [Fact]
    public void The_set_of_audit_exempt_mutating_routes_is_the_documented_one()
    {
        var exempt = MutatingRoutes()
            .Where(r => r.Endpoint.Metadata.GetMetadata<AuditExemptAttribute>() is not null)
            .Select(r => $"{r.Method} {r.Pattern}")
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.Equal(ExpectedExemptRoutes.Order(StringComparer.Ordinal).ToList(), exempt);
    }

    [Fact]
    public void The_set_of_sensitive_reads_is_the_documented_one()
    {
        var sensitive = Routes()
            .Where(r => !AuditPolicy.IsMutatingMethod(r.Method))
            .Where(r => r.Endpoint.Metadata.GetMetadata<AuditSensitiveReadAttribute>() is not null)
            .Select(r => $"{r.Method} {r.Pattern}")
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.Equal(ExpectedSensitiveReadRoutes.Order(StringComparer.Ordinal).ToList(), sensitive);
    }

    /// <summary>
    /// A read with no marker writes nothing. Stated as a test because it is the half of the
    /// policy that is invisible in the trail: if it broke, the symptom would be a table full of
    /// dashboard polling rather than an absence.
    /// </summary>
    [Fact]
    public void An_unmarked_read_is_not_audited()
    {
        var listRoute = Routes().Single(r => r is { Method: "GET", Pattern: "/audit/logs" });

        var decision = AuditPolicy.Decide(listRoute.Endpoint, listRoute.Method);

        Assert.False(decision.IsAudited);
        Assert.Equal(
            "non-mutating request on an endpoint that does not declare its reads sensitive",
            decision.SkipReason);
    }

    /// <summary>The derivation itself, on the shapes the table actually contains.</summary>
    [Theory]
    [InlineData("POST", "/admin/departments", "admin.departments", "admin.departments.create")]
    [InlineData("PUT", "/admin/departments/{id:guid}", "admin.departments", "admin.departments.update")]
    [InlineData("DELETE", "/surveys/{id:guid}", "surveys", "surveys.delete")]
    [InlineData("PATCH", "/surveys/{id:guid}", "surveys", "surveys.update")]
    [InlineData(
        "POST",
        "/surveys/{surveyId:guid}/invitations/{invitationId:guid}/revoke",
        "surveys.invitations.revoke",
        "surveys.invitations.revoke.create")]
    public void The_resource_and_action_derived_from_a_pattern(
        string method,
        string pattern,
        string expectedResource,
        string expectedAction)
    {
        var endpoint = new RouteEndpoint(
            _ => Task.CompletedTask,
            Microsoft.AspNetCore.Routing.Patterns.RoutePatternFactory.Parse(pattern),
            order: 0,
            new EndpointMetadataCollection(),
            displayName: pattern);

        var decision = AuditPolicy.Decide(endpoint, method);

        Assert.True(decision.IsAudited);
        Assert.Equal(expectedResource, decision.Resource);
        Assert.Equal(expectedAction, decision.Action);
    }
}
