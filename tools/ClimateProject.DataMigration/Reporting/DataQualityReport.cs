using System.Text.Json;

namespace ClimateProject.DataMigration.Reporting;

public enum ReportEntryKind
{
    /// <summary>A whole document that was not written, with the reason. These are the
    /// entries reconciliation counts: source = written + skips, exactly.</summary>
    Skip,

    /// <summary>A single field loaded as NULL because its reference could not resolve.
    /// The row itself was written - degradations never enter the skip count.</summary>
    Degraded,

    /// <summary>A monolingual content field routed to _en or _es by Company.language (#195).</summary>
    Attribution,

    /// <summary>A named normalisation rule fired (never an inline silent fix).</summary>
    Normalisation,

    /// <summary>A field the typed stub did not declare arrived in a document's Extra.</summary>
    UnmappedExtra,

    /// <summary>A recomputed-vs-legacy disagreement (e.g. Department level/path).</summary>
    IntegrityFinding,
}

/// <summary>One reportable fact about one document (or one field of one document).</summary>
public sealed record ReportEntry(
    string Rule,
    ReportEntryKind Kind,
    string Collection,
    string? LegacyId,
    string? Field,
    string Reason);

/// <summary>
/// The data-quality report: the reviewable deliverable of a run (sub-issue E). Every
/// document not migrated cleanly, every language attribution and every normalisation
/// that fired lands here by NAME, so the report enumerates rules rather than prose.
/// Skips are load-bearing: reconciliation asserts source count == written + skips per
/// collection, and a skip that bypasses this report breaks that equation loudly.
/// </summary>
public sealed class DataQualityReport
{
    private readonly List<ReportEntry> _entries = [];

    public IReadOnlyList<ReportEntry> Entries => _entries;

    public void Add(ReportEntry entry) => _entries.Add(entry);

    public void Skip(string rule, string collection, string legacyId, string reason, string? field = null)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Skip, collection, legacyId, field, reason));

    public void Attribution(string collection, string legacyId, string field, string language)
        => _entries.Add(new ReportEntry(
            MigrationRules.LanguageAttribution, ReportEntryKind.Attribution, collection, legacyId, field,
            $"monolingual content attributed to '{language}'"));

    public void Normalisation(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Normalisation, collection, legacyId, field, reason));

    public void UnmappedExtra(string collection, string legacyId, string field)
        => _entries.Add(new ReportEntry(
            MigrationRules.UnmappedField, ReportEntryKind.UnmappedExtra, collection, legacyId, field,
            "field present in the document but undeclared by the typed stub"));

    public void Integrity(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.IntegrityFinding, collection, legacyId, field, reason));

    /// <summary>Skips for one collection - the number reconciliation holds against the source count.</summary>
    public int SkipCount(string collection)
        => _entries.Count(e => e.Kind == ReportEntryKind.Skip && e.Collection == collection);

    public void Degraded(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Degraded, collection, legacyId, field, reason));

    public IReadOnlyDictionary<string, int> CountsByRule()
        => _entries.GroupBy(e => e.Rule).ToDictionary(g => g.Key, g => g.Count());

    /// <summary>One file per run. JSON, counts first, then every entry.</summary>
    public async Task WriteAsync(string path, CancellationToken cancellationToken)
    {
        var payload = new
        {
            counts = CountsByRule().OrderBy(p => p.Key).ToDictionary(p => p.Key, p => p.Value),
            entries = _entries,
        };
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await using var stream = File.Create(path);
        await JsonSerializer.SerializeAsync(stream, payload, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
    }
}

/// <summary>
/// Every rule the pipeline can fire, by name. The report enumerates these; the tests
/// exercise them one by one. A rule that is not named here does not exist.
/// </summary>
public static class MigrationRules
{
    public const string LanguageAttribution = "content.language-attribution";
    public const string UnmappedField = "document.unmapped-field";

    public const string MissingRequiredField = "document.missing-required-field";
    public const string DanglingReference = "reference.dangling";
    public const string MalformedReference = "reference.malformed";

    public const string DemographicKeyUnresolved = "user.demographic-key-unresolved";
    public const string DemographicValueOverlong = "user.demographic-value-overlong";
    public const string DemographicValueNotScalar = "user.demographic-value-not-scalar";
    public const string RoleUnknown = "user.role-unknown";
    public const string DuplicateEmail = "user.duplicate-email";

    public const string DepartmentHierarchyMismatch = "department.hierarchy-mismatch";
    public const string DuplicateLegacyExternalId = "department.duplicate-legacy-external-id";

    public const string RoleDepartmentAdminRemapped = "user.role-department-admin-remapped";
    public const string CompanyInactiveDropped = "company.inactive-flag-dropped";
    public const string TimestampFromObjectId = "timestamp.from-object-id";
}
