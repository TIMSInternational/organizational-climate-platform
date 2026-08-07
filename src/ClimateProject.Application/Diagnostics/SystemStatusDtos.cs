namespace ClimateProject.Application.Diagnostics;

/// <summary>
/// The <c>GET /admin/system/status</c> payload (#147): one aggregate verdict plus the
/// component observations it was derived from.
/// </summary>
/// <remarks>
/// <para>
/// <strong>This DTO must never carry a secret.</strong> Everything here is safe to put in
/// front of a SuperAdmin operator and, by extension, in front of anything that operator
/// pastes into a ticket: port numbers, pool bounds, row counts, timestamps and a commit SHA.
/// No connection string, no host, no username, no password, no API key, no exception text.
/// <c>SystemStatusDtoShapeTests</c> pins that by walking this record's whole type graph, so a
/// future field named <c>ConnectionString</c> fails the unit suite rather than shipping.
/// </para>
/// <para>
/// <strong>Status values are machine tokens, not prose.</strong> Every status string on this
/// record comes from <see cref="SystemStatuses"/> or <see cref="SystemComponentStatuses"/>
/// and is locale-independent by construction. That is the same rule #195 applies to content:
/// no user-facing English (or Spanish) leaves the API, so the frontend can render these in
/// either language without the API growing <c>*_en</c> / <c>*_es</c> pairs.
/// </para>
/// </remarks>
/// <param name="Service">Constant service identifier, matching <c>/health</c> and <c>/ready</c>.</param>
/// <param name="Status">One of <see cref="SystemStatuses"/>.</param>
/// <param name="CheckedAt">When this snapshot was taken. The whole payload is point-in-time; nothing here is cached.</param>
/// <param name="Environment">ASP.NET Core environment name (Production, Development, ...).</param>
/// <param name="Build">Which commit is actually running — see <c>BuildInfo</c> and #69.</param>
/// <param name="Database">Live Postgres probe plus the connection policy facts from #220.</param>
/// <param name="NotificationQueue">Depth of the notification backlog.</param>
/// <param name="Dispatcher">Evidence about whatever is (or is not) draining that backlog.</param>
public sealed record SystemStatusResponse(
    string Service,
    string Status,
    DateTimeOffset CheckedAt,
    string Environment,
    SystemBuildStatus Build,
    SystemDatabaseStatus Database,
    SystemNotificationQueueStatus NotificationQueue,
    SystemDispatcherStatus Dispatcher);

/// <summary>Build provenance, identical to what <c>GET /version</c> reports.</summary>
/// <param name="Commit">Full git SHA, or <c>"unknown"</c> for a build that carried no provenance.</param>
/// <param name="BuiltAt">UTC ISO-8601 build instant, or <c>"unknown"</c>.</param>
/// <param name="Runtime">.NET runtime version.</param>
public sealed record SystemBuildStatus(
    string Commit,
    string BuiltAt,
    string Runtime);

/// <summary>
/// The result of a real Postgres round-trip, plus what
/// <c>DatabaseConnectionStringPolicy</c> decided about the connection string at startup.
/// </summary>
/// <remarks>
/// <see cref="Port"/> and <see cref="UsesTransactionPoolerPort"/> are the reason this
/// component exists in the shape it does. #220's live production defect is invisible from
/// <c>/health</c> (a static literal) and only intermittently visible from <c>/ready</c>
/// (roughly half the probes hang). Reporting the port a SuperAdmin can see makes the
/// misconfiguration a *fact on a page* instead of a coin flip, without ever revealing the
/// connection string it was read from.
/// </remarks>
/// <param name="Status">One of <c>ok</c>, <c>slow</c>, <c>timeout</c>, <c>unreachable</c> — see <see cref="SystemComponentStatuses"/>.</param>
/// <param name="LatencyMs">Milliseconds the <c>SELECT 1</c> took. On failure, milliseconds spent before giving up.</param>
/// <param name="Port">Effective Postgres port. A number, never a host or credential.</param>
/// <param name="UsesTransactionPoolerPort"><see langword="true"/> when <see cref="Port"/> is Supavisor's transaction pooler (#220).</param>
/// <param name="MaxPoolSize">Effective Npgsql maximum pool size.</param>
/// <param name="MaxPoolSizeDefaulted"><see langword="true"/> when the connection string was silent and the policy default was applied.</param>
public sealed record SystemDatabaseStatus(
    string Status,
    long LatencyMs,
    int Port,
    bool UsesTransactionPoolerPort,
    int MaxPoolSize,
    bool MaxPoolSizeDefaulted);

/// <summary>
/// How much undelivered notification work is sitting in the table, across all tenants.
/// </summary>
/// <remarks>
/// <see cref="Due"/> uses exactly the predicate <c>POST /notifications/process</c> sweeps on
/// (retryable status, scheduled in the past, retries not exhausted), so this number answers
/// "how much would the next sweep have to chew through", not "how many rows exist".
/// </remarks>
/// <param name="Status"><c>ok</c>, <c>backlog</c>, or <c>unknown</c> when the database could not be read.</param>
/// <param name="Pending">Rows still in the <c>pending</c> status, whether or not they are due yet.</param>
/// <param name="Due">Rows a dispatch sweep would pick up right now.</param>
/// <param name="DeadLettered">Rows that failed and have exhausted their retries. Reported, never alarmed on — see <see cref="SystemStatusPolicy"/>.</param>
/// <param name="OldestDueAgeSeconds">Age of the oldest due row, or <see langword="null"/> when nothing is due.</param>
public sealed record SystemNotificationQueueStatus(
    string Status,
    int Pending,
    int Due,
    int DeadLettered,
    long? OldestDueAgeSeconds);

/// <summary>
/// Evidence about the notification dispatcher.
/// </summary>
/// <remarks>
/// <para>
/// <strong>There is no worker in this repository yet, and this record does not pretend
/// otherwise.</strong> Dispatch happens when something external calls
/// <c>POST /notifications/process</c>; the API registers no <c>BackgroundService</c> or
/// <c>IHostedService</c>, and <c>src/ClimateProject.Workers</c> is still the four-line
/// scaffold the template generated — it builds and hosts nothing. So there is no worker
/// heartbeat to read, and #147's ask for one cannot be answered literally. Inventing a green
/// one would be worse than reporting nothing.
/// </para>
/// <para>
/// What can be observed honestly is the trace a dispatcher leaves behind:
/// <c>max(notifications.sent_at)</c>. That is a real heartbeat — it is high water mark of
/// "something actually delivered a notification" — and it distinguishes "never ran" from
/// "ran an hour ago" without asserting that a worker exists.
/// </para>
/// </remarks>
/// <param name="Status"><c>ok</c>, <c>stale</c>, <c>never-run</c>, or <c>unknown</c>.</param>
/// <param name="LastDispatchAt">Most recent successful dispatch across all tenants, or <see langword="null"/> if there has never been one.</param>
public sealed record SystemDispatcherStatus(
    string Status,
    DateTimeOffset? LastDispatchAt);
