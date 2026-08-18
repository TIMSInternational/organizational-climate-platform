using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped snapshot and its two fan-outs.</summary>
public sealed record MappedDemographicSnapshot(
    DemographicSnapshot Snapshot,
    IReadOnlyList<DemographicSnapshotEntry> Entries,
    IReadOnlyList<DemographicSnapshotChange> Changes);

/// <summary>
/// A frozen record of who the audience WAS when a survey ran - which is the only thing
/// that makes a historical segment result reproducible after people move teams. That
/// makes the entries evidence, and it decides the two judgement calls here:
///
/// - <b>The entry's department/role/tenure are the SNAPSHOT'S strings, not the user's
///   current ones.</b> All three are NOT NULL text columns on the target, deliberately
///   denormalised: resolving them against today's Department rows would silently
///   rewrite history every time someone transfers, which is precisely what a snapshot
///   exists to prevent. Only user_id is resolved to an FK.
/// - <b>An entry missing any of the three is dropped, not defaulted.</b> A placeholder
///   segment would land real people in a bucket they were never in, and segment results
///   are exactly what these rows feed.
///
/// Changes carry Mixed old/new values into text columns, so a non-scalar is rendered as
/// its JSON rather than lost - the audit value of a change is that it can be read back.
/// </summary>
public static class DemographicSnapshotMapper
{
    public const string Collection = "demographicsnapshots";
    public const string EntryScope = "demographics";
    public const string ChangeScope = "changes";

