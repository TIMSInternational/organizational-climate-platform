using System.Globalization;
using System.Text.Json;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped survey and its full fan-out (design doc load-order row 6).</summary>
public sealed record MappedSurvey(
    Survey Survey,
    IReadOnlyList<Question> Questions,
    IReadOnlyList<QuestionOption> Options,
    IReadOnlyList<QuestionEmojiOption> EmojiOptions,
    IReadOnlyList<QuestionConditionalLogic> ConditionalLogic,
    IReadOnlyList<SurveyDepartmentTarget> DepartmentTargets);

/// <summary>
/// Survey is the first #195-attributed collection: every content field arrives as ONE
/// monolingual string with no language marker anywhere in the source, so each is routed
/// to _en or _es by Company.language, Survey.Language is set to that same single
/// language (never 'both' - the publish gate would fail every migrated survey for
/// translations that never existed), and every attribution is a report entry. One entry
/// covers a question's whole content bundle (text, scale labels, prompts, option
/// labels): they are one authored unit in one language, and per-field entries would
/// say the same thing five times.
///
/// Embedded questions keep the identity contract responses depend on: a legacy answer
/// references (survey_id, question id string), and MigrationIds.ForChild derives the
/// target Question id from exactly that pair - the Response slice re-derives it with
/// no lookup table.
///
/// Two deliberate divergences from a verbatim copy, both mirroring decisions the
/// target schema already made:
/// - A comment_prompt equal to the legacy DDL default literal is scrubbed to NULL.
///   #332's DropCommentPromptDefaults did precisely this to every existing target row:
///   the default was baked in by Mongoose at write time, not authored, and carrying it
///   would put a comment box on every migrated question, inverting the opt-in contract.
///   An all-defaults binary_comment_config is scrubbed for the same reason.
/// - emoji_scale maps to emoji_rating (QuestionTypes.All's name for it). It is
///   validated against QuestionTypes.All, NOT ForSurvey: ForSurvey excludes emoji for
///   NEW surveys, but the design doc's fan-out row explicitly lands migrated emoji
///   questions in QuestionEmojiOption - refusing them here would orphan their answers.
/// </summary>
public static class SurveyMapper
{
    public const string Collection = "surveys";

    /// <summary>The embedded-question scope segment in MigrationIds.ForChild derivations.</summary>
    public const string QuestionScope = "questions";

