using System.Text.Json;
using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Benchmarks and generated reports. The sharp edge is the tenant-leak skip on
/// Benchmark, where NULL means industry-wide: an internal benchmark IS one company's
/// aggregated numbers, so degrading a broken reference would publish them.
/// </summary>
public class OutputMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("655000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("655000000000000000000011");
    private static readonly ObjectId BenchmarkOid = ObjectId.Parse("655000000000000000000021");
    private static readonly ObjectId ReportOid = ObjectId.Parse("655000000000000000000031");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        Users = new HashSet<Guid> { UserId },
    };

    private static BsonDocument NominalBenchmark() => new()
    {
        ["_id"] = BenchmarkOid,
        ["name"] = "Engineering engagement",
        ["description"] = "Internal baseline for the engineering org.",
        ["type"] = "internal",
        ["category"] = "engagement",
        ["source"] = "Q2 2026 climate survey",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["validation_status"] = "validated",
        ["quality_score"] = 0.87,
        ["metrics"] = new BsonArray
        {
            new BsonDocument
            {
                ["metric_name"] = "psychological_safety", ["value"] = 4.1, ["unit"] = "score",
                ["percentile"] = 62.0, ["sample_size"] = 240,
                ["confidence_interval"] = new BsonDocument { ["lower"] = 3.9, ["upper"] = 4.3 },
            },
            new BsonDocument { ["metric_name"] = "workload", ["value"] = 3.2, ["unit"] = "score" },
            new BsonDocument { ["metric_name"] = "no_unit", ["value"] = 1.0 }, // unit is NOT NULL
        },
        ["created_at"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Benchmark_maps_with_its_metric_fan_out_and_confidence_interval()
    {
        var report = new DataQualityReport();

        var mapped = BenchmarkMapper.Map(Load<LegacyBenchmark>(NominalBenchmark()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(CompanyId, mapped!.Benchmark.CompanyId);
        Assert.Equal(UserId, mapped.Benchmark.CreatedBy);
        Assert.Equal("validated", mapped.Benchmark.ValidationStatus);
        Assert.Equal(0.87, mapped.Benchmark.QualityScore);
        // The target's period-over-period link has no legacy source; inventing a chain
        // would fabricate trends.
        Assert.Null(mapped.Benchmark.PriorPeriodBenchmarkId);

        Assert.Equal(2, mapped.Metrics.Count);
        var safety = mapped.Metrics[0];
        Assert.Equal("psychological_safety", safety.MetricName);
        Assert.Equal(3.9, safety.ConfidenceIntervalLower);
        Assert.Equal(4.3, safety.ConfidenceIntervalUpper);
        Assert.Equal(240, safety.SampleSize);
        // The second metric has no interval, and that is absence, not zero.
        Assert.Null(mapped.Metrics[1].ConfidenceIntervalLower);
        // A number with no unit cannot be compared to anything.
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.BenchmarkMetricIncomplete);
    }

    [Fact]
    public void An_industry_benchmark_without_a_company_is_legitimately_global()
    {
        var report = new DataQualityReport();
        var doc = NominalBenchmark();
        doc.Remove("company_id");
        doc["type"] = "industry";

        var mapped = BenchmarkMapper.Map(Load<LegacyBenchmark>(doc), Context(report));

        Assert.Null(mapped!.Benchmark.CompanyId);
        Assert.Equal("industry", mapped.Benchmark.Type);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_dangling_company_is_skipped_because_null_would_publish_its_numbers()
    {
        var report = new DataQualityReport();
        var doc = NominalBenchmark();
        doc["company_id"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(BenchmarkMapper.Map(Load<LegacyBenchmark>(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal("company_id", entry.Field);
        Assert.Contains("every tenant", entry.Reason);
    }

    [Fact]
    public void An_unknown_benchmark_type_is_a_skip_but_an_unknown_validation_status_is_not()
    {
        var typeReport = new DataQualityReport();
        var typeDoc = NominalBenchmark();
        typeDoc["type"] = "aspirational";
        Assert.Null(BenchmarkMapper.Map(Load<LegacyBenchmark>(typeDoc), Context(typeReport)));
        Assert.Contains(typeReport.Entries, e => e.Rule == MigrationRules.BenchmarkTypeUnknown);

        var statusReport = new DataQualityReport();
        var statusDoc = NominalBenchmark();
        statusDoc["validation_status"] = "under_review";
        var mapped = BenchmarkMapper.Map(Load<LegacyBenchmark>(statusDoc), Context(statusReport));
        // Falls back to the state that asserts least, rather than costing the row.
        Assert.Equal("pending", mapped!.Benchmark.ValidationStatus);
        Assert.Contains(statusReport.Entries, e => e.Rule == MigrationRules.BenchmarkValidationStatusUnknown);
    }

    // ------------------------------------------------------------------
    // Report
    // ------------------------------------------------------------------

    private static BsonDocument NominalReport() => new()
    {
        ["_id"] = ReportOid,
        ["title"] = "Q2 climate summary",
        ["description"] = "Company-wide results for Q2.",
        ["type"] = "survey_analysis",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["template_id"] = "standard-summary-v2",
        ["filters"] = new BsonDocument { ["survey_ids"] = new BsonArray { "abc" } },
        ["config"] = new BsonDocument { ["include_charts"] = true },
        ["status"] = "completed",
        ["format"] = "pdf",
        ["file_path"] = "/reports/q2.pdf",
        ["file_size"] = 204800L,
        ["shared_with"] = new BsonArray { "leadership@acme.com", "  " },
        ["download_count"] = 12,
        ["sections"] = new BsonArray { new BsonDocument { ["heading"] = "Overview" } },
        ["metrics"] = new BsonDocument { ["average"] = 4.0 },
        ["insights"] = new BsonArray { new BsonDocument { ["title"] = "Safety up" } },
        ["created_at"] = new DateTime(2026, 7, 3, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Report_folds_its_six_generated_blobs_into_the_one_output_column()
    {
        var report = new DataQualityReport();

        var mapped = ReportMapper.Map(Load<LegacyReport>(NominalReport()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("Q2 climate summary", mapped!.Title);
        Assert.Equal("pdf", mapped.Format);
        Assert.Equal(204800L, mapped.FileSize);
        Assert.Equal(["leadership@acme.com"], mapped.SharedWith);
        // template_id is text on both sides, so it carries verbatim.
        Assert.Equal("standard-summary-v2", mapped.TemplateId);
        Assert.Contains("survey_ids", mapped.Filters);

        // Everything the report rendered survives, retrievable by its legacy key.
        using var output = JsonDocument.Parse(mapped.ReportOutput!);
        Assert.Equal("Overview", output.RootElement.GetProperty("sections")[0].GetProperty("heading").GetString());
        Assert.Equal(4.0, output.RootElement.GetProperty("metrics").GetProperty("average").GetDouble());
        Assert.Equal("Safety up", output.RootElement.GetProperty("insights")[0].GetProperty("title").GetString());
        // Absent blobs are simply absent - not written as nulls.
        Assert.False(output.RootElement.TryGetProperty("recommendations", out _));
    }

    [Fact]
    public void A_report_with_no_generated_content_gets_a_null_output_not_an_empty_object()
    {
        var report = new DataQualityReport();
        var doc = NominalReport();
        foreach (var key in new[] { "sections", "metrics", "insights" })
        {
            doc.Remove(key);
        }

        var mapped = ReportMapper.Map(Load<LegacyReport>(doc), Context(report));

        Assert.Null(mapped!.ReportOutput);
    }

    [Fact]
    public void An_unreadable_status_becomes_failed_rather_than_being_offered_as_ready()
    {
        var report = new DataQualityReport();
        var doc = NominalReport();
        doc["status"] = "queued";

        var mapped = ReportMapper.Map(Load<LegacyReport>(doc), Context(report));

        Assert.Equal("failed", mapped!.Status);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ReportStatusUnknown);
    }

    [Fact]
    public void An_unknown_format_is_a_skip_because_it_decides_how_the_file_is_served()
    {
        var report = new DataQualityReport();
        var doc = NominalReport();
        doc["format"] = "docx";

        Assert.Null(ReportMapper.Map(Load<LegacyReport>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.ReportFormatUnknown && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_report_whose_author_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalReport();
        doc["created_by"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(ReportMapper.Map(Load<LegacyReport>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "created_by");
    }
}
