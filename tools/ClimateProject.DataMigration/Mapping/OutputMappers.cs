using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped benchmark and its metric fan-out.</summary>
public sealed record MappedBenchmark(Benchmark Benchmark, IReadOnlyList<BenchmarkMetric> Metrics);

/// <summary>
/// Comparison baselines. company_id is nullable and NULL means an industry-wide
/// benchmark visible to everyone, so this collection gets the same TENANT-LEAK SKIP as
/// the template collections: absent is legitimately global, unresolvable is a skip,
/// because a NULL there would publish one company's internal numbers to every tenant.
/// That is a sharper consequence here than for a template - a benchmark IS the
/// company's aggregated data.
///
/// PriorPeriodBenchmarkId has no legacy source and stays NULL: the target added
/// period-over-period linking that the legacy product never recorded, and inventing a
/// chain would fabricate trends.
/// </summary>
public static class BenchmarkMapper
{
    public const string Collection = "benchmarks";
    public const string MetricScope = "metrics";

    private static readonly string[] Types = ["internal", "industry"];
    private static readonly string[] ValidationStatuses = ["pending", "validated", "rejected"];

    public static MappedBenchmark? Map(LegacyBenchmark doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var name = MapperHelpers.Truncated(doc.Name, 200, Collection, legacyId, "name", report);
        var description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report);
        var category = MapperHelpers.Truncated(doc.Category, 100, Collection, legacyId, "category", report);
        var source = MapperHelpers.Truncated(doc.Source, 200, Collection, legacyId, "source", report);
        if (name is null || description is null || category is null || source is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "benchmark is missing name, description, category or source, all NOT NULL",
                name is null ? "name" : description is null ? "description"
                    : category is null ? "category" : "source");
            return null;
        }

        var type = MapperHelpers.Trimmed(doc.Type);
        if (type is null || !Types.Contains(type, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.BenchmarkTypeUnknown, Collection, legacyId,
                $"type '{doc.Type}' is not one of {string.Join(", ", Types)}; the type decides whether "
                + "the numbers describe this company or its industry",
                "type");
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

        // The tenant-leak skip, and it bites harder here than on a template: an
        // internal benchmark IS one company's aggregated numbers.
        Guid? companyId = null;
        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        switch (companyRef.Kind)
        {
            case ReferenceKind.Resolved:
                companyId = companyRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Skip(
                    companyRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId,
                    "company_id does not resolve; NULL means industry-wide and visible to every tenant, "
                    + "which would publish one company's own numbers",
                    "company_id");
                return null;
        }

        var validationStatus = MapperHelpers.Trimmed(doc.ValidationStatus) ?? "pending";
        if (!ValidationStatuses.Contains(validationStatus, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.BenchmarkValidationStatusUnknown, Collection, legacyId,
                "validation_status",
                $"'{doc.ValidationStatus}' is not one of {string.Join(", ", ValidationStatuses)}; "
                + "recorded as 'pending', the state that asserts least");
            validationStatus = "pending";
        }

        var benchmark = new Benchmark
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            Description = description,
            Type = type,
            Category = category,
            Source = source,
            Industry = MapperHelpers.Truncated(doc.Industry, 100, Collection, legacyId, "industry", report),
            CompanySize = MapperHelpers.Truncated(doc.CompanySize, 20, Collection, legacyId, "company_size", report),
            Region = MapperHelpers.Truncated(doc.Region, 100, Collection, legacyId, "region", report),
            CreatedBy = creatorRef.TargetId!.Value,
            CompanyId = companyId,
            IsActive = doc.IsActive ?? true,
            ValidationStatus = validationStatus,
            QualityScore = doc.QualityScore ?? 0d,
            Metadata = LegacyJson.Serialize(doc.Metadata),

            // No legacy source: the target added period-over-period linking the legacy
            // product never recorded, and inventing a chain would fabricate trends.
            PriorPeriodBenchmarkId = null,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        var metrics = new List<BenchmarkMetric>();
        for (var index = 0; index < (doc.Metrics?.Count ?? 0); index++)
        {
            var legacy = doc.Metrics![index];
            var field = $"metrics[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id,
                (field, legacy.Extra), ($"{field}.confidence_interval", legacy.ConfidenceInterval?.Extra));

            var metricName = MapperHelpers.Truncated(
                legacy.MetricName, 200, Collection, legacyId, $"{field}.metric_name", report);
            var unit = MapperHelpers.Truncated(legacy.Unit, 20, Collection, legacyId, $"{field}.unit", report);
            if (metricName is null || legacy.Value is not { } value || unit is null)
            {
                // A number without its name or unit cannot be compared to anything,
                // which is the only thing a benchmark metric is for.
                report.Normalisation(MigrationRules.BenchmarkMetricIncomplete, Collection, legacyId, field,
                    "metric is missing its name, value or unit, all NOT NULL; a number with no unit "
                    + "cannot be compared to anything; not migrated");
                continue;
            }

            metrics.Add(new BenchmarkMetric
            {
                // Positional: legacy metrics carry no id, and a benchmark's metric list
                // is meaningful in its own order.
                Id = MigrationIds.ForChild(Collection, doc.Id, MetricScope, $"#{index}"),
                BenchmarkId = benchmark.Id,
                MetricName = metricName,
                Value = value,
                Unit = unit,
                Percentile = legacy.Percentile,
                SampleSize = legacy.SampleSize,
                ConfidenceIntervalLower = legacy.ConfidenceInterval?.Lower,
                ConfidenceIntervalUpper = legacy.ConfidenceInterval?.Upper,
            });
        }

        return new MappedBenchmark(benchmark, metrics);
    }
}

