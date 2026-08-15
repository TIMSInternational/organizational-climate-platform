using System.Diagnostics;
using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Diagnostics;
using ClimateProject.Application.Notifications;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /admin/system/status</c> — the authenticated operational view of this instance
/// (#147), replacing legacy <c>api/system/status</c>.
/// </summary>
/// <remarks>
/// <para>
/// <strong>Where this sits relative to the probes that already exist.</strong> Three
/// endpoints already answer three different questions and none of them is replaced here:
/// </para>
/// <list type="bullet">
/// <item><c>/health</c> — liveness. A static literal that touches nothing: it answers "is the
/// process up" and nothing else. It stays a literal.</item>
/// <item><c>/ready</c> — readiness. One real <c>SELECT 1</c>, 503 on failure, unauthenticated
/// and therefore deliberately almost mute: service name, a status word, and nothing else.
/// It is what found #220, and since #221 it is also what App Runner polls — an instance that
/// fails it is replaced, which is exactly what a literal could never trigger. It stays
/// exactly as it is.</item>
/// <item><c>/version</c> — provenance. Commit SHA and build timestamp, without which a deploy
/// that silently no-op'd and one that worked were indistinguishable (#69).</item>
/// </list>
/// <para>
/// This endpoint is the fourth question: <em>why</em>. It is allowed to be verbose precisely
/// because it is authenticated, so it can say things the three unauthenticated endpoints must
/// not — the pooler port, the pool bound, queue depth, when something last dispatched. That
/// split is the point: keeping the public surface mute is what lets the private surface be
/// useful.
/// </para>
/// <para>
/// <strong>Deliberately not ported.</strong> The legacy surface also had
/// <c>api/system/integration-tests</c>, an endpoint that ran the test suite in-process, plus
/// <c>api/system/accessibility</c> and <c>api/system/performance</c>, which reported
/// hard-coded audit scores rather than measurements. The first is a remote code-execution
/// shaped liability in production and the other two are fiction with a status code. All three
/// are dropped rather than migrated; #147 asks for exactly that.
/// </para>
/// <para>
/// <strong>Authorization: SuperAdmin only, no tenant path.</strong> Every fact here is
/// platform-global — the pool bound is per instance, the queue counts span all tenants — so
/// there is no company scope that could make a CompanyAdmin's view of it correct. The usual
/// <c>SuperAdmin || (CompanyAdmin &amp;&amp; claim == companyId)</c> shape collapses to its
/// first term when there is no companyId to compare, and that is what
/// <see cref="CanReadSystemStatus"/> is. Both denials (CompanyAdmin, and an ordinary
/// employee) are tested.
/// </para>
/// </remarks>
public static class SystemStatusEndpoints
{
    private const string ServiceName = "climate-project-api";
    private const string LogCategory = "ClimateProject.Api.SystemStatus";

    public static void MapSystemStatusEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/system").RequireAuthorization();

