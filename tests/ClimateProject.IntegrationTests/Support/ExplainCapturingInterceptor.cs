using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// Captures the Postgres query plan for the commands EF actually sends.
///
/// <para>Written for #278, where the claim under test is about a plan rather than a result.
/// An index test that asserts "an index named X exists in <c>pg_indexes</c>" passes whether or
/// not any query ever uses it -- it tests the migration, not the thing the migration was for.
/// So this asks the planner instead.</para>
///
/// <para>It runs <c>EXPLAIN</c> on the command <em>in place</em>: the interceptor swaps
/// <see cref="DbCommand.CommandText"/> for <c>"EXPLAIN " + original</c>, reads the plan on the
/// same open connection, and puts the text back before letting the real execution proceed. The
/// point of doing it that way rather than re-typing the SQL into a test is that the SQL and the
/// parameter values are then necessarily the ones the production code path produced -- a
/// hand-written <c>EXPLAIN</c> can drift from the LINQ it is supposed to be about, and a plan
/// for a query nobody runs proves nothing. <c>EXPLAIN</c> without <c>ANALYZE</c> does not
/// execute the statement, so capturing a plan for a DELETE deletes nothing.</para>
///
/// <para>Disabled until <see cref="Enabled"/> is set, and even then only commands mentioning
/// one of <see cref="Tables"/> are explained: migrations and seeding run through the same
/// context, and <c>EXPLAIN CREATE INDEX</c> is a syntax error.</para>
/// </summary>
public sealed class ExplainCapturingInterceptor(params string[] tables) : DbCommandInterceptor
{
    private readonly string[] _tables = tables;

    /// <summary>Table names a command must mention before its plan is captured.</summary>
    public IReadOnlyList<string> Tables => _tables;

    /// <summary>Set to true around the code path whose plan you want.</summary>
    public bool Enabled { get; set; }

    /// <summary>One entry per explained command, in execution order.</summary>
    public List<CapturedPlan> Plans { get; } = [];

    /// <summary>The single captured plan whose SQL contains <paramref name="fragment"/>.</summary>
    public CapturedPlan Single(string fragment)
        => Plans.Single(p => p.Sql.Contains(fragment, StringComparison.Ordinal));

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Capture(command);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Capture(command);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        Capture(command);
        return base.NonQueryExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Capture(command);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }

    private void Capture(DbCommand command)
    {
        var sql = command.CommandText;
        if (!Enabled || !_tables.Any(t => sql.Contains(t, StringComparison.Ordinal)))
        {
            return;
        }

        try
        {
            command.CommandText = "EXPLAIN " + sql;
            using var reader = command.ExecuteReader();
            var lines = new List<string>();
            while (reader.Read())
            {
                lines.Add(reader.GetString(0));
            }

            Plans.Add(new CapturedPlan(sql, string.Join('\n', lines)));
        }
        finally
        {
            command.CommandText = sql;
        }
    }
}

/// <summary>The SQL EF sent and the plan Postgres chose for it.</summary>
/// <param name="Sql">The statement, exactly as EF built it.</param>
/// <param name="Plan">Every line of <c>EXPLAIN</c> output, newline-joined.</param>
public sealed record CapturedPlan(string Sql, string Plan)
{
    // Postgres double-quotes identifiers that are not all-lowercase, and every index in this
    // schema is named IX_..., so the plan reads `Index Scan using "IX_survey_drafts_expires_at"`.
    // Matching against the quoted form is what a first cut of this got wrong -- it reported "no
    // index used" against a plan that says, in full, that the index was used.
    private string Unquoted => Plan.Replace("\"", string.Empty, StringComparison.Ordinal);

    /// <summary>True when <paramref name="indexName"/> appears as a scan node's index.</summary>
    /// <remarks>
    /// Covers both spellings Postgres uses: <c>Index Scan using X</c> / <c>Index Only Scan
    /// using X</c>, and <c>Bitmap Index Scan on X</c>.
    /// </remarks>
    public bool Uses(string indexName)
        => Unquoted.Contains("Scan using " + indexName, StringComparison.Ordinal)
            || Unquoted.Contains("Index Scan on " + indexName, StringComparison.Ordinal);

    /// <summary>True when any node sequentially scans <paramref name="table"/>.</summary>
    public bool SequentiallyScans(string table)
        => Unquoted.Contains("Seq Scan on " + table, StringComparison.Ordinal);
}