/// <summary>
/// Generated reports. The top level maps almost 1:1; the interesting part is the six
/// legacy blobs - sections, metadata, metrics, demographics, insights, recommendations
/// - which have exactly ONE target home, the report_output jsonb. They fold into it
/// under their own keys rather than being flattened or dropped, so a migrated report
/// still contains everything it rendered, retrievable by the name it had. Same
/// decision SurveyDraft's step blobs got, and for the same reason: this is generated
/// output, not content the product re-derives.
///
/// template_id is a plain string on BOTH sides - the target column is text, not a
/// foreign key - so it carries verbatim rather than being resolved.
/// </summary>
public static class ReportMapper
{
    public const string Collection = "reports";

    private static readonly string[] Statuses = ["generating", "completed", "failed", "scheduled"];
    private static readonly string[] Formats = ["pdf", "excel", "csv", "json"];

    public static Report? Map(LegacyReport doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var title = MapperHelpers.Truncated(doc.Title, 300, Collection, legacyId, "title", report);
        var type = MapperHelpers.Truncated(doc.Type, 50, Collection, legacyId, "type", report);
        if (title is null || type is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "report is missing its title or type, both NOT NULL", title is null ? "title" : "type");
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

        var format = MapperHelpers.Trimmed(doc.Format);
        if (format is null || !Formats.Contains(format, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.ReportFormatUnknown, Collection, legacyId,
                $"format '{doc.Format}' is not one of {string.Join(", ", Formats)}; the format decides "
                + "how the stored file is served",
                "format");
            return null;
        }

        var status = MapperHelpers.Trimmed(doc.Status) ?? "generating";
        if (!Statuses.Contains(status, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.ReportStatusUnknown, Collection, legacyId, "status",
                $"'{doc.Status}' is not one of {string.Join(", ", Statuses)}; recorded as 'failed', because "
                + "a report in an unreadable state is not one a user should be offered as ready");
            status = "failed";
        }

        return new Report
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Title = title,
            Description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report),
            Type = type,
            CompanyId = companyRef.TargetId!.Value,
            CreatedBy = creatorRef.TargetId!.Value,

            // Text on both sides, not an FK: carried, never resolved.
            TemplateId = MapperHelpers.Truncated(doc.TemplateId, 100, Collection, legacyId, "template_id", report),
            Filters = LegacyJson.Serialize(doc.Filters),
            Config = LegacyJson.Serialize(doc.Config),
            Status = status,
            Format = format,
            FilePath = MapperHelpers.Truncated(doc.FilePath, 500, Collection, legacyId, "file_path", report),
            FileSize = doc.FileSize,
            GenerationStartedAt = Utc(doc.GenerationStartedAt),
            GenerationCompletedAt = Utc(doc.GenerationCompletedAt),
            GenerationError = MapperHelpers.Truncated(
                doc.GenerationError, 2000, Collection, legacyId, "generation_error", report),
            ScheduledFor = Utc(doc.ScheduledFor),
            IsRecurring = doc.IsRecurring ?? false,
            RecurrencePattern = MapperHelpers.Truncated(
                doc.RecurrencePattern, 100, Collection, legacyId, "recurrence_pattern", report),
            NextGeneration = Utc(doc.NextGeneration),
            SharedWith = (doc.SharedWith ?? [])
                .Select(MapperHelpers.Trimmed)
                .Where(value => value is not null)
                .Select(value => value!)
                .ToList(),
            DownloadCount = doc.DownloadCount ?? 0,
            ExpiresAt = Utc(doc.ExpiresAt),
            ReportOutput = BuildOutput(doc),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };
    }

    /// <summary>
    /// The six generated-content blobs folded into the one jsonb column that exists
    /// for them, each under its own legacy key so nothing has to be guessed back out.
    /// </summary>
    private static string? BuildOutput(LegacyReport doc)
    {
        var output = new BsonDocument();
        void Add(string key, BsonValue? value)
        {
            if (value is not null && value.BsonType is not (BsonType.Null or BsonType.Undefined))
            {
                output[key] = value;
            }
        }

        Add("sections", doc.Sections);
        Add("metadata", doc.Metadata);
        Add("metrics", doc.Metrics);
        Add("demographics", doc.Demographics);
        Add("insights", doc.Insights);
        Add("recommendations", doc.Recommendations);
        return output.ElementCount == 0 ? null : LegacyJson.Serialize(output);
    }

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}
