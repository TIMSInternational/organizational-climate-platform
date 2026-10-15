using System.Data.Common;
using Npgsql;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// The outcome of applying <see cref="DatabaseConnectionStringPolicy"/> to a runtime
/// connection string: the string to actually hand to Npgsql, plus the two facts the caller
/// needs in order to log about it.
/// </summary>
/// <param name="ConnectionString">The connection string to use, with the pool bound.</param>
/// <param name="MaxPoolSizeApplied">
/// <see langword="true"/> when the incoming string did not specify a maximum pool size and
/// <see cref="DatabaseConnectionStringPolicy.DefaultMaxPoolSize"/> was therefore applied;
/// <see langword="false"/> when the incoming string already specified one and was left alone.
/// </param>
/// <param name="MaxPoolSize">The effective maximum pool size, whichever of the two it came from.</param>
/// <param name="Port">The effective port, either as supplied or Npgsql's 5432 default.</param>
/// <param name="UsesTransactionPoolerPort">
/// <see langword="true"/> when <paramref name="Port"/> is Supabase Supavisor's
/// <em>transaction</em> pooler port. See the type-level remarks on
/// <see cref="DatabaseConnectionStringPolicy"/> for why that is a defect at runtime.
/// </param>
public sealed record DatabaseConnectionStringPolicyResult(
    string ConnectionString,
    bool MaxPoolSizeApplied,
    int MaxPoolSize,
    int Port,
    bool UsesTransactionPoolerPort);

/// <summary>
/// What the host should do about a connection string that points at Supavisor's transaction
/// pooler. Returned by
/// <see cref="DatabaseConnectionStringPolicy.DecideTransactionPoolerAction"/>.
/// </summary>
/// <remarks>
/// Three outcomes rather than two, because "the port is correct" and "the port is wrong but
/// this deployment tolerates it" are different states and an operator reading a deploy log
/// has to be able to tell them apart.
/// </remarks>
public enum TransactionPoolerAction
{
    /// <summary>The port is not the transaction pooler. Say nothing.</summary>
    None,

    /// <summary>
    /// The port is Supavisor's transaction pooler, and this deployment has not armed the
    /// guard. Start anyway, and log a warning.
    /// </summary>
    Warn,

    /// <summary>
    /// The port is Supavisor's transaction pooler, and this deployment declared that it
    /// requires session mode. Refuse to start.
    /// </summary>
    Fail,
}

