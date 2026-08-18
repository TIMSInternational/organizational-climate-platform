using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The frozen audience. The rule these tests exist to pin: an entry's department, role
/// and tenure are the SNAPSHOT'S own strings, never resolved against today's
/// departments -- resolving them would rewrite history every time someone transfers,
/// which is exactly what a snapshot exists to prevent.
/// </summary>
public class DemographicSnapshotMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("656000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("656000000000000000000011");
    private static readonly ObjectId OtherUserOid = ObjectId.Parse("656000000000000000000012");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("656000000000000000000021");
    private static readonly ObjectId SnapshotOid = ObjectId.Parse("656000000000000000000031");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid OtherUserId = MigrationIds.For("users", OtherUserOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);

    private static LegacyDemographicSnapshot Load(BsonDocument document)
        => BsonSerializer.Deserialize<LegacyDemographicSnapshot>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        Users = new HashSet<Guid> { UserId, OtherUserId },
        Surveys = new HashSet<Guid> { SurveyId },
    };

    private static BsonDocument NominalSnapshot() => new()
    {
        ["_id"] = SnapshotOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["company_id"] = CompanyOid.ToString(),
        ["version"] = 2,
        ["timestamp"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
        ["created_by"] = UserOid.ToString(),
        ["reason"] = "Audience frozen at launch",
        ["demographics"] = new BsonArray
        {
            new BsonDocument
            {
                ["user_id"] = UserOid.ToString(),
                // The department the person was in THEN, as a string.
                ["department"] = "Engineering",
                ["role"] = "employee",
                ["tenure"] = "1-3",
                ["location"] = "Santiago",
                ["custom_attributes"] = new BsonDocument { ["shift"] = "day" },
            },
            new BsonDocument
            {
                ["user_id"] = OtherUserOid.ToString(),
                ["department"] = "Sales",
                ["role"] = "leader",
                // tenure is NOT NULL: a placeholder would invent a segment.
            },
        },
        ["changes"] = new BsonArray
        {
            new BsonDocument
            {
                ["field"] = "department", ["old_value"] = "Sales", ["new_value"] = "Engineering",
                ["changed_by"] = UserOid.ToString(),
                ["timestamp"] = new DateTime(2026, 6, 30, 0, 0, 0, DateTimeKind.Utc),
                ["reason"] = "Transfer",
            },
            new BsonDocument { ["old_value"] = "x", ["changed_by"] = UserOid.ToString() }, // no field
        },
        ["metadata"] = new BsonDocument
        {
            ["total_users"] = 240,
            ["departments_count"] = 6,
            ["roles_distribution"] = new BsonDocument { ["employee"] = 200 },
        },
        ["created_at"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Snapshot_keeps_the_audience_exactly_as_it_stood()
    {
        var report = new DataQualityReport();

        var mapped = DemographicSnapshotMapper.Map(Load(NominalSnapshot()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(SurveyId, mapped!.Snapshot.SurveyId);
        Assert.Equal(2, mapped.Snapshot.Version);
        Assert.Equal(240, mapped.Snapshot.Metadata.TotalUsers);
        Assert.Contains("employee", mapped.Snapshot.Metadata.RolesDistribution);

        // The complete entry survives with its own strings, unresolved.
        var entry = Assert.Single(mapped.Entries);
        Assert.Equal(UserId, entry.UserId);
        Assert.Equal("Engineering", entry.Department);
        Assert.Equal("1-3", entry.Tenure);
        Assert.Contains("day", entry.CustomAttributes);

        // The entry missing NOT NULL tenure is dropped, not defaulted.
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SnapshotEntryIncomplete);

        var change = Assert.Single(mapped.Changes);
        Assert.Equal("department", change.Field);
        Assert.Equal("Sales", change.OldValue);
        Assert.Equal("Engineering", change.NewValue);
        Assert.Equal(UserId, change.ChangedBy);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SnapshotChangeIncomplete);
    }

    [Fact]
    public void An_entry_keys_on_its_user_so_the_same_person_cannot_appear_twice()
    {
        var report = new DataQualityReport();
        var doc = NominalSnapshot();
        doc["demographics"] = new BsonArray
        {
            new BsonDocument
            {
                ["user_id"] = UserOid.ToString(), ["department"] = "Engineering",
                ["role"] = "employee", ["tenure"] = "1-3",
            },
            new BsonDocument
            {
                ["user_id"] = UserOid.ToString(), ["department"] = "Sales",
                ["role"] = "employee", ["tenure"] = "3+",
            },
        };

        var mapped = DemographicSnapshotMapper.Map(Load(doc), Context(report));

        // Two truths about one person at one instant is not a thing.
        var entry = Assert.Single(mapped!.Entries);
        Assert.Equal("Engineering", entry.Department);
        Assert.Equal(
            MigrationIds.ForChild("demographicsnapshots", SnapshotOid,
                DemographicSnapshotMapper.EntryScope, UserOid.ToString()),
            entry.Id);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SnapshotEntryIncomplete);
    }

    [Fact]
    public void An_entry_whose_user_never_migrated_is_dropped_not_orphaned()
    {
        var report = new DataQualityReport();
        var doc = NominalSnapshot();
        doc["demographics"] = new BsonArray
        {
            new BsonDocument
            {
                ["user_id"] = ObjectId.GenerateNewId().ToString(), ["department"] = "Ghosts",
                ["role"] = "employee", ["tenure"] = "1-3",
            },
        };

        var mapped = DemographicSnapshotMapper.Map(Load(doc), Context(report));

        Assert.Empty(mapped!.Entries);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SnapshotEntryIncomplete);
    }

    [Fact]
    public void A_non_scalar_change_value_is_rendered_rather_than_lost()
    {
        var report = new DataQualityReport();
        var doc = NominalSnapshot();
        doc["changes"] = new BsonArray
        {
            new BsonDocument
            {
                ["field"] = "custom_attributes",
                ["old_value"] = new BsonDocument { ["shift"] = "day" },
                ["new_value"] = 42,
                ["changed_by"] = UserOid.ToString(),
            },
        };

        var mapped = DemographicSnapshotMapper.Map(Load(doc), Context(report));

        var change = Assert.Single(mapped!.Changes);
        // The audit value of a change is that it can be read back.
        Assert.Contains("shift", change.OldValue);
        Assert.Equal("42", change.NewValue);
    }

    [Fact]
    public void A_snapshot_whose_survey_or_author_is_gone_is_a_reported_skip()
    {
        foreach (var field in new[] { "survey_id", "created_by" })
        {
            var report = new DataQualityReport();
            var doc = NominalSnapshot();
            doc[field] = ObjectId.GenerateNewId().ToString();

            Assert.Null(DemographicSnapshotMapper.Map(Load(doc), Context(report)));
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal(field, entry.Field);
        }
    }

    [Fact]
    public void A_snapshot_without_a_reason_keeps_its_entries_behind_a_placeholder()
    {
        var report = new DataQualityReport();
        var doc = NominalSnapshot();
        doc.Remove("reason");

        var mapped = DemographicSnapshotMapper.Map(Load(doc), Context(report));

        Assert.Contains("no reason recorded", mapped!.Snapshot.Reason);
        Assert.NotEmpty(mapped.Entries);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }
}
