using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped microclimate and its three fan-outs.</summary>
public sealed record MappedMicroclimate(
    Microclimate Microclimate,
    IReadOnlyList<MicroclimateQuestion> Questions,
    IReadOnlyList<MicroclimateQuestionOption> Options,
    IReadOnlyList<MicroclimateDepartmentTarget> DepartmentTargets,
    IReadOnlyList<MicroclimateAiInsight> Insights);

/// <summary>
/// The live-pulse sibling of a survey. Same #195 attribution (one monolingual string
/// per content field, routed by Company.language, Language set to that one language),
/// same embedded-question identity via MigrationIds.ForChild.
///
/// Three shape differences from the survey path, each a named rule:
/// - <b>Scheduling.</b> Legacy stored start_time + duration_minutes; the target stores
///   start and END. The end is derived - which is exactly what the legacy product
///   computed at read time - so no information is invented, only materialised.
///   auto_close has no target column on a microclimate and is a named drop.
/// - <b>Emoji questions are unrepresentable.</b> QuestionTypes.ForMicroclimate excludes
///   emoji_rating deliberately: MicroclimateQuestion has no emoji table to hold the
///   set, so an accepted emoji question could never render its options. Those questions
///   drop by name, the same call the template slice made.
/// - <b>AI insights carry no id</b>, so their identity is positional within the parent.
///   Nothing references them, and positional keying is deterministic over one dump.
/// </summary>
public static class MicroclimateMapper
{
    public const string Collection = "microclimates";
    public const string QuestionScope = "questions";
    public const string InsightScope = "ai_insights";

    /// <summary>Legacy status -> target. paused/cancelled land where the survey slice put them.</summary>
    private static readonly Dictionary<string, string> StatusRemap = new(StringComparer.Ordinal)
    {
        ["paused"] = SurveyStatuses.Closed,
        ["completed"] = SurveyStatuses.Closed,
        ["cancelled"] = SurveyStatuses.Archived,
    };

    private static readonly string[] EngagementLevels = ["low", "medium", "high"];