    public static MappedDemographicSnapshot? Map(LegacyDemographicSnapshot doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra), ("metadata", doc.Metadata?.Extra));

        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SurveyId, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{doc.SurveyId}' is {surveyRef.Kind}; a snapshot describes one survey's audience",
                "survey_id");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "company_id does not resolve; the column is a non-nullable FK", "company_id");
            return null;
        }

        var creatorRef = ReferenceResolver.Classify(UserMapper.Collection, doc.CreatedBy, context.Users);
        if (creatorRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                creatorRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "created_by does not resolve; the column is a non-nullable FK", "created_by");
            return null;
        }

        // reason is NOT NULL and, unlike a version's, it is genuinely just a note - the
        // entries are the irreplaceable part, so a marked placeholder beats losing them.
        var reason = MapperHelpers.Truncated(doc.Reason, 500, Collection, legacyId, "reason", report);
        if (reason is null)
        {
            reason = "(no reason recorded in the legacy system)";
            report.Normalisation(MigrationRules.AuditActorFieldFabricated, Collection, legacyId, "reason",
                "snapshot carries no reason; the target column is NOT NULL, so a marked placeholder is used");
        }

        var createdAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report);
        var snapshot = new DemographicSnapshot
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyRef.TargetId!.Value,
            CompanyId = companyRef.TargetId!.Value,
            Version = doc.Version ?? 1,
            Timestamp = doc.Timestamp is { } stamped
                ? new DateTimeOffset(DateTime.SpecifyKind(stamped, DateTimeKind.Utc))
                : createdAt,
            CreatedBy = creatorRef.TargetId!.Value,
            Reason = reason,
            IsActive = doc.IsActive ?? true,
            CreatedAt = createdAt,
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.Metadata is { } metadata)
        {
            snapshot.Metadata.TotalUsers = metadata.TotalUsers ?? 0;
            snapshot.Metadata.DepartmentsCount = metadata.DepartmentsCount ?? 0;
            snapshot.Metadata.RolesDistribution = LegacyJson.Serialize(metadata.RolesDistribution);
            snapshot.Metadata.TenureDistribution = LegacyJson.Serialize(metadata.TenureDistribution);
        }

        return new MappedDemographicSnapshot(
            snapshot,
            MapEntries(doc, snapshot.Id, legacyId, context),
            MapChanges(doc, snapshot.Id, legacyId, context));
    }

    private static List<DemographicSnapshotEntry> MapEntries(
        LegacyDemographicSnapshot doc, Guid snapshotId, string legacyId, MappingContext context)
    {
        var report = context.Report;
        var entries = new List<DemographicSnapshotEntry>();
        var seen = new HashSet<Guid>();
        for (var index = 0; index < (doc.Demographics?.Count ?? 0); index++)
        {
            var legacy = doc.Demographics![index];
            var field = $"demographics[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var userRef = ReferenceResolver.Classify(UserMapper.Collection, legacy.UserId, context.Users);
            if (userRef.Kind != ReferenceKind.Resolved)
            {
                report.Normalisation(MigrationRules.SnapshotEntryIncomplete, Collection, legacyId, field,
                    $"user_id '{legacy.UserId}' is {userRef.Kind}; user_id is a non-nullable FK on the entry");
                continue;
            }

            // These three are the snapshot's OWN strings, denormalised on purpose:
            // resolving them against today's departments would rewrite history.
            var department = MapperHelpers.Truncated(
                legacy.Department, 200, Collection, legacyId, $"{field}.department", report);
            var role = MapperHelpers.Truncated(legacy.Role, 32, Collection, legacyId, $"{field}.role", report);
            var tenure = MapperHelpers.Truncated(legacy.Tenure, 100, Collection, legacyId, $"{field}.tenure", report);
            if (department is null || role is null || tenure is null)
            {
                report.Normalisation(MigrationRules.SnapshotEntryIncomplete, Collection, legacyId, field,
                    "entry is missing department, role or tenure, all NOT NULL; a placeholder would put a real "
                    + "person in a segment they were never in, and segment results read these rows");
                continue;
            }

            // One row per user per snapshot: a repeat would be two truths about the
            // same person at the same instant.
            if (!seen.Add(userRef.TargetId!.Value))
            {
                report.Normalisation(MigrationRules.SnapshotEntryIncomplete, Collection, legacyId, field,
                    "another entry in this snapshot already describes this user");
                continue;
            }

            entries.Add(new DemographicSnapshotEntry
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, EntryScope, legacy.UserId!.Trim()),
                SnapshotId = snapshotId,
                UserId = userRef.TargetId!.Value,
                Department = department,
                Role = role,
                Tenure = tenure,
                Location = MapperHelpers.Truncated(legacy.Location, 200, Collection, legacyId, $"{field}.location", report),
                Team = MapperHelpers.Truncated(legacy.Team, 200, Collection, legacyId, $"{field}.team", report),
                Level = MapperHelpers.Truncated(legacy.Level, 100, Collection, legacyId, $"{field}.level", report),
                CustomAttributes = LegacyJson.Serialize(legacy.CustomAttributes),
            });
        }

        return entries;
    }

    private static List<DemographicSnapshotChange> MapChanges(
        LegacyDemographicSnapshot doc, Guid snapshotId, string legacyId, MappingContext context)
    {
        var report = context.Report;
        var changes = new List<DemographicSnapshotChange>();
        for (var index = 0; index < (doc.Changes?.Count ?? 0); index++)
        {
            var legacy = doc.Changes![index];
            var field = $"changes[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var changedField = MapperHelpers.Truncated(
                legacy.Field, 100, Collection, legacyId, $"{field}.field", report);
            var changedByRef = ReferenceResolver.Classify(UserMapper.Collection, legacy.ChangedBy, context.Users);
            if (changedField is null || changedByRef.Kind != ReferenceKind.Resolved)
            {
                report.Normalisation(MigrationRules.SnapshotChangeIncomplete, Collection, legacyId, field,
                    "change is missing its field name or its actor, both NOT NULL; a change that says neither "
                    + "what altered nor who altered it records nothing");
                continue;
            }

            changes.Add(new DemographicSnapshotChange
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, ChangeScope, $"#{index}"),
                SnapshotId = snapshotId,
                Field = changedField,
                OldValue = TextOf(legacy.OldValue),
                NewValue = TextOf(legacy.NewValue),
                ChangedBy = changedByRef.TargetId!.Value,
                Timestamp = legacy.Timestamp is { } stamped
                    ? new DateTimeOffset(DateTime.SpecifyKind(stamped, DateTimeKind.Utc))
                    : MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, $"{field}.timestamp", report),
                Reason = MapperHelpers.Truncated(legacy.Reason, 500, Collection, legacyId, $"{field}.reason", report),
            });
        }

        return changes;
    }

    /// <summary>
    /// old/new are Mixed and the target columns are text. A scalar becomes its own
    /// string; anything richer is rendered as JSON rather than dropped, because the
    /// whole value of a recorded change is that it can be read back.
    /// </summary>
    private static string? TextOf(BsonValue? value) => value?.BsonType switch
    {
        null or BsonType.Null or BsonType.Undefined => null,
        BsonType.String => MapperHelpers.Trimmed(value.AsString),
        BsonType.Int32 => value.AsInt32.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Int64 => value.AsInt64.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Double => value.AsDouble.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Boolean => value.AsBoolean ? "true" : "false",
        _ => LegacyJson.Serialize(value),
    };
}
