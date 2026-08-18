using ClimateProject.Application.Questions;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped survey template and its question/option fan-out.</summary>
public sealed record MappedSurveyTemplate(
    SurveyTemplate Template,
    IReadOnlyList<TemplateQuestion> Questions,
    IReadOnlyList<TemplateQuestionOption> Options);

/// <summary>
/// SurveyTemplate mirrors the Survey fan-out with four deliberate differences:
///
/// - THE TENANT-LEAK SKIP. CompanyId is nullable and NULL means globally visible
///   (#191's convention; template queries scope company-or-public). So an ABSENT
///   company_id maps to NULL - a legitimately global template - but a
///   dangling/malformed one is a reported SKIP: degrading it to NULL would publish a
///   private company's template to every tenant, the inverse of the trap UserMapper
///   refuses for super-admin scope.
/// - Name and Description are single columns, not paired: the target treats template
///   headers as admin-facing metadata, so nothing routes and nothing attributes.
///   Question CONTENT is paired and attributes by Company.language; a global template
///   has no company, so it takes the fallback locale (en), recorded - the
///   SystemSettings precedent.
/// - emoji_scale questions are unrepresentable: template questions have no emoji
///   table, and SurveyTemplateQuestions refuses the type at the write path, so an
///   instantiated emoji question could never render. The question drops by name.
///   conditional_logic likewise has no template table, but it is auxiliary - the
///   question survives and the logic drops by name.
/// - Nothing references a template question's legacy id (answers reference SURVEY
///   question ids), so a question without one keys by its array position instead of
///   being refused - positional identity is deterministic over the frozen dump, and
///   dropping real content to enforce a reference nobody makes would be loss for
///   nothing. Recorded per question, and a duplicate id falls back the same way.
///
/// The #332 default scrubs come from QuestionContentRules - shared with SurveyMapper,
/// never copied, so the two halves cannot drift on which prompts are real.
/// </summary>
public static class SurveyTemplateMapper
{
    public const string Collection = "surveytemplates";

    /// <summary>The embedded-question scope segment in MigrationIds.ForChild derivations.</summary>
    public const string QuestionScope = "questions";

    public static MappedSurveyTemplate? Map(LegacySurveyTemplate doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var name = MapperHelpers.Truncated(doc.Name, 200, Collection, legacyId, "name", report);
        if (name is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "template has no name", "name");
            return null;
        }