    public static MappedMicroclimate? Map(LegacyMicroclimate doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra),
            ("targeting", doc.Targeting?.Extra),
            ("scheduling", doc.Scheduling?.Extra),
            ("real_time_settings", doc.RealTimeSettings?.Extra),
            ("live_results", doc.LiveResults?.Extra));

        var title = MapperHelpers.Truncated(doc.Title, 150, Collection, legacyId, "title", report);
        if (title is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "microclimate has no title", "title");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; the column is a non-nullable FK",
                "company_id");
            return null;
        }

        var creatorRef = ReferenceResolver.Classify(UserMapper.Collection, doc.CreatedBy, context.Users);
        if (creatorRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                creatorRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"created_by '{doc.CreatedBy}' is {creatorRef.Kind}; the column is a non-nullable FK",
                "created_by");
            return null;
        }

        if (doc.Scheduling?.StartTime is not { } startTime)
        {
            // scheduling_start_time and _end_time are both NOT NULL, and a pulse
            // without a window cannot be placed in time at all.
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "microclimate has no scheduling.start_time; both window columns are NOT NULL",
                "scheduling.start_time");
            return null;
        }

        var status = MapStatus(doc.Status, legacyId, report);
        if (status is null)
        {
            return null;
        }

        var companyId = companyRef.TargetId!.Value;
        var language = context.LanguageOf(companyId);
        var english = language == "en";

        report.Attribution(Collection, legacyId, "title", language);
        var description = MapperHelpers.Truncated(doc.Description, 500, Collection, legacyId, "description", report);
        if (description is not null)
        {
            report.Attribution(Collection, legacyId, "description", language);
        }

        // template_id points at microclimatetemplates, which load before this stage.
        Guid? templateId = null;
        var templateRef = ReferenceResolver.Classify(
            MicroclimateTemplateMapper.Collection, doc.TemplateId, context.MicroclimateTemplates);
        switch (templateRef.Kind)
        {
            case ReferenceKind.Resolved:
                templateId = templateRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    templateRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "template_id",
                    $"template_id '{doc.TemplateId}' is {templateRef.Kind}; loaded as NULL");
                break;
        }

        var start = new DateTimeOffset(DateTime.SpecifyKind(startTime, DateTimeKind.Utc));

        // The target materialises what legacy computed on every read.
        var duration = doc.Scheduling?.DurationMinutes;
        if (duration is null)
        {
            report.Normalisation(MigrationRules.MicroclimateDurationDefaulted, Collection, legacyId,
                "scheduling.duration_minutes",
                "no duration recorded; end_time derived with the 30 minutes the template default uses");
        }

        var microclimate = new Microclimate
        {
            Id = MigrationIds.For(Collection, doc.Id),
            TitleEn = english ? title : null,
            TitleEs = english ? null : title,
            DescriptionEn = english ? description : null,
            DescriptionEs = english ? null : description,
            Language = language,
            CompanyId = companyId,
            CreatedBy = creatorRef.TargetId!.Value,
            TemplateId = templateId,
            Status = status,
            ResponseCount = doc.ResponseCount ?? 0,
            TargetParticipantCount = doc.TargetParticipantCount ?? 0,
            ParticipationRate = doc.ParticipationRate ?? 0d,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        microclimate.Scheduling.StartTime = start;
        microclimate.Scheduling.EndTime = start.AddMinutes(duration ?? 30);
        if (MapperHelpers.Truncated(doc.Scheduling?.Timezone, 100, Collection, legacyId,
                "scheduling.timezone", report) is { } timezone)
        {
            microclimate.Scheduling.Timezone = timezone;
        }

        microclimate.Scheduling.ReminderSchedule = LegacyJson.Serialize(doc.Scheduling?.ReminderSettings);
        if (doc.Scheduling?.AutoClose is not null)
        {
            report.Normalisation(MigrationRules.MicroclimateAutoCloseDropped, Collection, legacyId,
                "scheduling.auto_close",
                "a microclimate has no auto_close column (only a template's settings do); the window is end_time");
        }

        MapTargeting(doc, microclimate, legacyId, report);
        MapRealtime(doc, microclimate);
        MapLiveResults(doc, microclimate, legacyId, report);

        var (questions, options) = MapQuestions(doc, microclimate.Id, legacyId, language, report);
        return new MappedMicroclimate(
            microclimate,
            questions,
            options,
            MapDepartmentTargets(doc, microclimate.Id, legacyId, context),
            MapInsights(doc, microclimate.Id, legacyId, report));
    }

    private static string? MapStatus(string? raw, string legacyId, DataQualityReport report)
    {
        var status = MapperHelpers.Trimmed(raw) ?? SurveyStatuses.Draft;
        if (StatusRemap.TryGetValue(status, out var remapped))
        {
            report.Normalisation(MigrationRules.MicroclimateStatusRemapped, Collection, legacyId, "status",
                $"legacy status '{status}' recorded as '{remapped}'");
            return remapped;
        }

        if (!SurveyStatuses.All.Contains(status, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.SurveyStatusUnknown, Collection, legacyId,
                $"status '{raw}' is in neither vocabulary", "status");
            return null;
        }

        return status;
    }

    private static void MapTargeting(
        LegacyMicroclimate doc, Microclimate microclimate, string legacyId, DataQualityReport report)
    {
        if (doc.Targeting is not { } targeting)
        {
            return;
        }

        microclimate.Targeting.RoleFilters = Cleaned(targeting.RoleFilters);
        microclimate.Targeting.TenureFilters = Cleaned(targeting.TenureFilters);
        microclimate.Targeting.CustomFilters = LegacyJson.Serialize(targeting.CustomFilters);
        if (targeting.IncludeManagers is { } includeManagers)
        {
            microclimate.Targeting.IncludeManagers = includeManagers;
        }

        microclimate.Targeting.MaxParticipants = targeting.MaxParticipants;
    }

    private static void MapRealtime(LegacyMicroclimate doc, Microclimate microclimate)
    {
        if (doc.RealTimeSettings is not { } settings)
        {
            return;
        }

        var target = microclimate.RealtimeSettings;
        if (settings.ShowLiveResults is { } live) target.ShowLiveResults = live;
        if (settings.AnonymousResponses is { } anonymous) target.AnonymousResponses = anonymous;
        if (settings.AllowComments is { } comments) target.AllowComments = comments;
        if (settings.WordCloudEnabled is { } wordCloud) target.WordCloudEnabled = wordCloud;
        if (settings.SentimentAnalysisEnabled is { } sentiment) target.SentimentAnalysisEnabled = sentiment;
        if (settings.ParticipationThreshold is { } threshold) target.ParticipationThreshold = threshold;
    }

    private static void MapLiveResults(
        LegacyMicroclimate doc, Microclimate microclimate, string legacyId, DataQualityReport report)
    {
        if (doc.LiveResults is not { } live)
        {
            return;
        }

        var target = microclimate.LiveResults;
        if (live.SentimentScore is { } score) target.SentimentScore = score;

        var engagement = MapperHelpers.Trimmed(live.EngagementLevel);
        if (engagement is not null)
        {
            if (EngagementLevels.Contains(engagement, StringComparer.Ordinal))
            {
                target.EngagementLevel = engagement;
            }
            else
            {
                report.Normalisation(MigrationRules.MicroclimateEngagementUnknown, Collection, legacyId,
                    "live_results.engagement_level",
                    $"'{engagement}' is not low/medium/high; recorded as the column's own default");
            }
        }

        target.TopThemes = Cleaned(live.TopThemes) ?? [];
        target.WordCloudData = LegacyJson.Serialize(live.WordCloudData);
        target.ResponseDistribution = LegacyJson.Serialize(live.ResponseDistribution);
    }

    private static (List<MicroclimateQuestion>, List<MicroclimateQuestionOption>) MapQuestions(
        LegacyMicroclimate doc, Guid microclimateId, string legacyId, string language, DataQualityReport report)
    {
        var questions = new List<MicroclimateQuestion>();
        var options = new List<MicroclimateQuestionOption>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < (doc.Questions?.Count ?? 0); index++)
        {
            var legacy = doc.Questions![index];
            var field = $"questions[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var key = MapperHelpers.Trimmed(legacy.Id);
            if (key is null || !seenKeys.Add(key))
            {
                report.Normalisation(MigrationRules.MicroclimateQuestionIdFromPosition, Collection, legacyId,
                    $"{field}.id",
                    key is null ? "question has no id; keyed by array position"
                        : $"another question already carries id '{key}'; this one keyed by array position");
                key = $"#{index}";
                seenKeys.Add(key);
            }

            var type = MicroclimateQuestionTypes.Map(legacy.Type, Collection, legacyId, field, report);
            if (type is null)
            {
                continue;
            }

            var questionId = MigrationIds.ForChild(Collection, doc.Id, QuestionScope, key);
            var english = language == "en";
            var text = MapperHelpers.Truncated(legacy.Text, 500, Collection, legacyId, $"{field}.text", report);
            if (text is not null)
            {
                report.Attribution(Collection, legacyId, $"{field}.text", language);
            }

            questions.Add(new MicroclimateQuestion
            {
                Id = questionId,
                MicroclimateId = microclimateId,
                TextEn = english ? text : null,
                TextEs = english ? null : text,
                Type = type,
                Required = legacy.Required ?? true,
                Order = legacy.Order ?? index,
            });

            var seenValues = new HashSet<string>(StringComparer.Ordinal);
            var order = 0;
            for (var optionIndex = 0; optionIndex < (legacy.Options?.Count ?? 0); optionIndex++)
            {
                var value = MapperHelpers.Truncated(legacy.Options![optionIndex], 500,
                    Collection, legacyId, $"{field}.options[{optionIndex}]", report);
                if (value is null)
                {
                    continue;
                }

                if (!seenValues.Add(value))
                {
                    report.Normalisation(MigrationRules.QuestionOptionDuplicateValue, Collection, legacyId,
                        $"{field}.options[{optionIndex}]",
                        $"another option of this question already carries value '{value}'");
                    continue;
                }

                options.Add(new MicroclimateQuestionOption
                {
                    MicroclimateQuestionId = questionId,
                    Order = order++,
                    Value = value,
                    LabelEn = english ? value : null,
                    LabelEs = english ? null : value,
                });
            }
        }

        return (questions, options);
    }

    private static List<MicroclimateDepartmentTarget> MapDepartmentTargets(
        LegacyMicroclimate doc, Guid microclimateId, string legacyId, MappingContext context)
    {
        var targets = new List<MicroclimateDepartmentTarget>();
        var seen = new HashSet<Guid>();
        foreach (var reference in doc.Targeting?.DepartmentIds ?? [])
        {
            var classification = ReferenceResolver.Classify(
                DepartmentMapper.Collection, reference, context.Departments);
            switch (classification.Kind)
            {
                case ReferenceKind.Resolved when seen.Add(classification.TargetId!.Value):
                    targets.Add(new MicroclimateDepartmentTarget
                    {
                        MicroclimateId = microclimateId,
                        DepartmentId = classification.TargetId!.Value,
                    });
                    break;
                case ReferenceKind.Resolved:
                case ReferenceKind.Absent:
                    break;
                default:
                    context.Report.Degraded(
                        classification.Kind == ReferenceKind.Malformed
                            ? MigrationRules.MalformedReference
                            : MigrationRules.DanglingReference,
                        Collection, legacyId, "targeting.department_ids",
                        $"'{reference}' is {classification.Kind}; target row not created");
                    break;
            }
        }

        return targets;
    }

    private static List<MicroclimateAiInsight> MapInsights(
        LegacyMicroclimate doc, Guid microclimateId, string legacyId, DataQualityReport report)
    {
        var insights = new List<MicroclimateAiInsight>();
        for (var index = 0; index < (doc.AiInsights?.Count ?? 0); index++)
        {
            var legacy = doc.AiInsights![index];
            var field = $"ai_insights[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var type = MapperHelpers.Truncated(legacy.Type, 20, Collection, legacyId, $"{field}.type", report);
            var message = MapperHelpers.Truncated(legacy.Message, 1000, Collection, legacyId, $"{field}.message", report);
            if (type is null || message is null)
            {
                // Both columns are NOT NULL and an insight without its message says
                // nothing; there is no honest placeholder for generated analysis.
                report.Normalisation(MigrationRules.MicroclimateInsightIncomplete, Collection, legacyId, field,
                    "insight is missing its type or message, both NOT NULL; not migrated");
                continue;
            }

            insights.Add(new MicroclimateAiInsight
            {
                // No legacy id exists on these subdocuments, so identity is positional.
                Id = MigrationIds.ForChild(Collection, doc.Id, InsightScope, $"#{index}"),
                MicroclimateId = microclimateId,
                Type = type,
                Message = message,
                Confidence = legacy.Confidence ?? 0d,
                Timestamp = legacy.Timestamp is { } timestamp
                    ? new DateTimeOffset(DateTime.SpecifyKind(timestamp, DateTimeKind.Utc))
                    : MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, $"{field}.timestamp", report),
            });
        }

        return insights;
    }

    internal static string[]? Cleaned(List<string>? values)
    {
        if (values is null)
        {
            return null;
        }

        var cleaned = values
            .Select(MapperHelpers.Trimmed)
            .Where(value => value is not null)
            .Select(value => value!)
            .ToArray();
        return cleaned.Length == 0 ? null : cleaned;
    }
}

