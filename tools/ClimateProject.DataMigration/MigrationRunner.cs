using ClimateProject.DataMigration.Loading;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace ClimateProject.DataMigration;

/// <summary>
/// The real runner for the collections a mapping exists for - the five foundational
/// ones today (see MigrationPipeline.MappedCollections). The scaffold's original
/// fail-rather-than-pretend property survives as a NARROWER refusal: asking for a
/// collection without a mapping throws with the sub-issue that tracks it, and a
/// default run loads exactly the mapped set, never silently "everything".
///
/// Run shape:
///   LEGACY_MONGO_URI=... LEGACY_MONGO_DB=... TARGET_POSTGRES_CONNECTION=... \
///     dotnet run --project tools/ClimateProject.DataMigration -- \
///     [--dry-run] [--collections=companies,users] [--resume] [--report-path=report.json]
/// </summary>
public static class MigrationRunner
{
    public static async Task RunAsync(string[] args)
    {
        var environment = new Dictionary<string, string?>();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            if (entry.Key.ToString() is { } key)
            {
                environment[key] = entry.Value?.ToString();
            }
        }

        var options = MigrationOptions.Parse(args, environment);
        options.AssertPostgresIsNotTransactionPooler();

        var report = new DataQualityReport();
        var mongo = new MongoClient(options.MongoUri).GetDatabase(options.MongoDatabase);

        var dbOptions = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(DatabaseConnectionStringPolicy.Apply(options.PostgresConnectionString).ConnectionString)
            .Options;
        await using var db = new ClimateProjectDbContext(dbOptions);

        var pipeline = new MigrationPipeline(mongo, db, report, options.DryRun);
        var result = await pipeline.RunAsync(options.Collections, CancellationToken.None);

        await report.WriteAsync(options.ReportPath, CancellationToken.None);
        result.AssertReconciled();

        foreach (var collection in result.Collections)
        {
            Console.WriteLine(
                $"{collection.Collection}: {collection.SourceCount} source, "
                + $"{collection.Written} written, {collection.Skipped} skipped"
                + (options.DryRun ? " (dry run - nothing persisted)" : string.Empty));
        }

        Console.WriteLine($"Data-quality report: {options.ReportPath} ({report.Entries.Count} entries)");
    }
}
