using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>
/// #152's bug, met head-on.
///
/// <c>AIInsight.ts</c> and <c>Analytics.ts</c> BOTH register a Mongoose model named
/// <c>AIInsight</c>. The <c>mongoose.models.AIInsight ||</c> guard means whichever file
/// imported first wins for the process - so over the product's life the single
/// <c>aiinsights</c> collection accumulated documents in TWO INCOMPATIBLE SHAPES:
///
/// - camelCase (AIInsight.ts): companyId, surveyId, confidenceScore, affectedSegments,
///   recommendedActions, and Mongoose's default createdAt/updatedAt.
/// - snake_case (Analytics.ts): company_id, survey_id, confidence_score, plus five
///   fields the camelCase shape never had - department_id, supporting_data,
///   is_acknowledged, acknowledged_by/at, expires_at.
///
/// The target entity is already the union of both, so this mapper is where the split
/// finally reconciles. It reads whichever shape a document carries, per field, and
/// <b>reports which one each document was</b> - the census (#334) cannot report that
/// distribution, because the collection is one name to it, and a reviewer needs to know
/// whether the corpus is 5% or 95% of the shape their reports were written against.
///
/// A document carrying NEITHER company field is a skip: company_id is a non-nullable FK
/// and the whole point of this collection is per-tenant analysis.
/// </summary>
public static class AiInsightMapper
{
    public const string Collection = "aiinsights";

    private static readonly string[] Types = ["pattern", "risk", "recommendation", "prediction", "alert"];
    private static readonly string[] Priorities = ["low", "medium", "high", "critical"];