/// <summary>
/// The microclimate question vocabulary, shared by the live and template mappers.
/// QuestionTypes.ForMicroclimate excludes emoji_rating deliberately - there is no
/// emoji table on either microclimate question entity - so an emoji question cannot be
/// accepted without creating one that can never render its options.
/// </summary>
internal static class MicroclimateQuestionTypes
{
    public static string? Map(
        string? raw, string collection, string legacyId, string field, DataQualityReport report)
    {
        var type = MapperHelpers.Trimmed(raw);
        switch (type)
        {
            case "yes_no_comment":
                report.Normalisation(MigrationRules.QuestionTypeYesNoCommentRemapped, collection, legacyId,
                    $"{field}.type", "yes_no_comment folds into yes_no");
                return QuestionTypes.YesNo;
            case "emoji_scale":
            case QuestionTypes.EmojiRating:
                report.Normalisation(MigrationRules.MicroclimateQuestionEmojiUnrepresentable, collection, legacyId,
                    $"{field}.type",
                    "a microclimate question has no emoji table to hold its set, so the type is excluded from "
                    + "QuestionTypes.ForMicroclimate; question not migrated");
                return null;
        }

        if (type is null || !QuestionTypes.ForMicroclimate.Contains(type, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.QuestionTypeUnknown, collection, legacyId, $"{field}.type",
                $"type '{raw}' is not in the microclimate vocabulary; question not migrated");
            return null;
        }

        return type;
    }
}

