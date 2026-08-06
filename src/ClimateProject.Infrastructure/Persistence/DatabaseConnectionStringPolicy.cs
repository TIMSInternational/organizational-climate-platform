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
/// <c>Maximum Pool Size</c> is 100 and nothing overrode it. The App Runner service template
/// (<c>infra/aws/climate-project-api-prod-service.yml</c>) sets no
/// <c>AutoScalingConfigurationArn</c>, so the service runs on App Runner's *default*
/// autoscaling configuration — <c>MaxSize</c> 25. Each instance owns its own pool, so the
/// worst case was 25 x 100 = 2500 server connections against a Supabase pooler that permits
/// far fewer. <see cref="DefaultMaxPoolSize"/> brings the worst case to 25 x 10 = 250, which
/// the arithmetic table in <c>infra/aws/README.md</c> works through against Supabase's
/// ceiling.
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
/// </remarks>
public static class DatabaseConnectionStringPolicy
{
    /// <summary>
    /// The maximum pool size applied when the connection string does not specify one.
    /// Chosen against App Runner's default <c>MaxSize</c> of 25 instances — see the
    /// arithmetic in <c>infra/aws/README.md</c>.
    /// </summary>
    public const int DefaultMaxPoolSize = 10;

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
