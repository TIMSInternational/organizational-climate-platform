using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Diagnostics;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Diagnostics;

/// <summary>
/// <c>GET /admin/system/status</c> (#147).
///
/// Two things are being pinned here that the unit tests cannot reach: that the authorization
/// really is SuperAdmin-only over HTTP (both denials, not just the grant), and that the
/// counts are read from the real notifications table with the same predicate the dispatch
/// sweep uses.
/// </summary>
[Collection("Postgres")]
public class SystemStatusEndpointsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly string _companyDomain = $"sysstatus-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public SystemStatusEndpointsTests(PostgresContainerFixture postgres) => _postgres = postgres;

    // Exactly one application host for the whole collection, not just this class -- numerous
    // WebApplicationFactory<Program> boots are the identified hazard behind the #68 flake and
    // the #279 capture timeout. Migrations and seeding still go through a bare DbContext.
    private AuthWebApplicationFactory Factory => _postgres.App;

    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "System Status Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    // Nothing to dispose: the host belongs to the collection fixture (#279).
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        await using (var db = CreateContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        return (token, userId);
    }

    private static HttpClient Authenticated(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Notification NewNotification(Guid userId, string status, DateTimeOffset scheduledFor, DateTimeOffset? sentAt = null, int retryCount = 0)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = _companyId,
            Type = NotificationTypes.All[0],
            Channel = NotificationChannels.All[0],
            Status = status,
            Title = "Diagnostics fixture",
            Message = "Diagnostics fixture",
            ScheduledFor = scheduledFor,
            SentAt = sentAt,
            RetryCount = retryCount,
            MaxRetries = 3,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

    // -------------------------------------------------------------------------------------
    // Authorization. Diagnostics are platform-global, so this is SuperAdmin and nothing else.
    // -------------------------------------------------------------------------------------

    [Fact]
    public async Task Status_requires_authentication()
    {
        var response = await Factory.CreateClient().GetAsync("/admin/system/status");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Status_is_denied_to_a_company_admin()
    {
        // The denial that matters. Everything on this endpoint is platform-global -- the pool
        // bound is per instance, the queue counts span every tenant -- so there is no company
        // scoping that could make a CompanyAdmin's view of it correct. If someone later
        // "helpfully" widens this to Roles.Admin, this fails.
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);

        var response = await Authenticated(client, token).GetAsync("/admin/system/status");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Status_is_denied_to_an_ordinary_employee()
    {
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.Employee);

        var response = await Authenticated(client, token).GetAsync("/admin/system/status");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // -------------------------------------------------------------------------------------
    // The happy path.
    // -------------------------------------------------------------------------------------

    [Fact]
    public async Task Status_reports_a_healthy_instance_to_a_super_admin()
    {
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);

        var response = await Authenticated(client, token).GetAsync("/admin/system/status");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var status = await response.Content.ReadFromJsonAsync<SystemStatusResponse>(JsonOptions);
        Assert.NotNull(status);
        Assert.Equal("climate-project-api", status!.Service);
        Assert.Equal(SystemStatuses.Ok, status.Status);

        // A live round-trip happened, and it was classified rather than assumed.
        Assert.Equal(SystemComponentStatuses.Ok, status.Database.Status);

        // Testcontainers maps Postgres to an ephemeral host port, so this is never 6543 --
        // which is the point: on this instance the #220 flag is legitimately false, and the
        // unit tests cover the case where it is true.
        // #275: the payload carries a heartbeat per scheduled job. The list is empty in this
        // host because the integration suite deliberately runs with the jobs idle, which is
        // also why the aggregate verdict above is still ok -- a stale or failing job would
        // degrade it. WorkerHostingRegistrationTests is what pins that they are *deployed*.
        Assert.NotNull(status.Jobs);

        Assert.False(status.Database.UsesTransactionPoolerPort);
        Assert.Equal(DatabaseConnectionStringPolicy.DefaultMaxPoolSize, status.Database.MaxPoolSize);
        Assert.True(status.Database.MaxPoolSizeDefaulted);

        // Build provenance is the same data /version reports; a local/CI build carries none,
        // and "unknown" is a deliberate, distinguishable value rather than an empty string.
        Assert.False(string.IsNullOrWhiteSpace(status.Build.Commit));
        Assert.False(string.IsNullOrWhiteSpace(status.Build.BuiltAt));
    }

    [Fact]
    public async Task Status_never_echoes_the_connection_string_or_any_credential()
    {
        // SuperAdmin-only does not make a leak acceptable: response bodies get pasted into
        // tickets and chat. The connection string here contains the container's host, port,
        // username and password, so a body that mentions any of them has leaked.
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);

        var body = await (await Authenticated(client, token).GetAsync("/admin/system/status")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Username", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("postgres", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("climate_project_test", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Host=", body, StringComparison.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------------------
    // Queue depth.
    // -------------------------------------------------------------------------------------

    [Fact]
    public async Task Status_counts_the_notification_backlog_and_degrades_when_it_has_aged()
    {
        var client = Factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);

        var now = DateTimeOffset.UtcNow;
        await using (var db = CreateContext())
        {
            db.Notifications.AddRange(
                // Due, and old enough to be a backlog: nothing is draining the queue.
                NewNotification(userId, NotificationStatuses.Pending, now.AddSeconds(-SystemStatusPolicy.BacklogAgeThresholdSeconds - 60)),
                // Due, but young. Counted, not alarming on its own.
                NewNotification(userId, NotificationStatuses.Pending, now.AddSeconds(-30)),
                // Scheduled for the future: pending, but a sweep would not pick it up.
                NewNotification(userId, NotificationStatuses.Pending, now.AddHours(2)),
                // Retries exhausted: a dead letter, so also not something a sweep retries.
                NewNotification(userId, NotificationStatuses.Failed, now.AddHours(-3), retryCount: 3),
                // Already delivered -- this is the dispatcher heartbeat.
                NewNotification(userId, NotificationStatuses.Sent, now.AddHours(-1), sentAt: now.AddMinutes(-2)));
            await db.SaveChangesAsync();
        }

        var response = await Authenticated(client, token).GetAsync("/admin/system/status");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var status = (await response.Content.ReadFromJsonAsync<SystemStatusResponse>(JsonOptions))!;

        Assert.Equal(SystemStatuses.Degraded, status.Status);
        Assert.Equal(SystemComponentStatuses.Backlog, status.NotificationQueue.Status);

        // Three pending rows exist; only two of them are due.
        Assert.Equal(3, status.NotificationQueue.Pending);
        Assert.Equal(2, status.NotificationQueue.Due);
        Assert.Equal(1, status.NotificationQueue.DeadLettered);
        Assert.NotNull(status.NotificationQueue.OldestDueAgeSeconds);
        Assert.True(status.NotificationQueue.OldestDueAgeSeconds >= SystemStatusPolicy.BacklogAgeThresholdSeconds);

        // The heartbeat is derived from the row that actually shipped, not asserted.
        Assert.Equal(SystemComponentStatuses.Ok, status.Dispatcher.Status);
        Assert.NotNull(status.Dispatcher.LastDispatchAt);
    }

    [Fact]
    public async Task An_empty_queue_reports_a_dispatcher_that_has_never_run_without_degrading()
    {
        // A deployment that has legitimately never sent a notification must not report
        // degraded from the moment it is installed -- "never-run" is context, not an alarm.

        // /admin/system/status reports the whole deployment, so unlike a per-tenant endpoint
        // there is no scoping that makes "the queue is empty" true while other rows exist. The
        // only honest way to assert the empty case is to empty it. Every class in this assembly
        // shares one Postgres container and by the time this runs, sibling classes have left
        // notifications behind -- which is why this read "degraded" in CI while passing in
        // isolation. Safe to delete here: the "Postgres" collection runs its classes serially,
        // and every test that cares about a notification creates its own.
        await using (var cleanup = CreateContext())
        {
            await cleanup.Notifications.ExecuteDeleteAsync();
        }

        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);

        var status = (await (await Authenticated(client, token).GetAsync("/admin/system/status"))
            .Content.ReadFromJsonAsync<SystemStatusResponse>(JsonOptions))!;

        Assert.Equal(SystemStatuses.Ok, status.Status);
        Assert.Equal(SystemComponentStatuses.Ok, status.NotificationQueue.Status);
        Assert.Equal(0, status.NotificationQueue.Due);
        Assert.Null(status.NotificationQueue.OldestDueAgeSeconds);
        Assert.Equal(SystemComponentStatuses.NeverRun, status.Dispatcher.Status);
        Assert.Null(status.Dispatcher.LastDispatchAt);
    }

    // -------------------------------------------------------------------------------------
    // The endpoints this one deliberately does NOT replace.
    // -------------------------------------------------------------------------------------

    [Fact]
    public async Task The_unauthenticated_probes_still_leak_nothing_now_that_a_verbose_one_exists()
    {
        // #147 asks for status to be rich and for public health output to stay minimal. The
        // two pull in opposite directions, and the cheapest way to accidentally resolve that
        // is to reuse the rich payload on /health. These assertions make that fail: neither
        // public probe may mention a commit, a port, a pool bound or a queue depth.
        var client = Factory.CreateClient();

        foreach (var path in new[] { "/health", "/ready" })
        {
            var body = await (await client.GetAsync(path)).Content.ReadAsStringAsync();

            Assert.DoesNotContain("commit", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("port", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("pool", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("queue", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("dispatcher", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task The_dev_only_legacy_system_endpoints_were_dropped_rather_than_ported()
    {
        // api/system/integration-tests ran the test suite in-process; api/system/performance
        // and api/system/accessibility reported hard-coded audit scores. #147 says drop them,
        // and "we chose not to build it" is only durable if something asserts it. A 404 for a
        // SuperAdmin is that assertion -- it cannot be satisfied by an authorization failure.
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        var authenticated = Authenticated(client, token);

        foreach (var path in new[]
        {
            "/admin/system/integration-tests",
            "/admin/system/performance",
            "/admin/system/accessibility",
        })
        {
            var response = await authenticated.GetAsync(path);

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