/// <summary>A mapped microclimate template and its question/option fan-out.</summary>
public sealed record MappedMicroclimateTemplate(
    MicroclimateTemplate Template,
    IReadOnlyList<MicroclimateTemplateQuestion> Questions,
    IReadOnlyList<MicroclimateTemplateQuestionOption> Options);

/// <summary>
/// Same tenant-leak rule as the survey template: CompanyId NULL means globally visible,
/// so an ABSENT company is a legitimately global template and an unresolvable one is a
/// reported skip rather than a NULL that would publish a private template to everyone.
/// </summary>
public static class MicroclimateTemplateMapper
{
    public const string Collection = "microclimatetemplates";
    public const string QuestionScope = "questions";

    public static MappedMicroclimateTemplate? Map(LegacyMicroclimateTemplate doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra), ("settings", doc.Settings?.Extra));

        var name = MapperHelpers.Truncated(doc.Name, 200, Collection, legacyId, "name", report);
        var description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report);
        var category = MapperHelpers.Truncated(doc.Category, 20, Collection, legacyId, "category", report);
        if (name is null || description is null || category is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "template is missing name, description or category, all NOT NULL",
                name is null ? "name" : description is null ? "description" : "category");
            return null;
        }

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
                    $"company_id '{doc.CompanyId}' is {companyRef.Kind}; NULL would make a private template "
                    + "globally visible, so the row is skipped",
                    "company_id");
                return null;
        }

        Guid? createdBy = null;
        var creatorRef = ReferenceResolver.Classify(UserMapper.Collection, doc.CreatedBy, context.Users);
        switch (creatorRef.Kind)
        {
            case ReferenceKind.Resolved:
                createdBy = creatorRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    creatorRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "created_by",
                    $"created_by '{doc.CreatedBy}' is {creatorRef.Kind}; loaded as NULL");
                break;
        }

        var language = companyId is { } company ? context.LanguageOf(company) : "en";
        var template = new MicroclimateTemplate
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            Description = description,
            Category = category,
            CompanyId = companyId,
            CreatedBy = createdBy,
            IsSystemTemplate = doc.IsSystemTemplate ?? false,
            UsageCount = doc.UsageCount ?? 0,
            IsActive = doc.IsActive ?? true,
            Tags = MicroclimateMapper.Cleaned(doc.Tags) ?? [],
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.Settings is { } settings)
        {
            if (settings.DefaultDurationMinutes is { } duration) template.Settings.DefaultDurationMinutes = duration;
            if (MapperHelpers.Truncated(settings.SuggestedFrequency, 20, Collection, legacyId,
                    "settings.suggested_frequency", report) is { } frequency)
            {
                template.Settings.SuggestedFrequency = frequency;
            }

            template.Settings.MaxParticipants = settings.MaxParticipants;
            if (settings.AnonymousByDefault is { } anonymous) template.Settings.AnonymousByDefault = anonymous;
            if (settings.AutoClose is { } autoClose) template.Settings.AutoClose = autoClose;
            if (settings.ShowLiveResults is { } live) template.Settings.ShowLiveResults = live;
        }

        var questions = new List<MicroclimateTemplateQuestion>();
        var options = new List<MicroclimateTemplateQuestionOption>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        var english = language == "en";

        for (var index = 0; index < (doc.Questions?.Count ?? 0); index++)
        {
            var legacy = doc.Questions![index];
            var field = $"questions[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var key = MapperHelpers.Trimmed(legacy.Id);
            if (key is null || !seenKeys.Add(key))
            {
                report.Normalisation(MigrationRules.MicroclimateQuestionIdFromPosition, Collection, legacyId,
                    $"{field}.id", "question id absent or duplicated; keyed by array position");
                key = $"#{index}";
                seenKeys.Add(key);
            }

            var type = MicroclimateQuestionTypes.Map(legacy.Type, Collection, legacyId, field, report);
            if (type is null)
            {
                continue;
            }

            var questionId = MigrationIds.ForChild(Collection, doc.Id, QuestionScope, key);
            var text = MapperHelpers.Truncated(legacy.Text, 500, Collection, legacyId, $"{field}.text", report);
            if (text is not null)
            {
                report.Attribution(Collection, legacyId, $"{field}.text", language);
            }

            questions.Add(new MicroclimateTemplateQuestion
            {
                Id = questionId,
                TemplateId = template.Id,
                TextEn = english ? text : null,
                TextEs = english ? null : text,
                Type = type,
                Required = legacy.Required ?? true,
                Order = legacy.Order ?? index,
                Category = null,
            });

            var seenValues = new HashSet<string>(StringComparer.Ordinal);
            var order = 0;
            for (var optionIndex = 0; optionIndex < (legacy.Options?.Count ?? 0); optionIndex++)
            {
                var value = MapperHelpers.Truncated(legacy.Options![optionIndex], 500,
                    Collection, legacyId, $"{field}.options[{optionIndex}]", report);
                if (value is null || !seenValues.Add(value))
                {
                    if (value is not null)
                    {
                        report.Normalisation(MigrationRules.QuestionOptionDuplicateValue, Collection, legacyId,
                            $"{field}.options[{optionIndex}]", $"duplicate option value '{value}'");
                    }

                    continue;
                }

                options.Add(new MicroclimateTemplateQuestionOption
                {
                    MicroclimateTemplateQuestionId = questionId,
                    Order = order++,
                    Value = value,
                    LabelEn = english ? value : null,
                    LabelEs = english ? null : value,
                });
            }
        }

        return new MappedMicroclimateTemplate(template, questions, options);
    }
}

