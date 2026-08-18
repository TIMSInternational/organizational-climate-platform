using System.Text.Json;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The survey-history pair. The interesting surface is the vocabulary narrowing
/// (14 legacy actions -> 5 target ones, 9 entity types -> 3), the ObjectId-vs-string
/// reference divergence unique to surveyauditlogs, and the rule that a version snapshot
/// attributes as its SURVEY did rather than re-deriving from the company.
/// </summary>
public class SurveyHistoryMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("64f000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("64f000000000000000000011");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("64f000000000000000000021");
    private static readonly ObjectId EsSurveyOid = ObjectId.Parse("64f000000000000000000022");
    private static readonly ObjectId VersionOid = ObjectId.Parse("64f000000000000000000031");
    private static readonly ObjectId AuditOid = ObjectId.Parse("64f000000000000000000041");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);
    private static readonly Guid EsSurveyId = MigrationIds.For("surveys", EsSurveyOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en" },
        Users = new HashSet<Guid> { UserId },
        Surveys = new HashSet<Guid> { SurveyId, EsSurveyId },
        // The es survey belongs to the SAME en company: the version must follow the
        // survey, not the company, or history desynchronises from what shipped.
        SurveyLanguages = new Dictionary<Guid, string> { [SurveyId] = "en", [EsSurveyId] = "es" },
    };

    // ------------------------------------------------------------------
    // SurveyVersion
    // ------------------------------------------------------------------

    private static BsonDocument NominalVersion() => new()
    {
        ["_id"] = VersionOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["version_number"] = 2,
        ["title"] = "Q3 Climate Pulse",
        ["description"] = "How the quarter felt.",
        ["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "sq-1", ["text"] = "I feel safe.", ["type"] = "likert", ["order"] = 0 },
        },
        ["settings"] = new BsonDocument { ["anonymous"] = true },
        ["changes"] = new BsonArray { "Added a question", "  " },
        ["reason"] = "Added the psychological-safety item",
        ["created_by"] = UserOid.ToString(),
        ["created_at"] = new DateTime(2026, 7, 5, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Version_maps_nominal_document_and_snapshots_survive_verbatim()
    {
        var report = new DataQualityReport();

        var version = SurveyVersionMapper.Map(Load<LegacySurveyVersion>(NominalVersion()), Context(report));

        Assert.NotNull(version);
        Assert.Equal(MigrationIds.For("surveyversions", VersionOid), version!.Id);
        Assert.Equal(SurveyId, version.SurveyId);
        Assert.Equal(UserId, version.CreatedBy);
        Assert.Equal(2, version.VersionNumber);
        Assert.Equal("Q3 Climate Pulse", version.TitleEn);
        Assert.Null(version.TitleEs);
        Assert.Equal(["Added a question"], version.Changes);
        Assert.Equal("Added the psychological-safety item", version.Reason);

        // The snapshot is evidence of what respondents saw: stored as JSON, not
        // re-mapped through today's question rules.
        Assert.NotNull(version.QuestionsSnapshot);
        using var snapshot = JsonDocument.Parse(version.QuestionsSnapshot!);
        Assert.Equal("sq-1", snapshot.RootElement[0].GetProperty("id").GetString());
        Assert.NotNull(version.SettingsSnapshot);
        Assert.Null(version.DemographicsSnapshot); // absent in the document, not "{}"
    }

    [Fact]
    public void Version_attributes_from_its_survey_not_from_the_company()
    {
        var report = new DataQualityReport();
        var doc = NominalVersion();
        doc["survey_id"] = EsSurveyOid.ToString();
        doc["title"] = "Pulso de clima Q3";

        var version = SurveyVersionMapper.Map(Load<LegacySurveyVersion>(doc), Context(report));

        // The company is 'en'; the survey is 'es'. The survey wins.
        Assert.Equal("Pulso de clima Q3", version!.TitleEs);
        Assert.Null(version.TitleEn);
        Assert.All(report.Entries.Where(e => e.Kind == ReportEntryKind.Attribution),
            e => Assert.Contains("'es'", e.Reason));
    }

    [Fact]
    public void Version_without_a_reason_keeps_its_snapshot_behind_a_marked_placeholder()
    {
        var report = new DataQualityReport();
        var doc = NominalVersion();
        doc.Remove("reason");

        var version = SurveyVersionMapper.Map(Load<LegacySurveyVersion>(doc), Context(report));

        Assert.NotNull(version);
        Assert.Contains("no reason recorded", version!.Reason);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AuditActorFieldFabricated);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Version_whose_survey_or_creator_is_gone_is_a_reported_skip()
    {
        foreach (var (field, value) in new[]
        {
            ("survey_id", ObjectId.GenerateNewId().ToString()),
            ("created_by", ObjectId.GenerateNewId().ToString()),
        })
        {
            var report = new DataQualityReport();
            var doc = NominalVersion();
            doc[field] = value;

            Assert.Null(SurveyVersionMapper.Map(Load<LegacySurveyVersion>(doc), Context(report)));
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal(field, entry.Field);
        }
    }

    // ------------------------------------------------------------------
    // SurveyAuditLog
    // ------------------------------------------------------------------

    private static BsonDocument NominalAudit() => new()
    {
        ["_id"] = AuditOid,
        // Real ObjectIds: this collection's declared shape, unlike every other.
        ["survey_id"] = SurveyOid,
        ["action"] = "created",
        ["entity_type"] = "survey",
        ["user_id"] = UserOid,
        ["user_name"] = "Ada Lovelace",
        ["user_email"] = "ada@acme.com",
        ["user_role"] = "company_admin",
        ["timestamp"] = new DateTime(2026, 6, 20, 10, 0, 0, DateTimeKind.Utc),
        ["ip_address"] = "203.0.113.7",
    };

    [Fact]
    public void Audit_row_maps_objectid_references_that_no_other_collection_uses()
    {
        var report = new DataQualityReport();

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(NominalAudit()), Context(report));

        Assert.NotNull(entry);
        Assert.Equal(SurveyId, entry!.SurveyId);
        Assert.Equal(UserId, entry.UserId);
        Assert.Equal(SurveyAuditActions.Created, entry.Action);
        Assert.Equal(SurveyAuditEntityTypes.Survey, entry.EntityType);
        Assert.Equal("Ada Lovelace", entry.UserName);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_string_reference_in_the_objectid_collection_resolves_identically()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        // Mongoose enforced ObjectId only for rows it wrote; an imported row may carry
        // the string form, and both must derive the same target id.
        doc["survey_id"] = SurveyOid.ToString();
        doc["user_id"] = UserOid.ToString();

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report));

        Assert.Equal(SurveyId, entry!.SurveyId);
        Assert.Equal(UserId, entry.UserId);
    }

    [Fact]
    public void A_reference_that_is_neither_objectid_nor_string_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["survey_id"] = new BsonDocument { ["oid"] = SurveyOid };

        Assert.Null(SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.AuditReferenceNotAnIdentifier && e.Kind == ReportEntryKind.Skip);
    }

    [Theory]
    [InlineData("published", "active")]
    [InlineData("cancelled", "archived")]
    [InlineData("completed", "closed")]
    public void Lifecycle_actions_fold_into_status_changed_carrying_the_destination(
        string legacyAction, string expectedTo)
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["action"] = legacyAction;
        doc["entity_type"] = "survey";

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report));

        Assert.Equal(SurveyAuditActions.StatusChanged, entry!.Action);
        Assert.Equal(SurveyAuditEntityTypes.Status, entry.EntityType);

        // The target's typed shape, not legacy's before/after/diff.
        var changes = SurveyAuditChangeSet.FromJson(entry.Changes);
        Assert.Equal(expectedTo, changes!.To);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AuditActionRemapped);

        // And the original vocabulary value survives in metadata.
        using var metadata = JsonDocument.Parse(entry.Metadata!);
        Assert.Equal(legacyAction, metadata.RootElement.GetProperty("legacy_action").GetString());
    }

    [Theory]
    [InlineData("question_added", "questions")]
    [InlineData("audience_updated", "audience")]
    [InlineData("schedule_changed", "schedule")]
    [InlineData("settings_modified", "settings")]
    public void Field_level_edits_become_updated_with_the_changed_path(
        string legacyAction, string expectedField)
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["action"] = legacyAction;
        doc["entity_type"] = expectedField;

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report));

        Assert.Equal(SurveyAuditActions.Updated, entry!.Action);
        Assert.Equal(SurveyAuditEntityTypes.Survey, entry.EntityType);
        var changes = SurveyAuditChangeSet.FromJson(entry.Changes);
        Assert.Equal([expectedField], changes!.Fields);
    }

    [Theory]
    [InlineData("deleted")]
    [InlineData("draft_saved")]
    [InlineData("draft_recovered")]
    public void An_action_with_no_target_meaning_is_a_reported_skip_not_an_unrenderable_string(
        string legacyAction)
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["action"] = legacyAction;

        Assert.Null(SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.AuditActionUnrepresentable, entry.Rule);
        Assert.Contains("#143", entry.Reason);
    }

    [Fact]
    public void The_raw_legacy_change_payload_is_preserved_under_metadata()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["action"] = "updated";
        doc["entity_type"] = "title";
        doc["changes"] = new BsonDocument
        {
            ["before"] = new BsonDocument { ["title"] = "Old title" },
            ["after"] = new BsonDocument { ["title"] = "New title" },
        };
        doc["metadata"] = new BsonDocument { ["reason"] = "typo fix", ["automated"] = false };

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report));

        using var metadata = JsonDocument.Parse(entry!.Metadata!);
        var legacyChanges = metadata.RootElement.GetProperty("legacy_changes");
        Assert.Equal("Old title", legacyChanges.GetProperty("before").GetProperty("title").GetString());
        Assert.Equal("New title", legacyChanges.GetProperty("after").GetProperty("title").GetString());
        Assert.Equal("title", metadata.RootElement.GetProperty("legacy_entity_type").GetString());
        Assert.Equal("typo fix", metadata.RootElement.GetProperty("reason").GetString());

        // The entity type narrowed to the target's vocabulary, and said so.
        Assert.Equal(SurveyAuditEntityTypes.Survey, entry.EntityType);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AuditEntityTypeRemapped);
    }

    [Fact]
    public void Missing_actor_fields_are_marked_rather_than_costing_the_evidence()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc.Remove("user_name");
        doc.Remove("user_email");
        doc.Remove("user_role");

        var entry = SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report));

        Assert.NotNull(entry);
        Assert.Contains("unnamed", entry!.UserName);
        Assert.Equal("unknown@legacy.invalid", entry.UserEmail);
        Assert.Equal("unknown", entry.UserRole);
        Assert.Equal(3, report.Entries.Count(e => e.Rule == MigrationRules.AuditActorFieldFabricated));
    }

    [Fact]
    public void An_audit_row_whose_actor_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["user_id"] = ObjectId.GenerateNewId();

        Assert.Null(SurveyAuditLogMapper.Map(Load<LegacySurveyAuditLog>(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.DanglingReference, entry.Rule);
        Assert.Equal("user_id", entry.Field);
    }
}
