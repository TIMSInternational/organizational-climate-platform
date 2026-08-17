using ClimateProject.Infrastructure.Persistence;

namespace ClimateProject.DataMigration;

/// <summary>
/// The CLI surface the design doc names: --dry-run, --collections=&lt;list&gt;, --resume,
/// --report-path=&lt;file&gt;. Connection strings come from the environment
/// (LEGACY_MONGO_URI, LEGACY_MONGO_DB, TARGET_POSTGRES_CONNECTION), never from argv -
/// argv lands in shell history and process listings, and the legacy MONGODB_URI has
/// already been through one exposure window (#70).
///
/// --resume is a documented no-op alias for "run again": deterministic ids make every
/// write an upsert on the same key, so re-running IS resuming. It exists so an operator
/// mid-incident does not have to trust that claim from memory.
/// </summary>
public sealed record MigrationOptions(
    bool DryRun,
    IReadOnlyList<string> Collections,
    string ReportPath,
    string MongoUri,
    string MongoDatabase,
    string PostgresConnectionString)
{
    public static MigrationOptions Parse(string[] args, IReadOnlyDictionary<string, string?> environment)
    {
        var dryRun = false;
        var collections = new List<string>();
        string? reportPath = null;

        foreach (var arg in args)
        {
            if (arg == "--dry-run")
            {
                dryRun = true;
            }
            else if (arg == "--resume")
            {
                // Alias for "run again" - see the type doc. Parsed so it never errors.
            }
            else if (arg.StartsWith("--collections=", StringComparison.Ordinal))
            {
                collections.AddRange(arg["--collections=".Length..]
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
            }
            else if (arg.StartsWith("--report-path=", StringComparison.Ordinal))
            {
                reportPath = arg["--report-path=".Length..];
            }
            else
            {
                throw new ArgumentException(
                    $"Unknown argument '{arg}'. Supported: --dry-run, --collections=<list>, --resume, --report-path=<file>.");
            }
        }

        var mongoUri = Required(environment, "LEGACY_MONGO_URI");
        var mongoDb = Required(environment, "LEGACY_MONGO_DB");
        var postgres = Required(environment, "TARGET_POSTGRES_CONNECTION");

        return new MigrationOptions(
            dryRun,
            collections,
            reportPath ?? $"migration-report-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json",
            mongoUri,
            mongoDb,
            postgres);
    }

    /// <summary>
    /// The #220 guard, armed unconditionally for this tool: a bulk load through the
    /// transaction pooler is exactly the workload Supavisor transaction mode breaks.
    /// Refused at startup, before anything connects.
    /// </summary>
    public void AssertPostgresIsNotTransactionPooler()
    {
        var policy = DatabaseConnectionStringPolicy.Apply(PostgresConnectionString);
        var action = DatabaseConnectionStringPolicy.DecideTransactionPoolerAction(
            policy.UsesTransactionPoolerPort, requireSessionPooler: true);
        if (action == TransactionPoolerAction.Fail)
        {
            throw new InvalidOperationException(
                "TARGET_POSTGRES_CONNECTION points at the Supavisor TRANSACTION pooler (port 6543). "
                + "The ETL requires the session pooler (port 5432) - see #220 and "
                + "docs/migration/sub-issues.md (C).");
        }
    }

    private static string Required(IReadOnlyDictionary<string, string?> environment, string name)
        => environment.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value!
            : throw new InvalidOperationException(
                $"{name} is not set. The ETL reads its connections from the environment - see MigrationOptions.");
}