/// <summary>
/// The microclimate invitation. Structurally the survey invitation's twin, and its
/// token is inert for the same reason with a different shape: legacy minted
/// <c>crypto.randomBytes(32).toString('hex')</c> - 64 hex characters - where
/// SurveyAccessTokens.HasExpectedShape admits only 43 base64url ones.
/// </summary>
public static class MicroclimateInvitationMapper
{
    public const string Collection = "microclimateinvitations";

    public static MicroclimateInvitation? Map(LegacyMicroclimateInvitation doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra), ("metadata", doc.Metadata?.Extra));

        var microclimateRef = ReferenceResolver.Classify(
            MicroclimateMapper.Collection, LegacyReferences.HexOf(doc.MicroclimateId), context.Microclimates);
        if (microclimateRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                microclimateRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                "microclimate_id does not resolve; an invitation cannot outlive its microclimate",
                "microclimate_id");
            return null;
        }

        var userRef = ReferenceResolver.Classify(
            UserMapper.Collection, LegacyReferences.HexOf(doc.UserId), context.Users);
        if (userRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                userRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "user_id does not resolve; the column is a non-nullable FK", "user_id");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(
            CompanyMapper.Collection, LegacyReferences.HexOf(doc.CompanyId), context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "company_id does not resolve; the column is a non-nullable FK", "company_id");
            return null;
        }

        var email = MapperHelpers.Truncated(doc.Email, 255, Collection, legacyId, "email", report)?.ToLowerInvariant();
        var token = MapperHelpers.Truncated(doc.InvitationToken, 255, Collection, legacyId, "invitation_token", report);
        if (email is null || token is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "invitation is missing its email or token, both NOT NULL",
                email is null ? "email" : "invitation_token");
            return null;
        }

        var legacyStatus = MapperHelpers.Trimmed(doc.Status) ?? SurveyInvitationStatuses.Pending;
        var status = legacyStatus;
        if (!SurveyInvitationStatuses.All.Contains(legacyStatus, StringComparer.Ordinal))
        {
            status = doc.CompletedAt is not null ? SurveyInvitationStatuses.Completed
                : doc.StartedAt is not null ? SurveyInvitationStatuses.Started
                : doc.OpenedAt is not null ? SurveyInvitationStatuses.Opened
                : doc.SentAt is not null ? SurveyInvitationStatuses.Sent
                : SurveyInvitationStatuses.Pending;
            report.Normalisation(MigrationRules.InvitationStatusReconstructed, Collection, legacyId, "status",
                $"legacy status '{legacyStatus}' has no target member; reconstructed as '{status}' from the "
                + "row's own timestamps");
        }

        var createdAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report);
        var expiresAt = doc.ExpiresAt is { } expiry
            ? new DateTimeOffset(DateTime.SpecifyKind(expiry, DateTimeKind.Utc))
            : createdAt.AddDays(30);
        if (doc.ExpiresAt is null)
        {
            report.Normalisation(MigrationRules.InvitationExpiryDerived, Collection, legacyId, "expires_at",
                "invitation carries no expires_at; the target column is NOT NULL, so it is derived from created_at");
        }

        if (status != SurveyInvitationStatuses.Completed)
        {
            report.Normalisation(MigrationRules.InvitationTokenInert, Collection, legacyId, "invitation_token",
                "the legacy token is preserved as a record but cannot authenticate in the new system "
                + "(64-hex shape, refused by SurveyAccessTokens.HasExpectedShape); this person must be re-invited");
        }

        return new MicroclimateInvitation
        {
            Id = MigrationIds.For(Collection, doc.Id),
            MicroclimateId = microclimateRef.TargetId!.Value,
            UserId = userRef.TargetId!.Value,
            CompanyId = companyRef.TargetId!.Value,
            Email = email,
            InvitationToken = token,
            Status = status,
            SentAt = Utc(doc.SentAt),
            OpenedAt = Utc(doc.OpenedAt),
            StartedAt = Utc(doc.StartedAt),
            CompletedAt = Utc(doc.CompletedAt),
            ReminderCount = doc.ReminderCount ?? 0,
            LastReminderSent = Utc(doc.LastReminderSent),
            ExpiresAt = expiresAt,
            Metadata = System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["legacy_status"] = legacyStatus,
                ["user_agent"] = doc.Metadata?.UserAgent,
                ["ip_address"] = doc.Metadata?.IpAddress,
                ["email_client"] = doc.Metadata?.EmailClient,
            }),
            CreatedAt = createdAt,
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };
    }

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}