        var description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report);
        if (description is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "template has no description", "description");
            return null;
        }

        var category = MapperHelpers.Truncated(doc.Category, 20, Collection, legacyId, "category", report);
        if (category is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "template has no category", "category");
            return null;
        }

        // Absent -> NULL is a global template; unresolvable is the tenant-leak skip.
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
                    $"company_id '{doc.CompanyId}' is {companyRef.Kind}; NULL would make a private template " +
                    "globally visible, so the row is skipped",
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

        Guid? sourceSurveyId = null;
        var sourceRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SourceSurveyId, context.Surveys);
        switch (sourceRef.Kind)
        {
            case ReferenceKind.Resolved:
                sourceSurveyId = sourceRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    sourceRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "source_survey_id",
                    $"source_survey_id '{doc.SourceSurveyId}' is {sourceRef.Kind}; loaded as NULL");
                break;
        }

        if (doc.DefaultSettings is { ElementCount: > 0 })
        {
            report.Normalisation(MigrationRules.SurveyTemplateDefaultSettingsDropped, Collection, legacyId,
                "default_settings", "the target stores no per-template settings; instantiation applies its own defaults");
        }

        if (doc.Demographics is { Count: > 0 })
        {
            report.Normalisation(MigrationRules.SurveyTemplateDemographicsConfigDropped, Collection, legacyId,
                "demographics", "per-template demographic configuration has no target home; demographics ride on the user since #193");
        }

        // A global template's question content still needs a locale: the fallback
        // (en), recorded like the SystemSettings maintenance message.
        var language = companyId is { } company ? context.LanguageOf(company) : "en";

        var template = new SurveyTemplate
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            Description = description,
            Category = category,
            Industry = MapperHelpers.Truncated(doc.Industry, 100, Collection, legacyId, "industry", report),
            CompanySize = MapperHelpers.Truncated(doc.CompanySize, 20, Collection, legacyId, "company_size", report),
            IsPublic = doc.IsPublic ?? false,
            CreatedBy = createdBy,
            CompanyId = companyId,
            UsageCount = doc.UsageCount ?? 0,
            Rating = doc.Rating ?? 0d,
            Tags = (doc.Tags ?? [])
                .Select(MapperHelpers.Trimmed)
                .Where(tag => tag is not null)
                .Select(tag => tag!)
                .ToArray(),
            SourceSurveyId = sourceSurveyId,
            LastUsed = doc.LastUsed is { } lastUsed
                ? new DateTimeOffset(DateTime.SpecifyKind(lastUsed, DateTimeKind.Utc))
                : null,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        var (questions, options) = MapQuestions(doc, template.Id, legacyId, language, report);
        return new MappedSurveyTemplate(template, questions, options);
    }

    private static (List<TemplateQuestion> Questions, List<TemplateQuestionOption> Options) MapQuestions(
        LegacySurveyTemplate doc, Guid templateId, string legacyId, string language, DataQualityReport report)
    {
        var questions = new List<TemplateQuestion>();
        var options = new List<TemplateQuestionOption>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < (doc.Questions?.Count ?? 0); index++)
        {
            var legacy = doc.Questions![index];
            var field = $"questions[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id,
                (field, legacy.Extra),
                ($"{field}.scale_labels", legacy.ScaleLabels?.Extra),
                ($"{field}.binary_comment_config", legacy.BinaryCommentConfig?.Extra));

            // Positional fallback: nothing references template question ids, so a
            // missing or duplicate one keys by array position instead of dropping
            // real content - deterministic over the same source.
            var questionKey = MapperHelpers.Trimmed(legacy.Id);
            if (questionKey is null || !seenKeys.Add(questionKey))
            {
                report.Normalisation(MigrationRules.SurveyTemplateQuestionIdFromPosition, Collection, legacyId,
                    $"{field}.id",
                    questionKey is null
                        ? "question has no id; keyed by array position (nothing references template question ids)"
                        : $"another question already carries id '{questionKey}'; this one keyed by array position");
                questionKey = $"#{index}";
                seenKeys.Add(questionKey);
            }

            if (MapQuestionType(legacy, legacyId, field, report) is not { } type)
            {
                continue;
            }

            if (legacy.ConditionalLogic is not null)
            {
                report.Normalisation(MigrationRules.SurveyTemplateQuestionConditionalLogicDropped, Collection,
                    legacyId, $"{field}.conditional_logic",
                    "template questions have no conditional-logic table; the question survives, the logic is dropped");
            }

            var questionId = MigrationIds.ForChild(Collection, doc.Id, QuestionScope, questionKey);
            var english = language == "en";
            var text = MapperHelpers.Truncated(legacy.Text, 500, Collection, legacyId, $"{field}.text", report);
            if (text is not null)
            {
                report.Attribution(Collection, legacyId, $"{field}.text", language);
            }

            var scaleLabelMin = MapperHelpers.Truncated(legacy.ScaleLabels?.Min, 200,
                Collection, legacyId, $"{field}.scale_labels.min", report);
            var scaleLabelMax = MapperHelpers.Truncated(legacy.ScaleLabels?.Max, 200,
                Collection, legacyId, $"{field}.scale_labels.max", report);
            var commentPrompt = QuestionContentRules.ScrubbedCommentPrompt(
                legacy.CommentPrompt, Collection, legacyId, field, report);
            var binaryConfig = QuestionContentRules.ScrubbedBinaryConfig(
                legacy.BinaryCommentConfig, Collection, legacyId, field, report);

            var question = new TemplateQuestion
            {
                Id = questionId,
                TemplateId = templateId,
                TextEn = english ? text : null,
                TextEs = english ? null : text,
                Type = type,
                ScaleMin = legacy.ScaleMin,
                ScaleMax = legacy.ScaleMax,
                ScaleLabelMinEn = english ? scaleLabelMin : null,
                ScaleLabelMinEs = english ? null : scaleLabelMin,
                ScaleLabelMaxEn = english ? scaleLabelMax : null,
                ScaleLabelMaxEs = english ? null : scaleLabelMax,
                CommentRequired = legacy.CommentRequired ?? true,
                CommentPromptEn = english ? commentPrompt : null,
                CommentPromptEs = english ? null : commentPrompt,
                BinaryCommentConfigEn = english ? binaryConfig : null,
                BinaryCommentConfigEs = english ? null : binaryConfig,
                Required = legacy.Required ?? false,
                Order = legacy.Order ?? index,
                Category = MapperHelpers.Truncated(legacy.Category, 100, Collection, legacyId, $"{field}.category", report),
            };

            questions.Add(question);
            MapOptions(legacy, questionId, legacyId, field, language, report, options);
        }

        return (questions, options);
    }

    private static string? MapQuestionType(
        LegacySurveyQuestion legacy, string legacyId, string field, DataQualityReport report)
    {
        var type = MapperHelpers.Trimmed(legacy.Type);
        switch (type)
        {
            case "yes_no_comment":
                report.Normalisation(MigrationRules.QuestionTypeYesNoCommentRemapped, Collection, legacyId,
                    $"{field}.type", "yes_no_comment folds into yes_no; its comment shape lives in the comment columns");
                return QuestionTypes.YesNo;
            case "emoji_scale":
            case QuestionTypes.EmojiRating:
                // Unlike a survey question, this cannot land anywhere: template
                // questions have no emoji table, and the write path refuses the type,
                // so an instantiated copy could never render its options.
                report.Normalisation(MigrationRules.SurveyTemplateQuestionEmojiUnrepresentable, Collection,
                    legacyId, $"{field}.type",
                    "emoji questions have no template representation (no emoji table; the type is refused for templates); question not migrated");
                return null;
        }

        if (type is null || !QuestionTypes.ForSurvey.Contains(type, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.QuestionTypeUnknown, Collection, legacyId, $"{field}.type",
                $"type '{legacy.Type}' is not in the template vocabulary; question not migrated");
            return null;
        }

        return type;
    }

    private static void MapOptions(
        LegacySurveyQuestion legacy, Guid questionId, string legacyId, string field,
        string language, DataQualityReport report, List<TemplateQuestionOption> sink)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var order = 0;
        for (var index = 0; index < (legacy.Options?.Count ?? 0); index++)
        {
            var value = MapperHelpers.Truncated(legacy.Options![index], 500,
                Collection, legacyId, $"{field}.options[{index}]", report);
            if (value is null)
            {
                continue;
            }

            if (!seen.Add(value))
            {
                report.Normalisation(MigrationRules.QuestionOptionDuplicateValue, Collection, legacyId,
                    $"{field}.options[{index}]",
                    $"another option of this question already carries value '{value}'; the unique index would refuse it");
                continue;
            }

            sink.Add(new TemplateQuestionOption
            {
                TemplateQuestionId = questionId,
                Order = order++,
                Value = value,
                LabelEn = language == "en" ? value : null,
                LabelEs = language == "es" ? value : null,
            });
        }
    }
}