/// <summary>
/// Normalises the runtime Postgres connection string before it reaches Npgsql, and reports
/// what it found so the host can log about it at startup.
/// </summary>
/// <remarks>
/// <para>
/// <strong>Why this exists (#220).</strong> Production alternated 200 / timeout on
/// <c>/ready</c> — five of ten probes hung — while <c>/health</c> stayed green throughout,
/// because <c>/health</c> is a static literal that touches no database. Two independent
/// problems produced that, and this type addresses the half that lives in the repository.
/// </para>
/// <para>
/// <strong>Problem one: the pool was unbounded.</strong> Npgsql's default
/// <c>Maximum Pool Size</c> is 100 and nothing overrode it. Each instance owns its own pool,
/// so worst-case demand is instances x pool size and nothing else in the system bounds it.
/// <see cref="DefaultMaxPoolSize"/> bounds it.
/// </para>
/// <para>
/// <strong>The budget that bound was measured against was wrong, and a load test proved it on
/// 2026-10-15.</strong> This type and the arithmetic table in <c>infra/aws/README.md</c> were
/// written against a worst case of 25 instances x 10 connections = 250, with 250 chosen as
/// "under the smallest plausible configured limit". The project's actual Supavisor pool size
/// was <strong>15</strong>, a Nano compute default. Raising <c>MinSize</c> from 1 to 2 that
/// morning therefore took demand from 10 connections to 20, and a burst of 300 concurrent
/// sign-ins returned seven HTTP 500s, every one of them
/// <c>XX000: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited
/// to pool_size: 15</c>. In session mode each client holds a dedicated backend for the life of
/// the session, so the pool size IS the concurrent-client ceiling.
/// </para>
/// <para>
/// The pool size has since been raised to 30 — half of Nano's 60 <c>max_connections</c>,
/// leaving the rest for Supabase's own Auth, Storage, PostgREST and health checker, and for
/// migrations, which reach the database through this same session pooler. The same test then
/// returned zero errors and 67% more throughput. Both numbers in the budget are now read from
/// somewhere real rather than assumed: the instance ceiling from the autoscaling configuration
/// in the service template, and the pooler ceiling from the project's dashboard.
/// </para>
/// <para>
/// The default is applied <em>only</em> when the incoming string is silent on the subject.
/// An operator who sets <c>Maximum Pool Size</c> in the Secrets Manager value keeps their
/// value, so the number can be tuned without a redeploy. That includes explicitly setting it
/// to 100 — "the operator asked for the same number the framework would have picked" is a
/// deliberate choice and is preserved as one.
/// </para>
/// <para>
/// <strong>Problem two: the port is wrong, and is not fixed here.</strong> The runtime string
/// points at port <see cref="SupavisorTransactionPoolerPort"/>, Supavisor's *transaction*
/// pooler. Transaction mode hands a different backend to each statement, which is
/// fundamentally incompatible with a client-side pool like Npgsql's that holds connections
/// open across statements and expects session state to persist. The runtime path wants the
/// *session* pooler on <see cref="SupavisorSessionPoolerPort"/> — same host, same password,
/// same <c>postgres.&lt;project-ref&gt;</c> username, different port. That value lives in AWS
/// Secrets Manager (<c>climate-project-api/prod/database-connection-string</c>), not in this
/// repository, so this type can only <em>detect and report</em> it.
/// </para>
/// <para>
/// <strong>How severely it reports it is a deployment's own decision.</strong>
/// <see cref="DecideTransactionPoolerAction"/> takes the detection above and a per-deployment
/// <c>Database:RequireSessionPooler</c> flag and returns one of
/// <see cref="TransactionPoolerAction"/>. This is the same shape as
/// <c>GoogleAuth:Required</c> (see <c>StartupOptions.cs</c>) and exists for the same reason:
/// the guard must be a hard startup failure in the environment that depends on it, and must
/// not be one in the environments that do not.
/// </para>
/// <para>
/// The flag defaults to <see langword="false"/> for the environments that do not depend on it.
/// <strong>On production it is armed and the sequence is complete:</strong> the live service
/// carries <c>Database__RequireSessionPooler=true</c> and starts, which is only possible
/// against the session pooler, and the <c>EMAXCONNSESSION</c> error above names session mode
/// in so many words. Earlier revisions of this paragraph said the secret still pointed at
/// <see cref="SupavisorTransactionPoolerPort"/>; that is no longer true, and the guard now
/// stops the port regressing. See <c>infra/aws/README.md</c> ("Arming the guard").
/// </para>
/// </remarks>
public static class DatabaseConnectionStringPolicy
{
    /// <summary>
    /// The maximum pool size applied when the connection string does not specify one.
    ///
    /// <para>
    /// Six, because the service's own ceiling is four instances and the pooler's is thirty
    /// connections: 4 x 6 = 24 leaves room for a deploy's migration and for Supabase's own
    /// services. It was 10, which fitted the budget this repository had assumed and not the
    /// one the database actually had — see the remarks on the enclosing type.
    /// </para>
    /// <para>
    /// Six is not a constraint on throughput. A sign-in holds a connection for the user
    /// lookup, on the order of twenty milliseconds, and spends the rest of its time in bcrypt
    /// holding nothing; measured throughput is 6.5 sign-ins a second across two instances, so
    /// six connections per instance is some two orders of magnitude more than the work needs.
    /// The CPU is the binding constraint, which is the right shape for this service.
    /// </para>
    /// </summary>
    public const int DefaultMaxPoolSize = 6;

    /// <summary>
    /// Supabase Supavisor's <em>transaction</em> pooler port. Correct for short-lived
    /// serverless clients, wrong for this service — see the remarks on
    /// <see cref="DatabaseConnectionStringPolicy"/>.
    /// </summary>
    public const int SupavisorTransactionPoolerPort = 6543;

    /// <summary>
    /// Supabase Supavisor's <em>session</em> pooler port, which is what both the runtime and
    /// the EF Core migration connection strings should use.
    /// </summary>
    public const int SupavisorSessionPoolerPort = 5432;

    /// <summary>
    /// The canonical keyword Npgsql emits for the maximum pool size. Every accepted spelling
    /// (<c>MaxPoolSize</c>, <c>maximum pool size</c>, ...) normalises to this one when a
    /// <see cref="NpgsqlConnectionStringBuilder"/> is round-tripped back to a string.
    /// </summary>
    private const string MaxPoolSizeKeyword = "Maximum Pool Size";

