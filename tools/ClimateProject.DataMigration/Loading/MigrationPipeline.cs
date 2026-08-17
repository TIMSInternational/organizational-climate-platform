using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace ClimateProject.DataMigration.Loading;

public sealed record CollectionResult(string Collection, long SourceCount, int Written, int Skipped);

public sealed record MigrationResult(IReadOnlyList<CollectionResult> Collections)
{
    /// <summary>
    /// Reconciliation layer 1 (sub-issue E): source documents = rows written + skips,
    /// with the skips accounted by name in the report. A count that reconciles only
    /// because a skip went uncounted is the named trap - so this throws.
    /// </summary>
    public void AssertReconciled()
    {
        foreach (var result in Collections)
        {
            if (result.SourceCount != result.Written + result.Skipped)
            {
                throw new InvalidOperationException(
                    $"{result.Collection} does not reconcile: {result.SourceCount} source documents, "
                    + $"{result.Written} written + {result.Skipped} skipped = {result.Written + result.Skipped}.");
            }
        }
    }
}

/// <summary>
/// The foundational load: Company -> DemographicField -> Department -> User ->
/// SystemSettings, in FK order, then the second pass for the three self- and
/// cross-referential columns (department parent, department manager, user manager)
/// that cannot be satisfied on first insert. Reference targets are the ids present in
/// the TARGET database plus this run's own writes, so a filtered or resumed run
/// resolves against what earlier runs already loaded.
///
/// Writes are fetch-then-update upserts on the deterministic id: last run wins for
/// every mapped column, and columns the app initialises itself (User.SecurityStamp)
/// are never copied - a re-keyed stamp ends live sessions (sub-issue D).
/// </summary>
public sealed class MigrationPipeline(
    IMongoDatabase mongo,
    ClimateProjectDbContext db,
    DataQualityReport report,
    bool dryRun)
{
    public static readonly IReadOnlyList<string> MappedCollections =
        ["companies", "demographicfields", "departments", "users", "systemsettings"];

    private readonly List<CollectionResult> _results = [];
    private readonly List<MappedDepartment> _departmentsThisRun = [];
    private readonly List<MappedUser> _usersThisRun = [];

    public async Task<MigrationResult> RunAsync(IReadOnlyList<string> collections, CancellationToken ct)
    {
        var wanted = collections.Count == 0
            ? MappedCollections
            : collections;

        var unmapped = wanted.Except(MappedCollections, StringComparer.Ordinal).ToList();
        if (unmapped.Count > 0)
        {
            // Fail rather than pretend: a run that silently ignores collections it
            // cannot load reads as "migrated" to whoever launched it.
            throw new NotSupportedException(
                $"No mapping exists yet for: {string.Join(", ", unmapped)}. Implemented so far: "
                + $"{string.Join(", ", MappedCollections)} (sub-issues #335-#339 track the rest).");
        }

        if (wanted.Contains("companies"))
        {
            await LoadCompaniesAsync(ct);
        }

        var context = await BuildContextAsync(ct);

        if (wanted.Contains("demographicfields"))
        {
            await LoadDemographicFieldsAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("departments"))
        {
            await LoadDepartmentsAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("users"))
        {
            await LoadUsersAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("systemsettings"))
        {
            await LoadSystemSettingsAsync(context, ct);
        }

        await SecondPassAsync(context, ct);
        AssertDepartmentHierarchy();

        return new MigrationResult(_results);
    }

    private async Task<MappingContext> BuildContextAsync(CancellationToken ct)
    {
        // Target-side truth plus this run's in-memory writes (which in dry-run never
        // reach the database but must still resolve for later stages).
        var companies = (await db.Companies.Select(c => new { c.Id, c.Settings.Language }).ToListAsync(ct))
            .ToDictionary(c => c.Id, c => c.Language);
        foreach (var entry in db.Companies.Local)
        {
            companies[entry.Id] = entry.Settings.Language;
        }

        var departments = (await db.Departments.Select(d => d.Id).ToListAsync(ct)).ToHashSet();
        departments.UnionWith(db.Departments.Local.Select(d => d.Id));
        departments.UnionWith(_departmentsThisRun.Select(d => d.Department.Id));

        var fields = new Dictionary<(Guid, string), Guid>();
        foreach (var field in await db.DemographicFields.Select(f => new { f.Id, f.CompanyId, f.Field }).ToListAsync(ct))
        {
            fields[(field.CompanyId, field.Field)] = field.Id;
        }

        foreach (var field in db.DemographicFields.Local)
        {
            fields[(field.CompanyId, field.Field)] = field.Id;
        }

        return new MappingContext
        {
            Report = report,
            Companies = companies.Keys.ToHashSet(),
            CompanyLanguages = companies,
            Departments = departments,
            DemographicFields = fields,
        };
    }

    private async Task LoadCompaniesAsync(CancellationToken ct)
    {
        var context = await BuildContextAsync(ct);
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyCompany>("companies", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (CompanyMapper.Map(document, context) is not { } company)
            {
                continue;
            }

            var existing = await db.Companies.FindAsync([company.Id], ct);
            if (existing is null)
            {
                db.Companies.Add(company);
            }
            else
            {
                existing.Name = company.Name;
                existing.EmailDomain = company.EmailDomain;
                existing.Industry = company.Industry;
                existing.Size = company.Size;
                existing.Country = company.Country;
                existing.SubscriptionTier = company.SubscriptionTier;
                existing.Branding = company.Branding;
                existing.Settings = company.Settings;
                existing.CreatedAt = company.CreatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("companies", source, written, report.SkipCount("companies")));
    }

    private async Task LoadDemographicFieldsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyDemographicField>("demographicfields", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (DemographicFieldMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.DemographicFields.FindAsync([mapped.Field.Id], ct);
            if (existing is null)
            {
                db.DemographicFields.Add(mapped.Field);
            }
            else
            {
                existing.CompanyId = mapped.Field.CompanyId;
                existing.Field = mapped.Field.Field;
                existing.LabelEn = mapped.Field.LabelEn;
                existing.LabelEs = mapped.Field.LabelEs;
                existing.Type = mapped.Field.Type;
                existing.Required = mapped.Field.Required;
                existing.Order = mapped.Field.Order;
                existing.IsActive = mapped.Field.IsActive;
                existing.CreatedAt = mapped.Field.CreatedAt;
                existing.UpdatedAt = mapped.Field.UpdatedAt;
            }

            // Options are replaced wholesale: their identity is (field, order) and the
            // set converges to the source on every run.
            var stale = await db.DemographicFieldOptions
                .Where(o => o.DemographicFieldId == mapped.Field.Id).ToListAsync(ct);
            db.DemographicFieldOptions.RemoveRange(stale);
            db.DemographicFieldOptions.AddRange(mapped.Options);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("demographicfields", source, written, report.SkipCount("demographicfields")));
    }

    private async Task LoadDepartmentsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seenLegacyExternalIds = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacyDepartment>("departments", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (DepartmentMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            // legacy_external_id carries a filtered unique index; a collision aborts
            // climate-tracking's cache sync wholesale, so it is refused here by name.
            if (!seenLegacyExternalIds.Add(mapped.Department.LegacyExternalId!))
            {
                report.Skip(MigrationRules.DuplicateLegacyExternalId, "departments",
                    document.Id.ToString(),
                    "another department already carries this legacy _id; the unique index would refuse it");
                continue;
            }

            var existing = await db.Departments.FindAsync([mapped.Department.Id], ct);
            if (existing is null)
            {
                db.Departments.Add(mapped.Department);
            }
            else
            {
                existing.LegacyExternalId = mapped.Department.LegacyExternalId;
                existing.CompanyId = mapped.Department.CompanyId;
                existing.Name = mapped.Department.Name;
                existing.Description = mapped.Department.Description;
                existing.EmployeeCount = mapped.Department.EmployeeCount;
                existing.IsActive = mapped.Department.IsActive;
                existing.Settings = mapped.Department.Settings;
                existing.CreatedAt = mapped.Department.CreatedAt;
                existing.UpdatedAt = mapped.Department.UpdatedAt;
            }

            _departmentsThisRun.Add(mapped);
            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("departments", source, written, report.SkipCount("departments")));
    }

    private async Task LoadUsersAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seenEmails = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacyUser>("users", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (UserMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            // users.email is unique; the second document with an email is the anomaly
            // (ascending-_id order makes "first" deterministic across runs).
            if (!seenEmails.Add(mapped.User.Email))
            {
                report.Skip(MigrationRules.DuplicateEmail, "users", document.Id.ToString(),
                    $"another user already carries '{mapped.User.Email}'; the unique index would refuse it",
                    field: null);
                continue;
            }

            var existing = await db.Users.FindAsync([mapped.User.Id], ct);
            if (existing is null)
            {
                // SecurityStamp: the entity's own initializer mints one on insert; the
                // mapper never set it, and the update branch never copies it (#284).
                db.Users.Add(mapped.User);
            }
            else
            {
                existing.CompanyId = mapped.User.CompanyId;
                existing.Email = mapped.User.Email;
                existing.Name = mapped.User.Name;
                existing.PasswordHash = mapped.User.PasswordHash;
                existing.Role = mapped.User.Role;
                existing.PersonaExternalId = mapped.User.PersonaExternalId;
                existing.DepartmentId = mapped.User.DepartmentId;
                existing.IsActive = mapped.User.IsActive;
                existing.LastLoginAt = mapped.User.LastLoginAt;
                existing.ConsentUpdatedAt = mapped.User.ConsentUpdatedAt;
                existing.Preferences = mapped.User.Preferences;
                existing.Notifications = mapped.User.Notifications;
                existing.Consent = mapped.User.Consent;
                existing.CreatedAt = mapped.User.CreatedAt;
                existing.UpdatedAt = mapped.User.UpdatedAt;
            }

            var staleDemographics = await db.UserDemographics
                .Where(d => d.UserId == mapped.User.Id).ToListAsync(ct);
            db.UserDemographics.RemoveRange(staleDemographics);
            db.UserDemographics.AddRange(mapped.Demographics);

            _usersThisRun.Add(mapped);
            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("users", source, written, report.SkipCount("users")));
    }

    private async Task LoadSystemSettingsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacySystemSettings>("systemsettings", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            var mapped = SystemSettingsMapper.Map(document, context);

            var existing = await db.SystemSettings.FindAsync([mapped.Id], ct);
            if (existing is null)
            {
                db.SystemSettings.Add(mapped);
            }
            else
            {
                existing.LoginEnabled = mapped.LoginEnabled;
                existing.MaintenanceMode = mapped.MaintenanceMode;
                existing.MaintenanceMessageEn = mapped.MaintenanceMessageEn;
                existing.MaintenanceMessageEs = mapped.MaintenanceMessageEs;
                existing.MaxLoginAttempts = mapped.MaxLoginAttempts;
                existing.SessionTimeoutMinutes = mapped.SessionTimeoutMinutes;
                existing.PasswordPolicy = mapped.PasswordPolicy;
                existing.EmailSettings = mapped.EmailSettings;
                existing.CreatedAt = mapped.CreatedAt;
                existing.UpdatedAt = mapped.UpdatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("systemsettings", source, written, report.SkipCount("systemsettings")));
    }

    /// <summary>
    /// The second pass: cheap UPDATEs on deterministic ids, cycle-proof by
    /// construction. Covers only what this run mapped - a filtered run's pass is
    /// filtered with it.
    /// </summary>
    private async Task SecondPassAsync(MappingContext context, CancellationToken ct)
    {
        foreach (var mapped in _departmentsThisRun)
        {
            var department = await db.Departments.FindAsync([mapped.Department.Id], ct);
            if (department is null)
            {
                continue; // dry run
            }

            department.ParentDepartmentId = ResolveSecondPassRef(
                "departments", mapped.Department.LegacyExternalId!, "hierarchy.parent_department_id",
                mapped.LegacyParentId, context.Departments, DepartmentMapper.Collection);

            var users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
            users.UnionWith(db.Users.Local.Select(u => u.Id));
            department.ManagerId = ResolveSecondPassRef(
                "departments", mapped.Department.LegacyExternalId!, "manager_id",
                mapped.LegacyManagerId, users, UserMapper.Collection);
        }

        if (_usersThisRun.Count > 0)
        {
            var users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
            users.UnionWith(db.Users.Local.Select(u => u.Id));
            foreach (var mapped in _usersThisRun)
            {
                var user = await db.Users.FindAsync([mapped.User.Id], ct);
                if (user is null)
                {
                    continue; // dry run
                }

                user.ManagerId = ResolveSecondPassRef(
                    "users", mapped.User.PersonaExternalId!, "manager_id",
                    mapped.LegacyManagerId, users, UserMapper.Collection);
            }
        }

        await SaveAsync(ct);
    }

    private Guid? ResolveSecondPassRef(
        string collection, string legacyId, string field,
        string? reference, IReadOnlySet<Guid> targets, string referencedCollection)
    {
        var classification = ReferenceResolver.Classify(referencedCollection, reference, targets);
        switch (classification.Kind)
        {
            case ReferenceKind.Resolved:
                return classification.TargetId;
            case ReferenceKind.Absent:
                return null;
            default:
                report.Degraded(
                    classification.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    collection, legacyId, field,
                    $"'{reference}' is {classification.Kind}; loaded as NULL");
                return null;
        }
    }

    /// <summary>
    /// The design doc's integrity check: legacy level/path are derived values with no
    /// target column, so they are recomputed from ParentDepartmentId and every
    /// disagreement is a report line - they catch a mis-loaded parent chain the way a
    /// checksum catches a bad copy.
    /// </summary>
    private void AssertDepartmentHierarchy()
    {
        if (_departmentsThisRun.Count == 0)
        {
            return;
        }

        var byId = _departmentsThisRun.ToDictionary(d => d.Department.Id);
        var byLegacyId = _departmentsThisRun.ToDictionary(d => d.Department.LegacyExternalId!, StringComparer.Ordinal);

        foreach (var mapped in _departmentsThisRun)
        {
            var (level, path) = RecomputeHierarchy(mapped, byLegacyId);
            if (mapped.LegacyLevel is { } legacyLevel && legacyLevel != level)
            {
                report.Integrity(MigrationRules.DepartmentHierarchyMismatch, "departments",
                    mapped.Department.LegacyExternalId!, "hierarchy.level",
                    $"legacy says {legacyLevel}, the loaded parent chain says {level}");
            }

            if (mapped.LegacyPath is { } legacyPath && !string.Equals(legacyPath, path, StringComparison.Ordinal))
            {
                report.Integrity(MigrationRules.DepartmentHierarchyMismatch, "departments",
                    mapped.Department.LegacyExternalId!, "hierarchy.path",
                    $"legacy says '{legacyPath}', the loaded parent chain says '{path}'");
            }
        }
    }

    private static (int Level, string Path) RecomputeHierarchy(
        MappedDepartment department, IReadOnlyDictionary<string, MappedDepartment> byLegacyId)
    {
        // Mirrors the legacy pre-save hook: path segments are the lowercased,
        // whitespace-collapsed names up the parent chain.
        var segments = new List<string>();
        var current = department;
        var hops = 0;
        while (true)
        {
            segments.Insert(0, Slug(current.Department.Name));
            if (current.LegacyParentId is null
                || !byLegacyId.TryGetValue(current.LegacyParentId, out var parent)
                || ++hops > 64)
            {
                break;
            }

            current = parent;
        }

        return (segments.Count - 1, string.Join('/', segments));
    }

    private static string Slug(string name)
        => System.Text.RegularExpressions.Regex.Replace(name.ToLowerInvariant(), @"\s+", "-");

    private async IAsyncEnumerable<TDocument> Read<TDocument>(
        string collection, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        where TDocument : LegacyDocument
    {
        var reader = new LegacyCollectionReader<TDocument>(collection);
        await foreach (var document in reader.ReadAllAsync(mongo, ct))
        {
            yield return (TDocument)document;
        }
    }

    private Task<int> SaveAsync(CancellationToken ct)
        => dryRun ? Task.FromResult(0) : db.SaveChangesAsync(ct);
}
