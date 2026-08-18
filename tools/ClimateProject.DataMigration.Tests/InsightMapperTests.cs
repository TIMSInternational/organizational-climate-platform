using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// #152's two-shapes-one-collection bug, and the aggregates beside it. The whole point
/// of the AIInsight tests is that BOTH legacy shapes must map, and which one each
/// document was must be reported -- the census cannot say, because it sees one
/// collection name.
/// </summary>
public class InsightMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("654000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("654000000000000000000011");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("654000000000000000000021");
    private static readonly ObjectId DeptOid = ObjectId.Parse("654000000000000000000031");
    private static readonly ObjectId InsightOid = ObjectId.Parse("654000000000000000000041");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);
    private static readonly Guid DeptId = MigrationIds.For("departments", DeptOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        Users = new HashSet<Guid> { UserId },
        Surveys = new HashSet<Guid> { SurveyId },
        Departments = new HashSet<Guid> { DeptId },
    };

    /// <summary>The AIInsight.ts shape: camelCase, and Mongoose's default timestamps.</summary>
    private static BsonDocument CamelShape() => new()
    {
        ["_id"] = InsightOid,
        ["surveyId"] = SurveyOid.ToString(),
        ["companyId"] = CompanyOid.ToString(),
        ["type"] = "risk",
        ["category"] = "engagement",
        ["title"] = "Engagement dipping in Engineering",
        ["description"] = "Three consecutive pulses trend down.",
        ["confidenceScore"] = 82,
        ["priority"] = "high",
        ["affectedSegments"] = new BsonArray { "Engineering", "  " },
        ["recommendedActions"] = new BsonArray { "Run a listening session" },
        ["metadata"] = new BsonDocument { ["model"] = "v2" },
        ["createdAt"] = new DateTime(2026, 7, 8, 0, 0, 0, DateTimeKind.Utc),
        ["updatedAt"] = new DateTime(2026, 7, 8, 1, 0, 0, DateTimeKind.Utc),
    };

    /// <summary>The Analytics.ts shape: snake_case, plus five fields the other never had.</summary>
    private static BsonDocument SnakeShape() => new()
    {
        ["_id"] = InsightOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["company_id"] = CompanyOid.ToString(),
        ["department_id"] = DeptOid.ToString(),
        ["type"] = "recommendation",
        ["category"] = "workload",
        ["title"] = "Rebalance on-call",
        ["description"] = "Two engineers carry most of the rota.",
        ["confidence_score"] = 64,
        ["priority"] = "medium",
        ["affected_segments"] = new BsonArray { "Backend API" },
        ["recommended_actions"] = new BsonArray { "Rotate on-call weekly" },
        ["supporting_data"] = new BsonDocument { ["rota_share"] = 0.7 },
        ["is_acknowledged"] = true,
        ["acknowledged_by"] = UserOid.ToString(),
        ["acknowledged_at"] = new DateTime(2026, 7, 9, 0, 0, 0, DateTimeKind.Utc),
        ["expires_at"] = new DateTime(2026, 8, 9, 0, 0, 0, DateTimeKind.Utc),
        ["created_at"] = new DateTime(2026, 7, 8, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void The_camelCase_shape_maps_and_is_reported_as_that_shape()
    {
        var report = new DataQualityReport();

        var insight = AiInsightMapper.Map(Load<LegacyAiInsight>(CamelShape()), Context(report));

        Assert.NotNull(insight);
        Assert.Equal(CompanyId, insight!.CompanyId);
        Assert.Equal(SurveyId, insight.SurveyId);
        Assert.Equal(82, insight.ConfidenceScore);
        Assert.Equal(["Engineering"], insight.AffectedSegments);
        // Its 'metadata' blob is the nearest thing to supporting_data, not a drop.
        Assert.Contains("v2", insight.SupportingData);
        // Mongoose's camelCase timestamps were read, not fabricated from the ObjectId.
        Assert.Equal(new DateTimeOffset(2026, 7, 8, 0, 0, 0, TimeSpan.Zero), insight.CreatedAt);
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.TimestampFromObjectId);

        var shape = Assert.Single(report.Entries, e => e.Rule == MigrationRules.AiInsightShapeRecorded);
        Assert.Contains("AIInsight.ts", shape.Reason);
    }

    [Fact]
    public void The_snake_case_shape_maps_including_the_five_fields_the_other_never_had()
    {
        var report = new DataQualityReport();

        var insight = AiInsightMapper.Map(Load<LegacyAiInsight>(SnakeShape()), Context(report));

        Assert.NotNull(insight);
        Assert.Equal(DeptId, insight!.DepartmentId);
        Assert.Equal(64, insight.ConfidenceScore);
        Assert.True(insight.IsAcknowledged);
        Assert.Equal(UserId, insight.AcknowledgedBy);
        Assert.Equal(new DateTimeOffset(2026, 8, 9, 0, 0, 0, TimeSpan.Zero), insight.ExpiresAt);
        Assert.Contains("rota_share", insight.SupportingData);

        var shape = Assert.Single(report.Entries, e => e.Rule == MigrationRules.AiInsightShapeRecorded);
        Assert.Contains("Analytics.ts", shape.Reason);
    }

    [Fact]
    public void Both_shapes_derive_the_same_target_id_because_the_collection_is_one()
    {
        var report = new DataQualityReport();

        var camel = AiInsightMapper.Map(Load<LegacyAiInsight>(CamelShape()), Context(report));
        var snake = AiInsightMapper.Map(Load<LegacyAiInsight>(SnakeShape()), Context(report));

        // Same _id, same collection -> same deterministic key. The shapes are a
        // schema accident, not two id spaces.
        Assert.Equal(camel!.Id, snake!.Id);
    }

    [Fact]
    public void A_document_carrying_both_shapes_prefers_the_superset_and_says_so()
    {
        var report = new DataQualityReport();
        var doc = SnakeShape();
        doc["companyId"] = CompanyOid.ToString();
        doc["confidenceScore"] = 99;

        var insight = AiInsightMapper.Map(Load<LegacyAiInsight>(doc), Context(report));

        // snake_case wins: it is the shape with the extra five fields.
        Assert.Equal(64, insight!.ConfidenceScore);
        var shape = Assert.Single(report.Entries, e => e.Rule == MigrationRules.AiInsightShapeAmbiguous);
        Assert.Contains("BOTH", shape.Reason);
    }

    [Fact]
    public void A_document_matching_neither_shape_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = CamelShape();
        doc.Remove("companyId");

        Assert.Null(AiInsightMapper.Map(Load<LegacyAiInsight>(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Contains("#152", entry.Reason);
    }

    [Fact]
    public void A_confidence_score_outside_the_documented_range_is_clamped_by_name()
    {
        var report = new DataQualityReport();
        var doc = CamelShape();
        doc["confidenceScore"] = 140.6;

        var insight = AiInsightMapper.Map(Load<LegacyAiInsight>(doc), Context(report));

        Assert.Equal(100, insight!.ConfidenceScore);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AiInsightConfidenceClamped);
    }

    [Fact]
    public void An_insight_type_in_neither_vocabulary_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = SnakeShape();
        doc["type"] = "hunch";

        Assert.Null(AiInsightMapper.Map(Load<LegacyAiInsight>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AiInsightTypeUnknown);
    }

    [Fact]
    public void A_company_wide_insight_with_no_survey_is_a_real_shape_not_a_defect()
    {
        var report = new DataQualityReport();
        var doc = SnakeShape();
        doc.Remove("survey_id");

        var insight = AiInsightMapper.Map(Load<LegacyAiInsight>(doc), Context(report));

        Assert.Null(insight!.SurveyId);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Degraded);
    }

    // ------------------------------------------------------------------
    // AnalyticsInsight
    // ------------------------------------------------------------------

    private static readonly ObjectId AnalyticsOid = ObjectId.Parse("654000000000000000000051");

    private static BsonDocument NominalAnalytics() => new()
    {
        ["_id"] = AnalyticsOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["company_id"] = CompanyOid.ToString(),
        ["aggregation_type"] = "department",
        ["metric_type"] = "average",
        ["metric_name"] = "psychological_safety",
        ["data"] = new BsonArray
        {
            new BsonDocument { ["label"] = "Engineering", ["value"] = 4.1, ["count"] = 24, ["percentage"] = 60.0 },
            new BsonDocument { ["label"] = "Sales", ["value"] = 3.6 },
            new BsonDocument { ["value"] = 2.0 }, // no label: NOT NULL, not migrated
        },
        ["time_series"] = new BsonArray
        {
            new BsonDocument
            {
                ["date"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc), ["value"] = 4.0, ["count"] = 20,
            },
            new BsonDocument { ["value"] = 4.2 }, // no date
        },
        ["total_responses"] = 44,
        ["created_at"] = new DateTime(2026, 7, 8, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Analytics_insight_fans_out_both_series_positionally()
    {
        var report = new DataQualityReport();

        var mapped = AnalyticsInsightMapper.Map(Load<LegacyAnalyticsInsight>(NominalAnalytics()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("psychological_safety", mapped!.Insight.MetricName);
        Assert.Equal(44, mapped.Insight.TotalResponses);
        // calculation_date is absent, so it falls back to the document's own created_at.
        Assert.Equal(new DateTimeOffset(2026, 7, 8, 0, 0, 0, TimeSpan.Zero), mapped.Insight.CalculationDate);

        Assert.Equal(2, mapped.Data.Count);
        Assert.Equal("Engineering", mapped.Data[0].Label);
        Assert.Equal(60.0, mapped.Data[0].Percentage);
        Assert.Null(mapped.Data[1].Count);

        var point = Assert.Single(mapped.TimeSeries);
        Assert.Equal(20, point.Count);

        // A metric series is meaningful only in order, which position preserves.
        Assert.Equal(
            MigrationIds.ForChild("analyticsinsights", AnalyticsOid, AnalyticsInsightMapper.DataScope, "#0"),
            mapped.Data[0].Id);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.AnalyticsPointIncomplete));
    }

    [Fact]
    public void An_aggregate_whose_vocabulary_is_unreadable_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalAnalytics();
        doc["metric_type"] = "vibes";

        Assert.Null(AnalyticsInsightMapper.Map(Load<LegacyAnalyticsInsight>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.AnalyticsVocabularyUnknown && e.Kind == ReportEntryKind.Skip);
    }
}