    public static AIInsight? Map(LegacyAiInsight doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        // Which of #152's two shapes is this document? The company field decides,
        // because both shapes require it and neither omits it.
        var camel = doc.CompanyIdCamel is not null;
        var snake = doc.CompanyIdSnake is not null;
        if (!camel && !snake)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "document carries neither company_id nor companyId, so it matches neither of the two shapes "
                + "this collection accumulated (#152); it cannot be tenant-scoped",
                "company_id");
            return null;
        }

        report.Normalisation(
            camel && snake ? MigrationRules.AiInsightShapeAmbiguous : MigrationRules.AiInsightShapeRecorded,
            Collection, legacyId, "(document shape)",
            camel && snake
                ? "document carries BOTH the camelCase and snake_case shapes of #152's split model; "
                  + "the snake_case fields win because that shape is the superset"
                : camel
                    ? "document written by AIInsight.ts (camelCase shape of #152's split model)"
                    : "document written by Analytics.ts (snake_case shape of #152's split model)");

        var companyRef = ReferenceResolver.Classify(
            CompanyMapper.Collection, doc.CompanyIdSnake ?? doc.CompanyIdCamel, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "company_id does not resolve; the column is a non-nullable FK", "company_id");
            return null;
        }

        var title = MapperHelpers.Truncated(doc.Title, 500, Collection, legacyId, "title", report);
        var description = MapperHelpers.Trimmed(doc.Description);
        var category = MapperHelpers.Truncated(doc.Category, 100, Collection, legacyId, "category", report);
        if (title is null || description is null || category is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "insight is missing its title, description or category, all NOT NULL",
                title is null ? "title" : description is null ? "description" : "category");
            return null;
        }

        var type = MapperHelpers.Trimmed(doc.Type);
        if (type is null || !Types.Contains(type, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.AiInsightTypeUnknown, Collection, legacyId,
                $"type '{doc.Type}' is in neither shape's vocabulary ({string.Join(", ", Types)})", "type");
            return null;
        }

        var priority = MapperHelpers.Trimmed(doc.Priority) ?? "medium";
        if (!Priorities.Contains(priority, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.NotificationVocabularyUnknown, Collection, legacyId, "priority",
                $"'{doc.Priority}' is not one of {string.Join(", ", Priorities)}; recorded as 'medium'");
            priority = "medium";
        }

        // confidenceScore is 0-100 in the camelCase shape; the target column is an int
        // in the same range. A double is rounded, and anything outside the range is
        // clamped by name rather than written into a column that documents 0-100.
        var rawScore = doc.ConfidenceScoreSnake ?? doc.ConfidenceScoreCamel ?? 0d;
        var score = (int)Math.Round(rawScore, MidpointRounding.AwayFromZero);
        if (score is < 0 or > 100)
        {
            report.Normalisation(MigrationRules.AiInsightConfidenceClamped, Collection, legacyId, "confidence_score",
                $"score {rawScore} is outside the documented 0-100 range; clamped");
            score = Math.Clamp(score, 0, 100);
        }

        Guid? surveyId = null;
        var surveyRef = ReferenceResolver.Classify(
            SurveyMapper.Collection, doc.SurveyIdSnake ?? doc.SurveyIdCamel, context.Surveys);
        if (surveyRef.Kind == ReferenceKind.Resolved)
        {
            surveyId = surveyRef.TargetId;
        }
        else if (surveyRef.Kind is not ReferenceKind.Absent)
        {
            report.Degraded(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "survey_id",
                "survey_id does not resolve; loaded as NULL - a company-wide insight is a real shape here");
        }

        Guid? departmentId = null;
        var departmentRef = ReferenceResolver.Classify(
            DepartmentMapper.Collection, doc.DepartmentId, context.Departments);
        if (departmentRef.Kind == ReferenceKind.Resolved)
        {
            departmentId = departmentRef.TargetId;
        }
        else if (departmentRef.Kind is not ReferenceKind.Absent)
        {
            report.Degraded(
                departmentRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "department_id", "department_id does not resolve; loaded as NULL");
        }

        Guid? acknowledgedBy = null;
        var ackRef = ReferenceResolver.Classify(UserMapper.Collection, doc.AcknowledgedBy, context.Users);
        if (ackRef.Kind == ReferenceKind.Resolved)
        {
            acknowledgedBy = ackRef.TargetId;
        }
        else if (ackRef.Kind is not ReferenceKind.Absent)
        {
            report.Degraded(
                ackRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "acknowledged_by",
                "acknowledged_by does not resolve; loaded as NULL - the acknowledgement itself still stands");
        }

        // Each shape carries its own timestamp names; take whichever exists.
        var created = doc.CreatedAtSnake ?? doc.CreatedAtCamel;
        var updated = doc.UpdatedAtSnake ?? doc.UpdatedAtCamel;

        return new AIInsight
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyId,
            CompanyId = companyRef.TargetId!.Value,
            DepartmentId = departmentId,
            Type = type,
            Category = category,
            Title = title,
            Description = description,
            ConfidenceScore = score,
            Priority = priority,
            AffectedSegments = Cleaned(doc.AffectedSegmentsSnake ?? doc.AffectedSegmentsCamel),
            RecommendedActions = Cleaned(doc.RecommendedActionsSnake ?? doc.RecommendedActionsCamel),

            // The camelCase shape had no supporting_data column; its 'metadata' blob is
            // the nearest equivalent and lands there rather than being dropped.
            SupportingData = LegacyJson.Serialize(doc.SupportingData) ?? LegacyJson.Serialize(doc.Metadata),
            IsAcknowledged = doc.IsAcknowledged ?? false,
            AcknowledgedBy = acknowledgedBy,
            AcknowledgedAt = Utc(doc.AcknowledgedAt),
            ExpiresAt = Utc(doc.ExpiresAt),
            CreatedAt = MapperHelpers.Timestamp(created, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(updated, doc.Id, Collection, "updated_at", report),
        };
    }

    private static List<string> Cleaned(List<string>? values)
        => (values ?? [])
            .Select(MapperHelpers.Trimmed)
            .Where(value => value is not null)
            .Select(value => value!)
            .ToList();

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}

/// <summary>A mapped analytics insight and its two child series.</summary>
public sealed record MappedAnalyticsInsight(
    AnalyticsInsight Insight,
    IReadOnlyList<AnalyticsMetricData> Data,
    IReadOnlyList<AnalyticsTimeSeries> TimeSeries);

/// <summary>
/// Precomputed aggregates. Both embedded arrays fan out to child tables keyed
/// positionally - legacy gave the points no ids, and a metric series is meaningful
/// only in its own order, which array position preserves exactly.
/// </summary>
public static class AnalyticsInsightMapper
{
    public const string Collection = "analyticsinsights";
    public const string DataScope = "data";
    public const string SeriesScope = "time_series";

    private static readonly string[] AggregationTypes =
        ["survey", "department", "company", "question", "demographic"];
    private static readonly string[] MetricTypes = ["average", "count", "percentage", "distribution", "trend"];

