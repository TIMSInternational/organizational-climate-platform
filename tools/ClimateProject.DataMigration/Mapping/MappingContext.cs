using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>
/// What a mapper is allowed to know: the ids already migrated (for reference
/// classification), each company's content language (for #195 attribution), and the
/// report. Mappers are pure functions over (document, context) - no database, no
/// clock, no randomness - which is what makes them unit-testable against fixture
/// documents including the deliberately non-nominal ones.
/// </summary>
public sealed class MappingContext
{
    public required DataQualityReport Report { get; init; }

    public IReadOnlySet<Guid> Companies { get; init; } = new HashSet<Guid>();

    /// <summary>Company content language ('en' or 'es'), the #195 attribution signal.</summary>
    public IReadOnlyDictionary<Guid, string> CompanyLanguages { get; init; } =
        new Dictionary<Guid, string>();

    public IReadOnlySet<Guid> Departments { get; init; } = new HashSet<Guid>();

    /// <summary>The company's demographic vocabulary: (company, field key) -> field id.</summary>
    public IReadOnlyDictionary<(Guid CompanyId, string Field), Guid> DemographicFields { get; init; } =
        new Dictionary<(Guid, string), Guid>();

    public string LanguageOf(Guid companyId)
        => CompanyLanguages.TryGetValue(companyId, out var language) && language == "es" ? "es" : "en";
}

internal static class MapperHelpers
{
    /// <summary>
    /// created_at/updated_at come from Mongoose timestamps and are UTC. A document
    /// without one gets the timestamp its ObjectId embeds - a named rule, because
    /// fabricating "now" would be a silent fix that moves data into the run's own time.
    /// </summary>
    public static DateTimeOffset Timestamp(
        DateTime? value, ObjectId id, string collection, string field, DataQualityReport report)
    {
        if (value is { } present)
        {
            return new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc));
        }

        report.Normalisation(
            MigrationRules.TimestampFromObjectId, collection, id.ToString(), field,
            "document carries no timestamp; using the creation time embedded in its ObjectId");
        return id.CreationTime;
    }

    /// <summary>Every undeclared field, top-level or nested, is a report line (sub-issue B's honesty AC).</summary>
    public static void ReportExtras(
        DataQualityReport report, string collection, ObjectId id,
        params (string Prefix, BsonDocument? Extra)[] extras)
    {
        foreach (var (prefix, extra) in extras)
        {
            if (extra is null)
            {
                continue;
            }

            foreach (var element in extra.Elements)
            {
                report.UnmappedExtra(collection, id.ToString(),
                    prefix.Length == 0 ? element.Name : $"{prefix}.{element.Name}");
            }
        }
    }

    public static string? Trimmed(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
