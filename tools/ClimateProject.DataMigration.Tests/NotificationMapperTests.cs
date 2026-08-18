using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The notification pair. The load-bearing rule is #73's condition gate: a
/// personalization rule whose condition the runtime's own parser cannot read is
/// refused, because loading it would mean a rule that never fires correctly.
/// </summary>
public class NotificationMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("653000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("653000000000000000000011");
    private static readonly ObjectId TemplateOid = ObjectId.Parse("653000000000000000000021");
    private static readonly ObjectId NotificationOid = ObjectId.Parse("653000000000000000000031");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid TemplateId = MigrationIds.For("notificationtemplates", TemplateOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report, string language = "en") => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = language },
        Users = new HashSet<Guid> { UserId },
        NotificationTemplates = new HashSet<Guid> { TemplateId },
    };

    private static BsonDocument NominalTemplate() => new()
    {
        ["_id"] = TemplateOid,
        ["name"] = "Survey invitation",
        ["type"] = "survey_invitation",
        ["channel"] = "email",
        ["subject"] = "Your survey is ready",
        ["title"] = "We would like your view",
        ["content"] = "Hello {{name}}, please take five minutes.",
        ["html_content"] = "<p>Hello {{name}}</p>",
        ["company_id"] = CompanyOid,
        ["created_by"] = UserOid,
        ["variables"] = new BsonArray
        {
            new BsonDocument
            {
                ["name"] = "name", ["type"] = "string", ["required"] = true,
                ["description"] = "The recipient's name",
            },
        },
        ["created_at"] = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Template_content_attributes_across_all_four_fields()
    {
        var report = new DataQualityReport();

        var mapped = NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(NominalTemplate()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("Your survey is ready", mapped!.Template.SubjectEn);
        Assert.Equal("We would like your view", mapped.Template.TitleEn);
        Assert.Contains("{{name}}", mapped.Template.ContentEn);
        Assert.Contains("<p>", mapped.Template.HtmlContentEn);
        Assert.Null(mapped.Template.SubjectEs);
        Assert.Equal(4, report.Entries.Count(e => e.Kind == ReportEntryKind.Attribution));

        var variable = Assert.Single(mapped.Variables);
        Assert.Equal("name", variable.Name);
        Assert.True(variable.Required);
    }

    [Fact]
    public void A_spanish_company_routes_every_template_field_to_es()
    {
        var report = new DataQualityReport();

        var mapped = NotificationTemplateMapper.Map(
            Load<LegacyNotificationTemplate>(NominalTemplate()), Context(report, "es"));

        Assert.Equal("Your survey is ready", mapped!.Template.SubjectEs);
        Assert.Null(mapped.Template.SubjectEn);
        Assert.Null(mapped.Template.ContentEn);
    }

    [Theory]
    [InlineData("user.role === 'employee'")]
    [InlineData("responses >= 5")]
    [InlineData("is_manager == true")]
    public void A_condition_the_runtime_can_read_is_migrated(string condition)
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["personalization_rules"] = new BsonArray
        {
            new BsonDocument
            {
                ["condition"] = condition,
                ["modifications"] = new BsonDocument { ["title"] = "Custom title" },
            },
        };

        var mapped = NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(doc), Context(report));

        var rule = Assert.Single(mapped!.Rules);
        Assert.Equal(condition, rule.Condition);
        Assert.Contains("Custom title", rule.Modifications);
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.NotificationConditionUnparseable);
    }

    [Theory]
    [InlineData("user.role in ['a','b']")]
    [InlineData("responses > 5 && active == true")]
    [InlineData("nonsense")]
    public void A_condition_the_runtime_cannot_read_is_refused_rather_than_loaded_dead(string condition)
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["personalization_rules"] = new BsonArray
        {
            new BsonDocument { ["condition"] = condition },
        };

        var mapped = NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(doc), Context(report));

        Assert.Empty(mapped!.Rules);
        var entry = Assert.Single(report.Entries, e => e.Rule == MigrationRules.NotificationConditionUnparseable);
        // The original text rides along for whoever rewrites it.
        Assert.Contains(condition, entry.Reason);
    }

    [Fact]
    public void An_unknown_channel_is_a_skip_because_it_picks_the_delivery_path()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["channel"] = "carrier_pigeon";

        Assert.Null(NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.NotificationChannelUnknown && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_platform_template_without_a_company_is_global_but_a_dangling_one_is_skipped()
    {
        var report = new DataQualityReport();
        var global = NominalTemplate();
        global.Remove("company_id");
        global["is_default"] = true;

        var mapped = NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(global), Context(report));
        Assert.Null(mapped!.Template.CompanyId);
        Assert.True(mapped.Template.IsDefault);

        var dangling = NominalTemplate();
        dangling["company_id"] = ObjectId.GenerateNewId();
        var second = new DataQualityReport();
        Assert.Null(NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(dangling), Context(second)));
        Assert.Contains(second.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "company_id");
    }

    [Fact]
    public void Duplicate_and_nameless_variables_are_reported_not_migrated()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["variables"] = new BsonArray
        {
            new BsonDocument { ["name"] = "name", ["type"] = "string", ["description"] = "First" },
            new BsonDocument { ["name"] = "name", ["type"] = "string", ["description"] = "Duplicate" },
            new BsonDocument { ["type"] = "string", ["description"] = "No name" },
            new BsonDocument { ["name"] = "count", ["type"] = "quantum", ["description"] = "Odd type" },
        };

        var mapped = NotificationTemplateMapper.Map(Load<LegacyNotificationTemplate>(doc), Context(report));

        Assert.Equal(2, mapped!.Variables.Count);
        Assert.Equal("string", mapped.Variables.Single(v => v.Name == "count").Type);
        Assert.Equal(3, report.Entries.Count(e => e.Rule == MigrationRules.NotificationVariableInvalid));
    }

    // ------------------------------------------------------------------
    // Notification
    // ------------------------------------------------------------------

    private static BsonDocument NominalNotification() => new()
    {
        ["_id"] = NotificationOid,
        ["user_id"] = UserOid,
        ["company_id"] = CompanyOid,
        ["type"] = "survey_invitation",
        ["channel"] = "email",
        ["priority"] = "high",
        ["status"] = "delivered",
        ["title"] = "Your survey is ready",
        ["message"] = "Please take five minutes.",
        ["template_id"] = TemplateOid,
        ["scheduled_for"] = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc),
        ["sent_at"] = new DateTime(2026, 7, 1, 9, 0, 5, DateTimeKind.Utc),
        ["delivered_at"] = new DateTime(2026, 7, 1, 9, 0, 9, DateTimeKind.Utc),
        ["metadata"] = new BsonDocument { ["email_client"] = "Gmail" },
        ["created_at"] = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Notification_maps_nominal_document_with_its_template_link()
    {
        var report = new DataQualityReport();

        var notification = NotificationMapper.Map(Load<LegacyNotification>(NominalNotification()), Context(report));

        Assert.NotNull(notification);
        Assert.Equal(UserId, notification!.UserId);
        Assert.Equal(TemplateId, notification.TemplateId);
        Assert.Equal("high", notification.Priority);
        Assert.Equal("delivered", notification.Status);
        Assert.Equal("Gmail", notification.Metadata.EmailClient);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_notification_whose_template_is_gone_keeps_what_was_actually_sent()
    {
        var report = new DataQualityReport();
        var doc = NominalNotification();
        doc["template_id"] = ObjectId.GenerateNewId();

        var notification = NotificationMapper.Map(Load<LegacyNotification>(doc), Context(report));

        // The rendered title and message live on the row, so the record survives.
        Assert.NotNull(notification);
        Assert.Null(notification!.TemplateId);
        Assert.Equal("Your survey is ready", notification.Title);
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Degraded && e.Field == "template_id");
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void An_out_of_vocabulary_priority_or_status_falls_back_by_name()
    {
        var report = new DataQualityReport();
        var doc = NominalNotification();
        doc["priority"] = "urgent";
        doc["status"] = "bounced";

        var notification = NotificationMapper.Map(Load<LegacyNotification>(doc), Context(report));

        Assert.Equal("medium", notification!.Priority);
        Assert.Equal("pending", notification.Status);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.NotificationVocabularyUnknown));
    }

    [Fact]
    public void A_notification_with_no_recipient_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalNotification();
        doc["user_id"] = ObjectId.GenerateNewId();

        Assert.Null(NotificationMapper.Map(Load<LegacyNotification>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "user_id");
    }

    [Fact]
    public void A_notification_without_a_scheduled_time_falls_back_to_its_own_creation()
    {
        var report = new DataQualityReport();
        var doc = NominalNotification();
        doc.Remove("scheduled_for");

        var notification = NotificationMapper.Map(Load<LegacyNotification>(doc), Context(report));

        // The document's own clock, never the migration run's.
        Assert.Equal(new DateTimeOffset(2026, 7, 1, 8, 0, 0, TimeSpan.Zero), notification!.ScheduledFor);
    }
}
