using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ClimateProject.IntegrationTests.Auditing;

/// <summary>
/// What the audit writer's extra <c>DbContext</c> costs the connection pool (#143, raised
/// against the background of #220's runtime pool fix).
///
/// ## The claim under test
///
/// <c>AuditWritingMiddleware</c> resolves a second <c>ClimateProjectDbContext</c> from a fresh
/// DI scope for every audited request, because reusing the request's own would flush changes a
/// handler deliberately did not save. The reasonable worry is that this doubles the pool
/// demand: two contexts alive per request, therefore two connections held at once, therefore a
/// pool that used to fit N concurrent mutations now fits N/2 — and a request holding one
/// connection while queuing for another is the classic pool deadlock, which does not degrade
/// gracefully, it hangs.
///
/// It does not, because a <c>DbContext</c> does not hold a connection for its lifetime: EF
/// opens one per operation and Npgsql returns it to the pool when the command finishes. By the
/// time the middleware writes, <c>next(context)</c> has already returned and the request's own
/// context has nothing in flight. The two are sequential.
///
/// ## Why it is measured this way
///
/// This runs more concurrent mutating requests than the pool has connections. Passing at a
/// deliberately small pool size is the evidence; a comment asserting EF's connection lifetime
/// is not.
///
/// Both halves are asserted because the two failures look different. Measured by making the
/// middleware genuinely hold the request's connection open across its own write (one line, in
/// <c>WriteAsync</c>): all 12 requests still came back 201, and the audit rows came back **0**.
/// A write that cannot get a connection is swallowed and logged, by design — a failed audit
/// must not fail the mutation — so the symptom of doubling the pool demand is a silently
/// missing trail, not a visible error. Counting the rows is what catches it.
/// </summary>
[Collection("Postgres")]
public class AuditPoolPressureTests : IAsyncLifetime
{
    /// <summary>
    /// Connections this application may open at once. Smaller than
    /// <see cref="ConcurrentMutations"/> on purpose — that is the whole experiment.
    /// </summary>
    private const int MaxPoolSize = 4;

    /// <summary>Mutating requests fired at the same time.</summary>
    private const int ConcurrentMutations = 12;

    private readonly PostgresContainerFixture _postgres;
    private readonly string _companyDomain = $"pool-{Guid.NewGuid():N}.test";

    private AuthWebApplicationFactory? _factory;
    private Guid _companyId;

    public AuditPoolPressureTests(PostgresContainerFixture postgres) => _postgres = postgres;

    /// <summary>
    /// The suite's Postgres, but with a pool this application cannot grow out of. The timeout
    /// is the wait for a *pooled* connection as well as for a new one, so a request that needs
    /// a second connection while every one is taken fails here rather than hanging the run.
    /// </summary>
    private string ConstrainedConnectionString => new NpgsqlConnectionStringBuilder(_postgres.ConnectionString)
    {
        MaxPoolSize = MaxPoolSize,
        Timeout = 15,
    }.ConnectionString;

    private AuthWebApplicationFactory Factory => _factory ??= new AuthWebApplicationFactory(ConstrainedConnectionString);

    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Pool Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        _factory?.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Concurrent_mutations_outnumbering_the_pool_all_complete_and_all_leave_a_row()
    {
        var client = Factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";

        var signup = await client.PostAsJsonAsync(
            "/auth/signup",
            new SignupRequest("Pool Person", email, "Po0lPassword"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        await using (var db = CreateContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "Po0lPassword"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        // Started together rather than awaited in turn: the point is overlap. Each one is a
        // handler write plus an audit write, on two different contexts.
        var responses = await Task.WhenAll(Enumerable.Range(0, ConcurrentMutations).Select(i =>
            client.PostAsJsonAsync(
                "/admin/departments",
                new CreateDepartmentRequest(_companyId, $"Pooled {i} {Guid.NewGuid():N}", null, null, true))));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));

        await using var read = CreateContext();
        var rows = await read.AuditLogs.AsNoTracking().CountAsync(a => a.UserId == userId);

        Assert.Equal(ConcurrentMutations, rows);
    }
}
