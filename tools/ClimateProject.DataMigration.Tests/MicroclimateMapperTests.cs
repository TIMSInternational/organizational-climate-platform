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
/// The Microclimate domain. Its distinctive surfaces: an end time derived from a
/// duration legacy never stored, emoji questions that the target has nowhere to put,
/// AI insights with no ids at all, and the tenant-leak rule repeated for microclimate
/// templates.
/// </summary>
public class MicroclimateMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("651000000000000000000001");
    private static readonly ObjectId EsCompanyOid = ObjectId.Parse("651000000000000000000002");
    private static readonly ObjectId UserOid = ObjectId.Parse("651000000000000000000011");
    private static readonly ObjectId DeptOid = ObjectId.Parse("651000000000000000000021");
    private static readonly ObjectId TemplateOid = ObjectId.Parse("651000000000000000000031");
    private static readonly ObjectId MicroOid = ObjectId.Parse("651000000000000000000041");
    private static readonly ObjectId InviteOid = ObjectId.Parse("651000000000000000000051");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid EsCompanyId = MigrationIds.For("companies", EsCompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid DeptId = MigrationIds.For("departments", DeptOid);
    private static readonly Guid TemplateId = MigrationIds.For("microclimatetemplates", TemplateOid);
    private static readonly Guid MicroId = MigrationIds.For("microclimates", MicroOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId, EsCompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en", [EsCompanyId] = "es" },
        Users = new HashSet<Guid> { UserId },
        Departments = new HashSet<Guid> { DeptId },
        MicroclimateTemplates = new HashSet<Guid> { TemplateId },
        Microclimates = new HashSet<Guid> { MicroId },
    };

    private static BsonDocument NominalMicroclimate() => new()
    {
        ["_id"] = MicroOid,
        ["title"] = "Monday pulse",
        ["description"] = "How is the week starting?",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["template_id"] = TemplateOid.ToString(),
        ["targeting"] = new BsonDocument
        {
            ["department_ids"] = new BsonArray { DeptOid.ToString() },
            ["role_filters"] = new BsonArray { "employee", "  " },
            ["include_managers"] = false,
            ["max_participants"] = 50,
            ["custom_filters"] = new BsonDocument { ["location"] = "HQ" },
        },
        ["scheduling"] = new BsonDocument
        {
            ["start_time"] = new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc),
            ["duration_minutes"] = 45,
            ["timezone"] = "America/Santiago",
            ["auto_close"] = true,
            ["reminder_settings"] = new BsonDocument { ["send_reminders"] = true },
        },
        ["real_time_settings"] = new BsonDocument { ["allow_comments"] = false, ["participation_threshold"] = 5 },
        ["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "mq-1", ["text"] = "How is your week?", ["type"] = "likert", ["order"] = 0 },
        },
        ["status"] = "active",
        ["response_count"] = 8,
        ["live_results"] = new BsonDocument
        {
            ["sentiment_score"] = 0.42,
            ["engagement_level"] = "high",
            ["top_themes"] = new BsonArray { "workload" },
            ["word_cloud_data"] = new BsonArray { new BsonDocument { ["text"] = "busy", ["value"] = 3 } },
        },
        ["created_at"] = new DateTime(2026, 7, 5, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Microclimate_derives_its_end_time_from_the_duration_legacy_stored()
    {
        var report = new DataQualityReport();

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(NominalMicroclimate()), Context(report));

        Assert.NotNull(mapped);
        var window = mapped!.Microclimate.Scheduling;
        Assert.Equal(new DateTimeOffset(2026, 7, 6, 9, 0, 0, TimeSpan.Zero), window.StartTime);
        // start + 45 minutes: materialising what legacy computed on every read.
        Assert.Equal(new DateTimeOffset(2026, 7, 6, 9, 45, 0, TimeSpan.Zero), window.EndTime);
        Assert.Equal("America/Santiago", window.Timezone);
        Assert.Contains("send_reminders", window.ReminderSchedule);

        // auto_close has no home on a microclimate.
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateAutoCloseDropped);
    }

    [Fact]
    public void Microclimate_maps_targeting_realtime_and_live_results()
    {
        var report = new DataQualityReport();

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(NominalMicroclimate()), Context(report));
        var m = mapped!.Microclimate;

        Assert.Equal(TemplateId, m.TemplateId);
        Assert.Equal(["employee"], m.Targeting.RoleFilters!);
        Assert.False(m.Targeting.IncludeManagers);
        Assert.Equal(50, m.Targeting.MaxParticipants);
        Assert.Contains("HQ", m.Targeting.CustomFilters);

        Assert.False(m.RealtimeSettings.AllowComments);
        Assert.Equal(5, m.RealtimeSettings.ParticipationThreshold);
        Assert.True(m.RealtimeSettings.ShowLiveResults); // absent in source, default kept

        Assert.Equal(0.42, m.LiveResults.SentimentScore);
        Assert.Equal("high", m.LiveResults.EngagementLevel);
        Assert.Equal(["workload"], m.LiveResults.TopThemes);
        Assert.Contains("busy", m.LiveResults.WordCloudData);

        var target = Assert.Single(mapped.DepartmentTargets);
        Assert.Equal(DeptId, target.DepartmentId);
    }

    [Fact]
    public void Microclimate_content_attributes_by_company_language()
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["company_id"] = EsCompanyOid.ToString();
        doc["title"] = "Pulso del lunes";

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report));

        Assert.Equal("es", mapped!.Microclimate.Language);
        Assert.Equal("Pulso del lunes", mapped.Microclimate.TitleEs);
        Assert.Null(mapped.Microclimate.TitleEn);
        Assert.Null(Assert.Single(mapped.Questions).TextEn);
    }

    [Fact]
    public void Emoji_questions_are_unrepresentable_on_a_microclimate_and_drop_by_name()
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "mq-1", ["text"] = "Mood?", ["type"] = "emoji_rating", ["order"] = 0 },
            new BsonDocument { ["id"] = "mq-2", ["text"] = "Kept.", ["type"] = "likert", ["order"] = 1 },
        };

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report));

        Assert.Equal("Kept.", Assert.Single(mapped!.Questions).TextEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateQuestionEmojiUnrepresentable);
    }

    [Fact]
    public void Ai_insights_have_no_ids_so_identity_is_positional_and_stays_distinct()
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["ai_insights"] = new BsonArray
        {
            new BsonDocument
            {
                ["type"] = "pattern", ["message"] = "Workload mentions rising.", ["confidence"] = 0.8,
                ["timestamp"] = new DateTime(2026, 7, 6, 10, 0, 0, DateTimeKind.Utc),
            },
            new BsonDocument { ["type"] = "alert", ["message"] = "Sentiment dropped.", ["confidence"] = 0.6 },
            // Incomplete: both columns are NOT NULL and there is no honest placeholder.
            new BsonDocument { ["type"] = "recommendation" },
        };

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report));

        Assert.Equal(2, mapped!.Insights.Count);
        Assert.Equal(2, mapped.Insights.Select(i => i.Id).Distinct().Count());
        Assert.Equal(
            MigrationIds.ForChild("microclimates", MicroOid, MicroclimateMapper.InsightScope, "#0"),
            mapped.Insights[0].Id);
        Assert.Equal(0.8, mapped.Insights[0].Confidence);
        // The one without a timestamp falls back to the parent's, never the run's clock.
        Assert.Equal(new DateTimeOffset(2026, 7, 5, 0, 0, 0, TimeSpan.Zero), mapped.Insights[1].Timestamp);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateInsightIncomplete);
    }

    [Theory]
    [InlineData("paused", "closed")]
    [InlineData("completed", "closed")]
    [InlineData("cancelled", "archived")]
    public void Legacy_statuses_the_target_lacks_remap_by_name(string legacyStatus, string expected)
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["status"] = legacyStatus;

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report));

        Assert.Equal(expected, mapped!.Microclimate.Status);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateStatusRemapped);
    }

    [Fact]
    public void A_microclimate_without_a_start_time_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["scheduling"] = new BsonDocument { ["duration_minutes"] = 30 };

        Assert.Null(MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Skip && e.Field == "scheduling.start_time");
    }

    [Fact]
    public void A_missing_duration_defaults_by_name_rather_than_leaving_the_window_open()
    {
        var report = new DataQualityReport();
        var doc = NominalMicroclimate();
        doc["scheduling"] = new BsonDocument
        {
            ["start_time"] = new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc),
        };

        var mapped = MicroclimateMapper.Map(Load<LegacyMicroclimate>(doc), Context(report));

        Assert.Equal(new DateTimeOffset(2026, 7, 6, 9, 30, 0, TimeSpan.Zero), mapped!.Microclimate.Scheduling.EndTime);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateDurationDefaulted);
    }

    // ------------------------------------------------------------------
    // MicroclimateTemplate
    // ------------------------------------------------------------------

    private static BsonDocument NominalTemplate() => new()
    {
        ["_id"] = TemplateOid,
        ["name"] = "Weekly pulse",
        ["description"] = "Three quick questions.",
        ["category"] = "pulse_check",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1", ["text"] = "Mood?", ["type"] = "multiple_choice",
                ["options"] = new BsonArray { "Good", "Bad", "Good" }, ["order"] = 0,
            },
        },
        ["settings"] = new BsonDocument { ["default_duration_minutes"] = 15, ["auto_close"] = false },
        ["tags"] = new BsonArray { "weekly" },
        ["created_at"] = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Microclimate_template_maps_settings_and_dedupes_option_values()
    {
        var report = new DataQualityReport();

        var mapped = MicroclimateTemplateMapper.Map(Load<LegacyMicroclimateTemplate>(NominalTemplate()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("Weekly pulse", mapped!.Template.Name);
        Assert.Equal(CompanyId, mapped.Template.CompanyId);
        Assert.Equal(15, mapped.Template.Settings.DefaultDurationMinutes);
        Assert.False(mapped.Template.Settings.AutoClose);
        Assert.Equal(["weekly"], mapped.Template.Tags);
        Assert.Equal(["Good", "Bad"], mapped.Options.Select(o => o.Value));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionOptionDuplicateValue);
    }

    [Fact]
    public void Microclimate_template_with_a_dangling_company_is_skipped_not_made_global()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["company_id"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(MicroclimateTemplateMapper.Map(Load<LegacyMicroclimateTemplate>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "company_id");
    }

    [Fact]
    public void A_system_template_without_a_company_is_legitimately_global()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc.Remove("company_id");
        doc["is_system_template"] = true;

        var mapped = MicroclimateTemplateMapper.Map(Load<LegacyMicroclimateTemplate>(doc), Context(report));

        Assert.Null(mapped!.Template.CompanyId);
        Assert.True(mapped.Template.IsSystemTemplate);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    // ------------------------------------------------------------------
    // MicroclimateInvitation
    // ------------------------------------------------------------------

    [Fact]
    public void Microclimate_invitation_token_is_inert_for_a_different_shape_reason()
    {
        var report = new DataQualityReport();
        // 64 hex chars: crypto.randomBytes(32).toString('hex').
        var token = new string('a', 64);
        var doc = new BsonDocument
        {
            ["_id"] = InviteOid,
            ["microclimate_id"] = MicroOid,
            ["user_id"] = UserOid,
            ["company_id"] = CompanyOid,
            ["email"] = "Ada@Acme.com",
            ["invitation_token"] = token,
            ["status"] = "expired",
            ["sent_at"] = new DateTime(2026, 7, 6, 9, 5, 0, DateTimeKind.Utc),
            ["created_at"] = new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc),
        };

        var invitation = MicroclimateInvitationMapper.Map(Load<LegacyMicroclimateInvitation>(doc), Context(report));

        Assert.NotNull(invitation);
        Assert.Equal("ada@acme.com", invitation!.Email);
        Assert.Equal(token, invitation.InvitationToken);
        Assert.False(SurveyAccessTokens.HasExpectedShape(invitation.InvitationToken));

        // 'expired' has no target member; sent_at is the furthest evidence.
        Assert.Equal(SurveyInvitationStatuses.Sent, invitation.Status);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationStatusReconstructed);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationTokenInert);

        using var metadata = JsonDocument.Parse(invitation.Metadata!);
        Assert.Equal("expired", metadata.RootElement.GetProperty("legacy_status").GetString());

        // No expires_at in the source: derived from created_at, never the run's clock.
        Assert.Equal(new DateTimeOffset(2026, 8, 5, 9, 0, 0, TimeSpan.Zero), invitation.ExpiresAt);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationExpiryDerived);
    }

    [Fact]
    public void A_microclimate_invitation_whose_microclimate_is_gone_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = new BsonDocument
        {
            ["_id"] = InviteOid,
            ["microclimate_id"] = ObjectId.GenerateNewId(),
            ["user_id"] = UserOid,
            ["company_id"] = CompanyOid,
            ["email"] = "ada@acme.com",
            ["invitation_token"] = new string('b', 64),
        };

        Assert.Null(MicroclimateInvitationMapper.Map(Load<LegacyMicroclimateInvitation>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Skip && e.Field == "microclimate_id");
    }
}