    public static MappedAnalyticsInsight? Map(LegacyAnalyticsInsight doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

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

        var aggregationType = MapperHelpers.Trimmed(doc.AggregationType);
        var metricType = MapperHelpers.Trimmed(doc.MetricType);
        var metricName = MapperHelpers.Truncated(doc.MetricName, 200, Collection, legacyId, "metric_name", report);
        if (aggregationType is null || !AggregationTypes.Contains(aggregationType, StringComparer.Ordinal)
            || metricType is null || !MetricTypes.Contains(metricType, StringComparer.Ordinal)
            || metricName is null)
        {
            report.Skip(MigrationRules.AnalyticsVocabularyUnknown, Collection, legacyId,
                $"aggregation_type '{doc.AggregationType}' / metric_type '{doc.MetricType}' / metric_name "
                + "must all be present and in vocabulary; these three decide how the aggregate is read",
                metricName is null ? "metric_name" : aggregationType is null ? "aggregation_type" : "metric_type");
            return null;
        }

        Guid? surveyId = null;
        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SurveyId, context.Surveys);
        if (surveyRef.Kind == ReferenceKind.Resolved)
        {
            surveyId = surveyRef.TargetId;
        }
        else if (surveyRef.Kind is not ReferenceKind.Absent)
        {
            report.Degraded(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "survey_id", "survey_id does not resolve; loaded as NULL");
        }

        Guid? departmentId = null;
        var departmentRef = ReferenceResolver.Classify(
            DepartmentMapper.Collection, doc.DepartmentId, context.Departments);
        if (departmentRef.Kind == ReferenceKind.Resolved)
        {
            departmentId = departmentRef.TargetId;
        }
        else if (departmentRef.Kind is not ReferenceKind.Absent)
        {
            report.Degraded(
                departmentRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "department_id", "department_id does not resolve; loaded as NULL");
        }

        var insight = new AnalyticsInsight
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyId,
            CompanyId = companyRef.TargetId!.Value,
            DepartmentId = departmentId,
            AggregationType = aggregationType,
            MetricType = metricType,
            MetricName = metricName,
            MetricDescription = MapperHelpers.Truncated(
                doc.MetricDescription, 500, Collection, legacyId, "metric_description", report),
            TotalResponses = doc.TotalResponses ?? 0,
            CalculationDate = doc.CalculationDate is { } calculated
                ? new DateTimeOffset(DateTime.SpecifyKind(calculated, DateTimeKind.Utc))
                : MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "calculation_date", report),
            IsCurrent = doc.IsCurrent ?? true,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        var data = new List<AnalyticsMetricData>();
        for (var index = 0; index < (doc.Data?.Count ?? 0); index++)
        {
            var point = doc.Data![index];
            var field = $"data[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, point.Extra));

            var label = MapperHelpers.Truncated(point.Label, 200, Collection, legacyId, $"{field}.label", report);
            if (label is null || point.Value is not { } value)
            {
                report.Normalisation(MigrationRules.AnalyticsPointIncomplete, Collection, legacyId, field,
                    "metric point is missing its label or value, both NOT NULL; not migrated");
                continue;
            }

            data.Add(new AnalyticsMetricData
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, DataScope, $"#{index}"),
                InsightId = insight.Id,
                Label = label,
                Value = value,
                Count = point.Count,
                Percentage = point.Percentage,
            });
        }

        var series = new List<AnalyticsTimeSeries>();
        for (var index = 0; index < (doc.TimeSeries?.Count ?? 0); index++)
        {
            var point = doc.TimeSeries![index];
            var field = $"time_series[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, point.Extra));

            if (point.Date is not { } date || point.Value is not { } value)
            {
                report.Normalisation(MigrationRules.AnalyticsPointIncomplete, Collection, legacyId, field,
                    "time-series point is missing its date or value, both NOT NULL; not migrated");
                continue;
            }

            series.Add(new AnalyticsTimeSeries
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, SeriesScope, $"#{index}"),
                InsightId = insight.Id,
                Date = new DateTimeOffset(DateTime.SpecifyKind(date, DateTimeKind.Utc)),
                Value = value,
                Count = point.Count ?? 0,
            });
        }

        return new MappedAnalyticsInsight(insight, data, series);
    }
}
