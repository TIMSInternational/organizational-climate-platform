using ClimateProject.Infrastructure.Persistence;
using Npgsql;

namespace ClimateProject.UnitTests.Persistence;

/// <summary>
/// Tests for the #220 connection-string policy: bound the Npgsql pool, and notice when the
/// runtime string points at Supavisor's transaction pooler.
/// </summary>
public class DatabaseConnectionStringPolicyTests
{
    private const string BaseConnectionString =
        "Host=aws-0-us-east-1.pooler.supabase.com;Database=postgres;Username=postgres.abcdef;Password=hunter2";

    // -- Requirement (a): an unset maximum pool size gets the default applied. ------------

    [Fact]
    public void Apply_sets_the_default_maximum_pool_size_when_the_connection_string_omits_it()
    {
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString);

        Assert.True(result.MaxPoolSizeApplied);
        Assert.Equal(DatabaseConnectionStringPolicy.DefaultMaxPoolSize, result.MaxPoolSize);

        // Assert on what Npgsql will actually read back out of the returned string, not on
        // its text: the point is the effective pool bound, not the formatting.
        var effective = new NpgsqlConnectionStringBuilder(result.ConnectionString);
        Assert.Equal(DatabaseConnectionStringPolicy.DefaultMaxPoolSize, effective.MaxPoolSize);
    }

    [Fact]
    public void Apply_leaves_every_other_connection_string_setting_untouched()
    {
        // Bounding the pool must not quietly drop credentials or TLS settings on the way
        // through -- this string is shaped like the production one.
        var result = DatabaseConnectionStringPolicy.Apply(
            BaseConnectionString + ";Port=5432;SSL Mode=Require;Timeout=30");

        var effective = new NpgsqlConnectionStringBuilder(result.ConnectionString);
        Assert.Equal("aws-0-us-east-1.pooler.supabase.com", effective.Host);
        Assert.Equal("postgres", effective.Database);
        Assert.Equal("postgres.abcdef", effective.Username);
        Assert.Equal("hunter2", effective.Password);
        Assert.Equal(SslMode.Require, effective.SslMode);
        Assert.Equal(30, effective.Timeout);
        Assert.Equal(5432, effective.Port);
    }

    // -- Requirement (b): an explicitly-set value is preserved. ---------------------------

    [Fact]
    public void Apply_preserves_a_maximum_pool_size_that_the_connection_string_already_specifies()
    {
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Maximum Pool Size=42");

        Assert.False(result.MaxPoolSizeApplied);
        Assert.Equal(42, result.MaxPoolSize);

        var effective = new NpgsqlConnectionStringBuilder(result.ConnectionString);
        Assert.Equal(42, effective.MaxPoolSize);
    }

    [Theory]
    [InlineData("Maximum Pool Size")]
    [InlineData("MaxPoolSize")]
    [InlineData("maximum pool size")]
    [InlineData("MAXPOOLSIZE")]
    public void Apply_preserves_an_explicit_value_however_the_keyword_is_spelled(string keyword)
    {
        // Npgsql accepts several spellings of this keyword. The override exists so the
        // Secrets Manager value can retune the pool without a redeploy, so it must not be
        // silently ignored because whoever edited the secret picked a different casing.
        var result = DatabaseConnectionStringPolicy.Apply($"{BaseConnectionString};{keyword}=37");

        Assert.False(result.MaxPoolSizeApplied);
        Assert.Equal(37, result.MaxPoolSize);
    }

    [Fact]
    public void Apply_preserves_an_explicit_value_that_happens_to_equal_the_npgsql_default()
    {
        // The hard case, and the reason detection cannot just compare MaxPoolSize to 100:
        // "unset" and "deliberately set to Npgsql's default" read identically off the typed
        // builder. An operator who writes 100 is making a choice and must keep it, rather
        // than being silently downgraded to 10.
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Maximum Pool Size=100");

        Assert.False(result.MaxPoolSizeApplied);
        Assert.Equal(100, result.MaxPoolSize);
    }

    [Fact]
    public void Apply_does_not_mistake_a_minimum_pool_size_for_a_maximum_one()
    {
        // Companion to the detection tests above: proves the check still fires (applies the
        // default) when a *different* pool keyword is present, rather than treating any
        // pool-shaped setting as "the operator has this handled".
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Minimum Pool Size=2");

        Assert.True(result.MaxPoolSizeApplied);
        Assert.Equal(DatabaseConnectionStringPolicy.DefaultMaxPoolSize, result.MaxPoolSize);

        var effective = new NpgsqlConnectionStringBuilder(result.ConnectionString);
        Assert.Equal(2, effective.MinPoolSize);
    }

    // -- The port warning's decision surface. --------------------------------------------

    [Fact]
    public void Apply_flags_the_supavisor_transaction_pooler_port()
    {
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Port=6543");

        Assert.True(result.UsesTransactionPoolerPort);
        Assert.Equal(DatabaseConnectionStringPolicy.SupavisorTransactionPoolerPort, result.Port);
    }

    [Fact]
    public void Apply_does_not_flag_the_session_pooler_port()
    {
        // The companion to the test above: once the Secrets Manager value is flipped to 5432
        // the warning must stop firing, otherwise it is noise that will be tuned out before
        // it is ever hardened into a hard failure.
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Port=5432");

        Assert.False(result.UsesTransactionPoolerPort);
        Assert.Equal(DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort, result.Port);
    }

    [Fact]
    public void Apply_does_not_flag_a_connection_string_with_no_port_at_all()
    {
        // Npgsql defaults an omitted port to 5432, so silence is not the defect.
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString);

        Assert.False(result.UsesTransactionPoolerPort);
        Assert.Equal(5432, result.Port);
    }

    [Fact]
    public void Apply_does_not_rewrite_the_port_it_warns_about()
    {
        // Detection only. The fix is an AWS Secrets Manager value; silently rewriting 6543 to
        // 5432 here would paper over a misconfiguration this repository cannot see the rest
        // of, and would make the warning describe something that is no longer true.
        var result = DatabaseConnectionStringPolicy.Apply(BaseConnectionString + ";Port=6543");

        var effective = new NpgsqlConnectionStringBuilder(result.ConnectionString);
        Assert.Equal(6543, effective.Port);
    }

    // -- The warn-or-throw decision (Database:RequireSessionPooler). ----------------------

    [Theory]
    // The two states production moves between, in order.
    [InlineData(true, false, TransactionPoolerAction.Warn)]   // today: wrong port, guard not armed
    [InlineData(false, true, TransactionPoolerAction.None)]   // the goal: right port, guard armed
    // The other two corners.
    [InlineData(true, true, TransactionPoolerAction.Fail)]    // wrong port with the guard armed
    [InlineData(false, false, TransactionPoolerAction.None)]  // right port, guard not armed
    public void DecideTransactionPoolerAction_maps_the_whole_truth_table(
        bool usesTransactionPoolerPort,
        bool requireSessionPooler,
        TransactionPoolerAction expected)
    {
        // Exhaustive on purpose -- two booleans is four rows, so there is no excuse for
        // sampling. This decision is the one thing standing between a wrong Secrets Manager
        // value and a production outage in either direction: too lax and #220 recurs
        // silently, too strict and a deploy of a correct commit refuses to boot.
        var action = DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
            usesTransactionPoolerPort,
            requireSessionPooler);

        Assert.Equal(expected, action);
    }

    [Fact]
    public void DecideTransactionPoolerAction_never_reports_None_for_the_transaction_pooler()
    {
        // The asymmetry that makes the flag a ratchet rather than a mute button: it may
        // escalate Warn to Fail, but no value of it can turn a transaction-pooler port into
        // silence. If this ever fails, the flag has become a way to hide #220 instead of a
        // way to close it.
        foreach (var requireSessionPooler in new[] { true, false })
        {
            var action = DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
                usesTransactionPoolerPort: true,
                requireSessionPooler: requireSessionPooler);

            Assert.NotEqual(TransactionPoolerAction.None, action);
        }
    }

    [Fact]
    public void DecideTransactionPoolerAction_agrees_with_Apply_on_the_production_shaped_string()
    {
        // Pins the two halves together. Apply decides *whether* the port is the transaction
        // pooler; DecideTransactionPoolerAction decides *what to do about it*. Testing them
        // only in isolation would let the port constant and the decision drift apart while
        // both files' own tests stayed green.
        var defective = DatabaseConnectionStringPolicy.Apply(
            BaseConnectionString + $";Port={DatabaseConnectionStringPolicy.SupavisorTransactionPoolerPort}");
        var corrected = DatabaseConnectionStringPolicy.Apply(
            BaseConnectionString + $";Port={DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort}");

        // With the guard armed -- the intended end state -- the current production string is
        // a startup failure and the corrected one starts clean.
        Assert.Equal(
            TransactionPoolerAction.Fail,
            DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
                defective.UsesTransactionPoolerPort,
                requireSessionPooler: true));
        Assert.Equal(
            TransactionPoolerAction.None,
            DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
                corrected.UsesTransactionPoolerPort,
                requireSessionPooler: true));

        // With the guard unarmed -- today -- the same string only warns, which is what lets
        // the current deploy stay up.
        Assert.Equal(
            TransactionPoolerAction.Warn,
            DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
                defective.UsesTransactionPoolerPort,
                requireSessionPooler: false));
    }

    [Fact]
    public void The_session_and_transaction_pooler_ports_are_the_two_supabase_documents()
    {
        // The constants are what every message, guard and document in the repository quotes.
        // Pinning them here means changing either one breaks a test that says why, rather
        // than quietly invalidating deploy-prod.yml's grep for 6543 and the prose in
        // infra/aws/README.md, docs/security/rotation-inventory.md and README.md.
        Assert.Equal(6543, DatabaseConnectionStringPolicy.SupavisorTransactionPoolerPort);
        Assert.Equal(5432, DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort);
        Assert.NotEqual(
            DatabaseConnectionStringPolicy.SupavisorSessionPoolerPort,
            DatabaseConnectionStringPolicy.SupavisorTransactionPoolerPort);
    }

    // -- Contract edges. ------------------------------------------------------------------

    [Fact]
    public void Apply_bounds_the_pool_even_on_the_defective_production_shaped_string()
    {
        // Both problems at once, which is what production actually has today: the port is
        // wrong *and* the pool was unbounded. The pool fix must land regardless of the port.
        var result = DatabaseConnectionStringPolicy.Apply(
            BaseConnectionString + ";Port=6543;SSL Mode=Require");

        Assert.True(result.UsesTransactionPoolerPort);
        Assert.True(result.MaxPoolSizeApplied);
        Assert.Equal(DatabaseConnectionStringPolicy.DefaultMaxPoolSize, result.MaxPoolSize);
    }

    /// <summary>
    /// Worst-case connection demand against the budget the DATABASE actually has.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This test existed before 2026-10-15 and passed throughout the incident it was meant to
    /// prevent, because both of its numbers were invented. It compared 25 instances -- App
    /// Runner's implicit default, which this service stopped using when it got an explicit
    /// autoscaling configuration -- against a budget of 250, described in its own comment as
    /// "this repository's deliberately conservative choice, not a vendor-published number".
    /// The project's real Supavisor pool size was <b>15</b>. So the guard compared a ceiling
    /// the service no longer had with a limit the database never had, and a burst of 300
    /// concurrent sign-ins returned HTTP 500s with
    /// <c>(EMAXCONNSESSION) max clients ... limited to pool_size: 15</c>.
    /// </para>
    /// <para>
    /// A test over two assumed constants cannot catch a real ceiling. Both numbers below are
    /// now read from somewhere: <see cref="ServiceMaxInstances"/> from <c>MaxSize</c> in
    /// <c>infra/aws/climate-project-api-prod-service.yml</c>, and
    /// <see cref="PoolerConnectionBudget"/> from the project's own dashboard (Database ->
    /// Connection pooling), where it was read on 2026-10-15. Either moving means re-reading the
    /// other; the arithmetic is in <c>infra/aws/README.md</c>.
    /// </para>
    /// </remarks>
    [Fact]
    public void Default_maximum_pool_size_stays_within_the_budget_the_pooler_actually_has()
    {
        // MaxSize in the service's own autoscaling configuration, not App Runner's default.
        const int ServiceMaxInstances = 4;

        // Read from the Supabase dashboard on 2026-10-15, after it was raised from the Nano
        // default of 15. In SESSION mode a client holds a dedicated backend for the life of
        // the session, so this is the concurrent-client ceiling and not merely a hint.
        const int PoolerConnectionBudget = 30;

        var worstCase = ServiceMaxInstances * DatabaseConnectionStringPolicy.DefaultMaxPoolSize;

        Assert.True(
            worstCase <= PoolerConnectionBudget,
            $"Worst-case connection demand is {worstCase} ({ServiceMaxInstances} instances x "
            + $"{DatabaseConnectionStringPolicy.DefaultMaxPoolSize} connections), above the "
            + $"pooler's {PoolerConnectionBudget}. Every connection past it is refused as "
            + "EMAXCONNSESSION and reaches the respondent as HTTP 500. Lower the pool size, "
            + "lower MaxSize, or raise the pooler -- and re-read the dashboard rather than "
            + "assuming, which is how this guard came to pass while production failed.");

        // Headroom for the things that share the pooler and are not instances: a deploy's EF
        // migration, which connects through this same session pooler, and a psql session.
        Assert.True(
            worstCase <= PoolerConnectionBudget - 4,
            $"Worst-case demand {worstCase} leaves fewer than four spare connections of "
            + $"{PoolerConnectionBudget}. A deploy runs migrations through this same pooler "
            + "while the old instances are still serving, so a budget with no slack turns a "
            + "deploy into an outage.");
    }

    [Fact]
    public void Apply_rejects_a_connection_string_npgsql_cannot_parse()
    {
        // Deliberately not swallowed: UseNpgsql would throw on the same input moments later,
        // so failing here just moves an already-fatal misconfiguration earlier (#189's rule).
        Assert.Throws<ArgumentException>(
            () => DatabaseConnectionStringPolicy.Apply("Host=h;NotARealNpgsqlKeyword=1"));
    }

    [Fact]
    public void Apply_rejects_a_null_connection_string()
    {
        Assert.Throws<ArgumentNullException>(() => DatabaseConnectionStringPolicy.Apply(null!));
    }
}