        group.MapGet("/status", GetStatusAsync);
    }

    /// <summary>
    /// Diagnostics are platform-global operational data with no company scope, so this is
    /// SuperAdmin and nothing else. See the type-level remarks.
    /// </summary>
    private static bool CanReadSystemStatus(CurrentUser currentUser)
        => currentUser.Role == Roles.SuperAdmin;

    private static async Task<IResult> GetStatusAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IOptions<DatabaseOptions> databaseOptions,
        IHostEnvironment hostEnvironment,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanReadSystemStatus(currentUser)) return Results.Forbid();

        var now = DateTimeOffset.UtcNow;

        // One budget for every round-trip below, linked to the request so a caller who walks
        // away still cancels the work. Bounded because the whole reason this endpoint exists
        // is a database that hangs for thirty seconds (#220): an operator must get an answer,
        // and the answer must be "unhealthy", not a spinner. The catch block below is written
        // so that expiring this budget can only ever produce `timeout`, which
        // SystemStatusPolicy.Evaluate maps to unhealthy with no escape hatch.
        using var probeTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        probeTimeout.CancelAfter(TimeSpan.FromMilliseconds(SystemStatusPolicy.ProbeTimeoutMs));

        string databaseStatus;
        long latencyMs;
        NotificationQueueFacts? queueFacts;

        var stopwatch = Stopwatch.StartNew();
        try
        {
            // Same probe as /ready, and a query rather than CanConnectAsync for the same
            // reason: a pooler handshake can succeed without the session being able to
            // execute anything.
            await db.Database.ExecuteSqlRawAsync("SELECT 1", probeTimeout.Token);
            latencyMs = stopwatch.ElapsedMilliseconds;
            databaseStatus = SystemStatusPolicy.ClassifyDatabaseLatency(latencyMs);

            queueFacts = await ReadQueueFactsAsync(db, now, probeTimeout.Token);
        }
        catch (Exception exception)
        {
            // The caller gave up, not us -- there is nobody left to answer. Let it propagate
            // rather than reporting an outage that did not happen.
            if (cancellationToken.IsCancellationRequested) throw;

            latencyMs = stopwatch.ElapsedMilliseconds;

            // A hang and a refusal both end up unhealthy, but they are named apart because
            // they point at different causes -- and because #220 is specifically a hang.
            // Npgsql surfaces a cancelled token as either OperationCanceledException or a
            // driver exception wrapping it depending on where in the round-trip it lands, so
            // the discriminator is the token's own state rather than the exception type.
            databaseStatus = probeTimeout.IsCancellationRequested
                ? SystemComponentStatuses.Timeout
                : SystemComponentStatuses.Unreachable;

            // Logged, never echoed. Npgsql failure text carries the host, database name and
            // username of the production database; this endpoint is SuperAdmin-only, but a
            // response body gets pasted into tickets and chat and the /ready precedent of
            // never putting it in the payload is worth keeping uniform.
            loggerFactory
                .CreateLogger(LogCategory)
                .LogError(
                    exception,
                    "System status probe failed after {LatencyMs}ms with status {DatabaseStatus}.",
                    latencyMs,
                    databaseStatus);

            queueFacts = null;
        }

        var options = databaseOptions.Value;

        var database = new SystemDatabaseStatus(
            Status: databaseStatus,
            LatencyMs: latencyMs,
            Port: options.Port,
            UsesTransactionPoolerPort: options.UsesTransactionPoolerPort,
            MaxPoolSize: options.MaxPoolSize,
            MaxPoolSizeDefaulted: options.MaxPoolSizeDefaulted);

        // No facts means the database probe failed, so every derived number is unknown rather
        // than zero. Zero would read as "queue empty, all good", which is the opposite of
        // what was observed.
        var queue = queueFacts is null
            ? new SystemNotificationQueueStatus(SystemComponentStatuses.Unknown, 0, 0, 0, null)
            : new SystemNotificationQueueStatus(
                Status: SystemStatusPolicy.ClassifyQueue(queueFacts.OldestDueAgeSeconds),
                Pending: queueFacts.Pending,
                Due: queueFacts.Due,
                DeadLettered: queueFacts.DeadLettered,
                OldestDueAgeSeconds: queueFacts.OldestDueAgeSeconds);

        var dispatcher = queueFacts is null
            ? new SystemDispatcherStatus(SystemComponentStatuses.Unknown, null)
            : new SystemDispatcherStatus(
                Status: SystemStatusPolicy.ClassifyDispatcher(queueFacts.LastDispatchAt, now),
                LastDispatchAt: queueFacts.LastDispatchAt);

        var response = new SystemStatusResponse(
            Service: ServiceName,
            Status: SystemStatusPolicy.Evaluate(database, queue),
            CheckedAt: now,
            Environment: hostEnvironment.EnvironmentName,
            Build: new SystemBuildStatus(BuildInfo.CommitSha, BuildInfo.BuildTimestamp, System.Environment.Version.ToString()),
            Database: database,
            NotificationQueue: queue,
            Dispatcher: dispatcher);

        return Results.Json(response, statusCode: SystemStatusPolicy.HttpStatusFor(response.Status));
    }

    /// <summary>
    /// The raw numbers behind the queue and dispatcher components, before any judgement is
    /// applied to them.
    /// </summary>
    private sealed record NotificationQueueFacts(
        int Pending,
        int Due,
        int DeadLettered,
        long? OldestDueAgeSeconds,
        DateTimeOffset? LastDispatchAt);

    /// <summary>
    /// Reads the notification backlog across every tenant.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Five small scalar queries rather than one grouped projection. A single
    /// <c>GroupBy(_ =&gt; 1)</c> with filtered aggregates would be one round-trip instead of
    /// five, but its translation is the kind that compiles fine and throws at runtime, and
    /// this endpoint's whole job is to be trustworthy when everything else is on fire. Five
    /// obviously-translatable queries inside one shared timeout budget is the better trade
    /// for a SuperAdmin-only diagnostics read.
    /// </para>
    /// <para>
    /// The "due" predicate is copied deliberately from <c>NotificationEndpoints.ProcessDueAsync</c>:
    /// retryable status, scheduled in the past, retries not exhausted. If the two ever drift,
    /// this endpoint would be reporting a backlog no sweep would actually pick up.
    /// </para>
    /// </remarks>
    private static async Task<NotificationQueueFacts> ReadQueueFactsAsync(
        ClimateProjectDbContext db,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var due = db.Notifications.Where(n =>
            NotificationStatuses.Retryable.Contains(n.Status)
            && n.ScheduledFor <= now
            && n.RetryCount < n.MaxRetries);

        var pending = await db.Notifications
            .CountAsync(n => n.Status == NotificationStatuses.Pending, cancellationToken);

        var dueCount = await due.CountAsync(cancellationToken);

        var deadLettered = await db.Notifications.CountAsync(
            n => n.Status == NotificationStatuses.Failed && n.RetryCount >= n.MaxRetries,
            cancellationToken);

        // MIN/MAX over no rows return SQL NULL, which the nullable projections below map to
        // null -- hence the casts, which stop EF from asking for a non-nullable aggregate and
        // throwing on an empty table.
        var oldestDue = await due.MinAsync(n => (DateTimeOffset?)n.ScheduledFor, cancellationToken);

        var lastDispatchAt = await db.Notifications.MaxAsync(n => n.SentAt, cancellationToken);

        return new NotificationQueueFacts(
            Pending: pending,
            Due: dueCount,
            DeadLettered: deadLettered,
            OldestDueAgeSeconds: oldestDue is null ? null : (long)(now - oldestDue.Value).TotalSeconds,
            LastDispatchAt: lastDispatchAt);
    }
}