    public static MappedSurvey? Map(LegacySurvey doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();

        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra),
            ("settings", doc.Settings?.Extra),
            ("settings.notification_settings", doc.Settings?.NotificationSettings?.Extra),
            ("settings.invitation_settings", doc.Settings?.InvitationSettings?.Extra));

        var title = MapperHelpers.Truncated(doc.Title, 200, Collection, legacyId, "title", report);
        if (title is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "survey has no title", "title");
            return null;
        }

        var type = MapperHelpers.Trimmed(doc.Type);
        if (type is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "survey has no type", "type");
            return null;
        }

        if (doc.StartDate is not { } startDate || doc.EndDate is not { } endDate)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "survey is missing start_date or end_date", doc.StartDate is null ? "start_date" : "end_date");
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
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; surveys cannot load without a company",
                "company_id");
            return null;
        }

        // created_by is a NOT NULL FK (Restrict): a survey whose creator was never
        // migrated - deleted legacy user, or one this run skipped - is a reported skip.
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

        if (MapStatus(doc.Status, legacyId, report) is not { } status)
        {
            return null;
        }

        var companyId = companyRef.TargetId!.Value;
        var language = context.LanguageOf(companyId);
        var english = language == "en";

        report.Attribution(Collection, legacyId, "title", language);
        var description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report);
        if (description is not null)
        {
            report.Attribution(Collection, legacyId, "description", language);
        }

        // template_id and the per-survey demographics configuration have no target
        // columns - templates re-instantiate rather than link back, and demographics
        // moved onto the user (#193). Real data, so named drops, not silence.
        if (MapperHelpers.Trimmed(doc.TemplateId) is not null)
        {
            report.Normalisation(MigrationRules.SurveyTemplateLinkDropped, Collection, legacyId, "template_id",
                "the target schema records no template provenance on a survey");
        }

        if (doc.DemographicFieldIds is { Count: > 0 } || doc.Demographics is { Count: > 0 })
        {
            report.Normalisation(MigrationRules.SurveyDemographicsConfigDropped, Collection, legacyId, "demographics",
                "per-survey demographic configuration has no target home; demographics ride on the user since #193");
        }

        var survey = new Survey
        {
            Id = MigrationIds.For(Collection, doc.Id),
            CompanyId = companyId,
            CreatedBy = creatorRef.TargetId!.Value,
            TitleEn = english ? title : null,
            TitleEs = english ? null : title,
            DescriptionEn = english ? description : null,
            DescriptionEs = english ? null : description,
            Language = language,
            Type = type,
            StartDate = new DateTimeOffset(DateTime.SpecifyKind(startDate, DateTimeKind.Utc)),
            EndDate = new DateTimeOffset(DateTime.SpecifyKind(endDate, DateTimeKind.Utc)),
            Status = status,
            ResponseCount = doc.ResponseCount ?? 0,
            TargetAudienceCount = doc.TargetAudienceCount,
            Version = doc.Version ?? 1,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        MapSettings(doc, survey, legacyId, language, report);

        var questions = MapQuestions(doc, legacyId, language, context);
        var targets = MapDepartmentTargets(doc, survey.Id, legacyId, context);

        return new MappedSurvey(
            survey, questions.Questions, questions.Options, questions.EmojiOptions,
            questions.ConditionalLogic, targets);
    }

    private static string? MapStatus(string? raw, string legacyId, DataQualityReport report)
    {
        var status = MapperHelpers.Trimmed(raw) ?? SurveyStatuses.Draft;
        switch (status)
        {
            case "completed":
                report.Normalisation(MigrationRules.SurveyStatusCompletedRemapped, Collection, legacyId, "status",
                    "legacy 'completed' is the target's 'closed': no longer accepting responses, results final");
                return SurveyStatuses.Closed;
            case "paused":
                // 'closed' rather than 'active' because a paused legacy survey accepted
                // nothing (canAcceptResponses required status === 'active'), and mapping
                // it to 'active' would silently reopen it inside its date window. The
                // target's path to run it again is duplication.
                report.Normalisation(MigrationRules.SurveyStatusPausedRemapped, Collection, legacyId, "status",
                    "the target has no 'paused'; 'closed' preserves that the survey was not accepting responses");
                return SurveyStatuses.Closed;
        }

        if (!SurveyStatuses.All.Contains(status, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.SurveyStatusUnknown, Collection, legacyId,
                $"status '{raw}' is not in the legacy or target vocabulary", "status");
            return null;
        }

        return status;
    }

    private static void MapSettings(
        LegacySurvey doc, Survey survey, string legacyId, string language, DataQualityReport report)
    {
        if (doc.Settings is not { } settings)
        {
            return;
        }

        var target = survey.Settings;
        if (settings.Anonymous is { } anonymous) target.Anonymous = anonymous;
        if (settings.AllowPartialResponses is { } partial) target.AllowPartialResponses = partial;
        if (settings.RandomizeQuestions is { } randomize) target.RandomizeQuestions = randomize;
        if (settings.ShowProgress is { } progress) target.ShowProgress = progress;
        if (settings.AutoSave is { } autoSave) target.AutoSave = autoSave;
        target.TimeLimitMinutes = settings.TimeLimitMinutes;
        target.ResponseLimit = settings.ResponseLimit;

        if (settings.NotificationSettings is { } notifications)
        {
            if (notifications.SendInvitations is { } invitations) target.NotificationSendInvitations = invitations;
            if (notifications.SendReminders is { } reminders) target.NotificationSendReminders = reminders;
            if (notifications.ReminderFrequencyDays is { } frequency) target.NotificationReminderFrequencyDays = frequency;
        }

        if (settings.InvitationSettings is { } invitation)
        {
            var english = language == "en";

            // Tier-1 content despite living in a settings blob: both are emailed to
            // respondents, so they attribute like title/description.
            var message = MapperHelpers.Truncated(invitation.CustomMessage, 1000,
                Collection, legacyId, "settings.invitation_settings.custom_message", report);
            if (message is not null)
            {
                report.Attribution(Collection, legacyId, "settings.invitation_settings.custom_message", language);
                target.InvitationCustomMessageEn = english ? message : null;
                target.InvitationCustomMessageEs = english ? null : message;
            }

            var subject = MapperHelpers.Truncated(invitation.CustomSubject, 200,
                Collection, legacyId, "settings.invitation_settings.custom_subject", report);
            if (subject is not null)
            {
                report.Attribution(Collection, legacyId, "settings.invitation_settings.custom_subject", language);
                target.InvitationCustomSubjectEn = english ? subject : null;
                target.InvitationCustomSubjectEs = english ? null : subject;
            }

            if (invitation.IncludeCredentials is { } credentials) target.InvitationIncludeCredentials = credentials;
            if (invitation.SendImmediately is { } immediately) target.InvitationSendImmediately = immediately;
            if (invitation.BrandingEnabled is { } branding) target.InvitationBrandingEnabled = branding;
        }
    }

    private sealed record QuestionFanOut(
        List<Question> Questions,
        List<QuestionOption> Options,
        List<QuestionEmojiOption> EmojiOptions,
        List<QuestionConditionalLogic> ConditionalLogic);

    private static QuestionFanOut MapQuestions(
        LegacySurvey doc, string legacyId, string language, MappingContext context)
    {
        var report = context.Report;
        var fanOut = new QuestionFanOut([], [], [], []);
        if (doc.Questions is not { Count: > 0 } questions)
        {
            return fanOut;
        }

        // Pass 1 keys every kept question so pass 2 (conditional logic) can resolve
        // forward references - a question may condition on one declared after it.
        var idsByLegacyId = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var kept = new List<(LegacySurveyQuestion Legacy, Question Question, string Field)>();

        for (var index = 0; index < questions.Count; index++)
        {
            var legacy = questions[index];
            var field = $"questions[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id,
                (field, legacy.Extra),
                ($"{field}.scale_labels", legacy.ScaleLabels?.Extra),
                ($"{field}.binary_comment_config", legacy.BinaryCommentConfig?.Extra),
                ($"{field}.conditional_logic", legacy.ConditionalLogic?.Extra));

            var questionKey = MapperHelpers.Trimmed(legacy.Id);
            if (questionKey is null)
            {
                report.Normalisation(MigrationRules.SurveyQuestionMissingId, Collection, legacyId, $"{field}.id",
                    "question has no id; answers reference questions by id, so it cannot be migrated");
                continue;
            }

            if (idsByLegacyId.ContainsKey(questionKey))
            {
                report.Normalisation(MigrationRules.SurveyQuestionDuplicateId, Collection, legacyId, $"{field}.id",
                    $"another question in this survey already carries id '{questionKey}'; first in array order wins");
                continue;
            }

            if (MapQuestionType(legacy.Type, legacyId, field, report) is not { } type)
            {
                continue;
            }

            var questionId = MigrationIds.ForChild(Collection, doc.Id, QuestionScope, questionKey);
            var english = language == "en";

            var text = MapperHelpers.Truncated(legacy.Text, 500, Collection, legacyId, $"{field}.text", report);
            if (text is not null)
            {
                // One attribution entry per question: text, scale labels, prompts and
                // option labels are one authored unit in one language.
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

            var question = new Question
            {
                Id = questionId,
                SurveyId = MigrationIds.For(Collection, doc.Id),
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

            idsByLegacyId[questionKey] = questionId;
            kept.Add((legacy, question, field));
            fanOut.Questions.Add(question);

            MapOptions(legacy, questionId, legacyId, field, language, report, fanOut.Options);
            MapEmojiOptions(legacy, questionId, legacyId, field, language, report, fanOut.EmojiOptions);
        }

        foreach (var (legacy, question, field) in kept)
        {
            if (MapConditionalLogic(legacy, question.Id, idsByLegacyId, legacyId, field, report) is { } logic)
            {
                fanOut.ConditionalLogic.Add(logic);
            }
        }

        return fanOut;
    }

    private static string? MapQuestionType(string? raw, string legacyId, string field, DataQualityReport report)
    {
        var type = MapperHelpers.Trimmed(raw);
        switch (type)
        {
            case "yes_no_comment":
                report.Normalisation(MigrationRules.QuestionTypeYesNoCommentRemapped, Collection, legacyId,
                    $"{field}.type", "yes_no_comment folds into yes_no; its comment shape lives in the comment columns");
                return QuestionTypes.YesNo;
            case "emoji_scale":
                report.Normalisation(MigrationRules.QuestionTypeEmojiScaleRemapped, Collection, legacyId,
                    $"{field}.type", "emoji_scale is the target's emoji_rating; the emoji set fans out beside it");
                return QuestionTypes.EmojiRating;
        }

        if (type is null || !QuestionTypes.All.Contains(type, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.QuestionTypeUnknown, Collection, legacyId, $"{field}.type",
                $"type '{raw}' is not in the target vocabulary; question not migrated");
            return null;
        }

        return type;
    }

    private static void MapOptions(
        LegacySurveyQuestion legacy, Guid questionId, string legacyId, string field,
        string language, DataQualityReport report, List<QuestionOption> sink)
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

            // question_options carries a unique (question, value) index: the value IS
            // the option's identity, and answers store it. The first occurrence wins,
            // matching ascending array order the way duplicate emails resolve.
            if (!seen.Add(value))
            {
                report.Normalisation(MigrationRules.QuestionOptionDuplicateValue, Collection, legacyId,
                    $"{field}.options[{index}]",
                    $"another option of this question already carries value '{value}'; the unique index would refuse it");
                continue;
            }

            sink.Add(new QuestionOption
            {
                QuestionId = questionId,
                Order = order++,
                Value = value,
                LabelEn = language == "en" ? value : null,
                LabelEs = language == "es" ? value : null,
            });
        }
    }

    private static void MapEmojiOptions(
        LegacySurveyQuestion legacy, Guid questionId, string legacyId, string field,
        string language, DataQualityReport report, List<QuestionEmojiOption> sink)
    {
        var order = 0;
        for (var index = 0; index < (legacy.EmojiOptions?.Count ?? 0); index++)
        {
            var option = legacy.EmojiOptions![index];
            var emoji = MapperHelpers.Trimmed(option.Emoji);

            // emoji and value are both required and neither has a usable fallback (the
            // column is 10 chars; truncating an emoji cluster yields mojibake, not an
            // emoji), so an invalid row is reported and not migrated.
            if (emoji is null || emoji.Length > 10 || option.Value is not { } value)
            {
                report.Normalisation(MigrationRules.QuestionEmojiOptionInvalid, Collection, legacyId,
                    $"{field}.emoji_options[{index}]",
                    "emoji option is missing its emoji or numeric value, or the emoji exceeds the column; not migrated");
                continue;
            }

            var label = MapperHelpers.Truncated(option.Label, 100,
                Collection, legacyId, $"{field}.emoji_options[{index}].label", report);
            sink.Add(new QuestionEmojiOption
            {
                QuestionId = questionId,
                Order = order++,
                Emoji = emoji,
                LabelEn = language == "en" ? label : null,
                LabelEs = language == "es" ? label : null,
                Value = value,
            });
        }
    }

    private static QuestionConditionalLogic? MapConditionalLogic(
        LegacySurveyQuestion legacy, Guid questionId, IReadOnlyDictionary<string, Guid> idsByLegacyId,
        string legacyId, string field, DataQualityReport report)
    {
        if (legacy.ConditionalLogic is not { } logic)
        {
            return null;
        }

        return new QuestionConditionalLogic
        {
            QuestionId = questionId,
            ConditionQuestionId = ResolveQuestionRef(
                logic.ConditionQuestionId, idsByLegacyId, legacyId, $"{field}.conditional_logic.condition_question_id", report),
            ConditionOperator = MapperHelpers.Trimmed(logic.ConditionOperator),
            ConditionValue = ConditionValueJson(logic.ConditionValue, legacyId, field, report),
            Action = MapperHelpers.Trimmed(logic.Action),
            TargetQuestionId = ResolveQuestionRef(
                logic.TargetQuestionId, idsByLegacyId, legacyId, $"{field}.conditional_logic.target_question_id", report),
        };
    }

    /// <summary>
    /// Question references are strings scoped to THIS survey's question ids, so there
    /// is no malformed case - any non-empty string is a legal key - only resolved or
    /// dangling (including references to a question this mapper dropped).
    /// </summary>
    private static Guid? ResolveQuestionRef(
        string? reference, IReadOnlyDictionary<string, Guid> idsByLegacyId,
        string legacyId, string field, DataQualityReport report)
    {
        var key = MapperHelpers.Trimmed(reference);
        if (key is null)
        {
            return null;
        }

        if (idsByLegacyId.TryGetValue(key, out var target))
        {
            return target;
        }

        report.Degraded(MigrationRules.DanglingReference, Collection, legacyId, field,
            $"'{key}' names no migrated question of this survey; loaded as NULL");
        return null;
    }

    /// <summary>condition_value is legacy Mixed (string | number); the column is jsonb.</summary>
    private static string? ConditionValueJson(
        BsonValue? value, string legacyId, string field, DataQualityReport report)
    {
        switch (value?.BsonType)
        {
            case null or BsonType.Null or BsonType.Undefined:
                return null;
            case BsonType.String:
                return JsonSerializer.Serialize(value.AsString);
            case BsonType.Int32:
                return value.AsInt32.ToString(CultureInfo.InvariantCulture);
            case BsonType.Int64:
                return value.AsInt64.ToString(CultureInfo.InvariantCulture);
            case BsonType.Double:
                return value.AsDouble.ToString(CultureInfo.InvariantCulture);
            case BsonType.Boolean:
                return value.AsBoolean ? "true" : "false";
            default:
                report.Normalisation(MigrationRules.QuestionConditionValueNotScalar, Collection, legacyId,
                    $"{field}.conditional_logic.condition_value",
                    $"value of type {value.BsonType} is not the schema's string-or-number; loaded as NULL");
                return null;
        }
    }

    private static List<SurveyDepartmentTarget> MapDepartmentTargets(
        LegacySurvey doc, Guid surveyId, string legacyId, MappingContext context)
    {
        var report = context.Report;
        var targets = new List<SurveyDepartmentTarget>();
        var seen = new HashSet<Guid>();
        foreach (var reference in doc.DepartmentIds ?? [])
        {
            var classification = ReferenceResolver.Classify(DepartmentMapper.Collection, reference, context.Departments);
            switch (classification.Kind)
            {
                case ReferenceKind.Resolved when seen.Add(classification.TargetId!.Value):
                    targets.Add(new SurveyDepartmentTarget
                    {
                        SurveyId = surveyId,
                        DepartmentId = classification.TargetId!.Value,
                    });
                    break;
                case ReferenceKind.Resolved:
                case ReferenceKind.Absent:
                    break; // a duplicate converges on one row; whitespace entries carry nothing
                default:
                    report.Degraded(
                        classification.Kind == ReferenceKind.Malformed
                            ? MigrationRules.MalformedReference
                            : MigrationRules.DanglingReference,
                        Collection, legacyId, "department_ids",
                        $"'{reference}' is {classification.Kind}; target row not created");
                    break;
            }
        }

        return targets;
    }
}