    /// <summary>
    /// Bounds the Npgsql connection pool and reports what the connection string says about
    /// the pooler port.
    /// </summary>
    /// <param name="connectionString">The connection string as configured.</param>
    /// <returns>The rewritten connection string and the facts worth logging about it.</returns>
    /// <exception cref="ArgumentException">
    /// <paramref name="connectionString"/> is not a connection string Npgsql can parse. This
    /// is deliberately not caught: <c>UseNpgsql</c> would throw the same exception from the
    /// same input a moment later, so surfacing it here only makes an already-fatal
    /// misconfiguration fatal a little earlier, in line with the startup validation added by
    /// #189.
    /// </exception>
    public static DatabaseConnectionStringPolicyResult Apply(string connectionString)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var alreadySpecified = SpecifiesMaxPoolSize(builder);

        if (!alreadySpecified)
        {
            builder.MaxPoolSize = DefaultMaxPoolSize;
        }

        return new DatabaseConnectionStringPolicyResult(
            ConnectionString: builder.ConnectionString,
            MaxPoolSizeApplied: !alreadySpecified,
            MaxPoolSize: builder.MaxPoolSize,
            Port: builder.Port,
            UsesTransactionPoolerPort: builder.Port == SupavisorTransactionPoolerPort);
    }

    /// <summary>
    /// Decides what a host should do when the connection string points at Supavisor's
    /// transaction pooler.
    /// </summary>
    /// <param name="usesTransactionPoolerPort">
    /// <see cref="DatabaseConnectionStringPolicyResult.UsesTransactionPoolerPort"/> from
    /// <see cref="Apply"/>.
    /// </param>
    /// <param name="requireSessionPooler">
    /// The deployment's <c>Database:RequireSessionPooler</c> setting.
    /// </param>
    /// <returns>The action the host should take.</returns>
    /// <remarks>
    /// <para>
    /// Two booleans and three outcomes is small enough to inline at the call site, and it is
    /// deliberately not inlined. The call site is <c>Program.cs</c>, which has no unit tests —
    /// a host is not constructible without a database — so a decision left there is a decision
    /// nothing pins. Extracting it is the same move <c>SystemStatusPolicy</c> makes for the
    /// same reason: the part that must not be wrong is put where it can be exhaustively
    /// tested, and the caller is reduced to acting on the answer.
    /// </para>
    /// <para>
    /// Note the asymmetry: <paramref name="requireSessionPooler"/> can only ever *escalate*
    /// <see cref="TransactionPoolerAction.Warn"/> to <see cref="TransactionPoolerAction.Fail"/>.
    /// It is not a suppression switch — there is no combination of inputs that turns a
    /// transaction-pooler port into <see cref="TransactionPoolerAction.None"/>, so arming the
    /// guard in production cannot be undone by silencing it somewhere else.
    /// </para>
    /// </remarks>
    public static TransactionPoolerAction DecideTransactionPoolerAction(
        bool usesTransactionPoolerPort,
        bool requireSessionPooler)
    {
        if (!usesTransactionPoolerPort)
        {
            return TransactionPoolerAction.None;
        }

        return requireSessionPooler ? TransactionPoolerAction.Fail : TransactionPoolerAction.Warn;
    }

    /// <summary>
    /// Reports whether the connection string the builder was constructed from explicitly
    /// specified a maximum pool size.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This cannot be asked directly. <see cref="NpgsqlConnectionStringBuilder"/> is a
    /// strongly-typed builder that knows every Npgsql keyword, so its
    /// <c>ContainsKey</c> returns <see langword="true"/> for <c>Maximum Pool Size</c>
    /// unconditionally — including for a connection string that never mentions it (measured).
    /// Reading <c>MaxPoolSize</c> and comparing to 100 is no better: it cannot tell an unset
    /// value from an operator who deliberately set 100.
    /// </para>
    /// <para>
    /// What <em>is</em> reliable is that serialising the builder back out emits only the
    /// keywords that were actually supplied, under Npgsql's own canonical names. Re-parsing
    /// that output with the untyped <see cref="DbConnectionStringBuilder"/> — which stores
    /// exactly the keys it is given and nothing else — therefore answers the question, and
    /// does so without this file maintaining its own list of Npgsql's accepted aliases.
    /// </para>
    /// </remarks>
    private static bool SpecifiesMaxPoolSize(NpgsqlConnectionStringBuilder builder)
    {
        var suppliedKeywords = new DbConnectionStringBuilder
        {
            ConnectionString = builder.ConnectionString,
        };

        return suppliedKeywords.ContainsKey(MaxPoolSizeKeyword);
    }
}
