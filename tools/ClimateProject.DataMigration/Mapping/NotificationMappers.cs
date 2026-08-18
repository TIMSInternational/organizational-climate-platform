using ClimateProject.Application.Notifications;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped notification template and its two fan-outs.</summary>
public sealed record MappedNotificationTemplate(
    NotificationTemplate Template,
    IReadOnlyList<NotificationTemplateVariable> Variables,
    IReadOnlyList<NotificationPersonalizationRule> Rules);

/// <summary>
/// The templates a bilingual workforce's emails are rendered from. Four content fields
/// attribute under #195 (subject, title, content, html_content), and they are Tier 1
/// by the entity's own comment: these are the emails people actually receive.
///
/// The load-bearing rule here is #73's: <b>every personalization-rule condition must
/// pass NotificationConditionParser.TryParse or the rule is not migrated.</b> That
/// parser is what the notification runtime evaluates; a condition it cannot read is a
/// rule that would silently never fire - or, worse, be read as "no condition" and fire
/// always. Rejecting it loudly and naming the rule is the only honest option, and the
/// original text rides along in the report so nothing is lost to whoever rewrites it.
/// </summary>
public static class NotificationTemplateMapper
{
    public const string Collection = "notificationtemplates";
    public const string VariableScope = "variables";
    public const string RuleScope = "personalization_rules";

    private static readonly string[] Channels = ["email", "in_app", "push", "sms"];
    private static readonly string[] VariableTypes = ["string", "number", "date", "boolean", "object"];

    public static MappedNotificationTemplate? Map(LegacyNotificationTemplate doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var name = MapperHelpers.Truncated(doc.Name, 200, Collection, legacyId, "name", report);
        var type = MapperHelpers.Truncated(doc.Type, 32, Collection, legacyId, "type", report);
        if (name is null || type is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "template is missing its name or type, both NOT NULL", name is null ? "name" : "type");
            return null;
        }

        var channel = MapperHelpers.Trimmed(doc.Channel);
        if (channel is null || !Channels.Contains(channel, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.NotificationChannelUnknown, Collection, legacyId,
                $"channel '{doc.Channel}' is not one of {string.Join(", ", Channels)}; the channel decides "
                + "which delivery path renders the template",
                "channel");
            return null;
        }

        // created_by is NOT NULL: a template with no author cannot be attributed.
        var creatorRef = ReferenceResolver.Classify(
            UserMapper.Collection, LegacyReferences.HexOf(doc.CreatedBy), context.Users);
        if (creatorRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                creatorRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "created_by does not resolve; the column is a non-nullable FK", "created_by");
            return null;
        }

        // Same tenant-leak rule as every other template collection: NULL company means
        // globally visible, so absent is a legitimate platform default and
        // unresolvable is a skip.
        Guid? companyId = null;
        var companyRef = ReferenceResolver.Classify(
            CompanyMapper.Collection, LegacyReferences.HexOf(doc.CompanyId), context.Companies);
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
                    "company_id does not resolve; NULL would make a private template globally visible",
                    "company_id");
                return null;
        }

        var language = companyId is { } company ? context.LanguageOf(company) : "en";
        var english = language == "en";

        string? Attributed(string? raw, int max, string field)
        {
            var value = MapperHelpers.Truncated(raw, max, Collection, legacyId, field, report);
            if (value is not null)
            {
                report.Attribution(Collection, legacyId, field, language);
            }

            return value;
        }

        var subject = Attributed(doc.Subject, 500, "subject");
        var title = Attributed(doc.Title, 500, "title");
        var content = Attributed(doc.Content, int.MaxValue, "content");
        var htmlContent = Attributed(doc.HtmlContent, int.MaxValue, "html_content");

        var template = new NotificationTemplate
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            Type = type,
            Channel = channel,
            SubjectEn = english ? subject : null,
            SubjectEs = english ? null : subject,
            TitleEn = english ? title : null,
            TitleEs = english ? null : title,
            ContentEn = english ? content : null,
            ContentEs = english ? null : content,
            HtmlContentEn = english ? htmlContent : null,
            HtmlContentEs = english ? null : htmlContent,
            CompanyId = companyId,
            IsActive = doc.IsActive ?? true,
            IsDefault = doc.IsDefault ?? false,
            CreatedBy = creatorRef.TargetId!.Value,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        return new MappedNotificationTemplate(
            template,
            MapVariables(doc, template.Id, legacyId, report),
            MapRules(doc, template.Id, legacyId, report));
    }

    private static List<NotificationTemplateVariable> MapVariables(
        LegacyNotificationTemplate doc, Guid templateId, string legacyId, DataQualityReport report)
    {
        var variables = new List<NotificationTemplateVariable>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < (doc.Variables?.Count ?? 0); index++)
        {
            var legacy = doc.Variables![index];
            var field = $"variables[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var name = MapperHelpers.Truncated(legacy.Name, 100, Collection, legacyId, $"{field}.name", report);
            if (name is null)
            {
                report.Normalisation(MigrationRules.NotificationVariableInvalid, Collection, legacyId, field,
                    "variable has no name, and a template placeholder without one substitutes nothing; not migrated");
                continue;
            }

            if (!seen.Add(name))
            {
                report.Normalisation(MigrationRules.NotificationVariableInvalid, Collection, legacyId, field,
                    $"another variable of this template is already called '{name}'; not migrated");
                continue;
            }

            var type = MapperHelpers.Trimmed(legacy.Type) ?? "string";
            if (!VariableTypes.Contains(type, StringComparer.Ordinal))
            {
                report.Normalisation(MigrationRules.NotificationVariableInvalid, Collection, legacyId,
                    $"{field}.type", $"type '{legacy.Type}' is unknown; recorded as 'string'");
                type = "string";
            }

            variables.Add(new NotificationTemplateVariable
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, VariableScope, name),
                NotificationTemplateId = templateId,
                Name = name,
                Type = type,
                Required = legacy.Required ?? false,

                // description is NOT NULL and is author-facing help text; an empty one
                // costs nothing that a placeholder does not also cost.
                Description = MapperHelpers.Truncated(
                    legacy.Description, 500, Collection, legacyId, $"{field}.description", report) ?? string.Empty,
                DefaultValue = legacy.DefaultValue is { } value && value.BsonType != MongoDB.Bson.BsonType.Null
                    ? LegacyJson.Serialize(value)
                    : null,
            });
        }

        return variables;
    }

    /// <summary>
    /// #73's gate. A condition the runtime's parser cannot read is a rule that would
    /// never fire correctly, so it is refused by name with its text in the report
    /// rather than loaded as a rule nobody can evaluate.
    /// </summary>
    private static List<NotificationPersonalizationRule> MapRules(
        LegacyNotificationTemplate doc, Guid templateId, string legacyId, DataQualityReport report)
    {
        var rules = new List<NotificationPersonalizationRule>();
        for (var index = 0; index < (doc.PersonalizationRules?.Count ?? 0); index++)
        {
            var legacy = doc.PersonalizationRules![index];
            var field = $"personalization_rules[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var condition = MapperHelpers.Trimmed(legacy.Condition);
            if (condition is null || !NotificationConditionParser.TryParse(condition, out _))
            {
                report.Normalisation(MigrationRules.NotificationConditionUnparseable, Collection, legacyId,
                    $"{field}.condition",
                    $"'{legacy.Condition}' does not parse as a notification condition (#73's grammar: "
                    + "field <op> literal); the runtime could not evaluate it, so the rule is not migrated");
                continue;
            }

            rules.Add(new NotificationPersonalizationRule
            {
                // Positional: legacy rules carry no id, and nothing references them.
                Id = MigrationIds.ForChild(Collection, doc.Id, RuleScope, $"#{index}"),
                NotificationTemplateId = templateId,
                Condition = condition,
                Modifications = LegacyJson.Serialize(legacy.Modifications),
            });
        }

        return rules;
    }
}

/// <summary>
/// Delivered and pending notifications. The one judgement call: a notification whose
/// TEMPLATE no longer resolves still carries its own rendered title and message, so it
/// degrades to a null template_id rather than being skipped - the record of what was
/// actually sent to a person does not depend on the template that produced it.
/// </summary>
public static class NotificationMapper
{
    public const string Collection = "notifications";

    private static readonly string[] Channels = ["email", "in_app", "push", "sms"];
    private static readonly string[] Priorities = ["low", "medium", "high", "critical"];
    private static readonly string[] Statuses = ["pending", "sent", "delivered", "opened", "failed", "cancelled"];

    public static Notification? Map(LegacyNotification doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra), ("metadata", doc.Metadata?.Extra));

        var userRef = ReferenceResolver.Classify(
            UserMapper.Collection, LegacyReferences.HexOf(doc.UserId), context.Users);
        if (userRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                userRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                "user_id does not resolve; a notification with no recipient has nobody to show it to",
                "user_id");
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

        var type = MapperHelpers.Truncated(doc.Type, 32, Collection, legacyId, "type", report);
        var title = MapperHelpers.Truncated(doc.Title, 500, Collection, legacyId, "title", report);
        var message = MapperHelpers.Trimmed(doc.Message);
        if (type is null || title is null || message is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "notification is missing its type, title or message, all NOT NULL",
                type is null ? "type" : title is null ? "title" : "message");
            return null;
        }

        var channel = MapperHelpers.Trimmed(doc.Channel);
        if (channel is null || !Channels.Contains(channel, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.NotificationChannelUnknown, Collection, legacyId,
                $"channel '{doc.Channel}' is not one of {string.Join(", ", Channels)}", "channel");
            return null;
        }

        // A notification's template is provenance, not content: the rendered title and
        // message are already on the row, so an unresolvable template degrades.
        Guid? templateId = null;
        var templateRef = ReferenceResolver.Classify(
            NotificationTemplateMapper.Collection, LegacyReferences.HexOf(doc.TemplateId), context.NotificationTemplates);
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
                    "template_id does not resolve; loaded as NULL - the rendered title and message "
                    + "are on the row itself, so the record of what was sent survives");
                break;
        }

        var notification = new Notification
        {
            Id = MigrationIds.For(Collection, doc.Id),
            UserId = userRef.TargetId!.Value,
            CompanyId = companyRef.TargetId!.Value,
            Type = type,
            Channel = channel,
            Priority = Vocabulary(doc.Priority, Priorities, "medium", "priority", legacyId, report),
            Status = Vocabulary(doc.Status, Statuses, "pending", "status", legacyId, report),
            Title = title,
            Message = message,
            Data = LegacyJson.Serialize(doc.Data),
            TemplateId = templateId,
            ScheduledFor = doc.ScheduledFor is { } scheduled
                ? new DateTimeOffset(DateTime.SpecifyKind(scheduled, DateTimeKind.Utc))
                : MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "scheduled_for", report),
            SentAt = Utc(doc.SentAt),
            DeliveredAt = Utc(doc.DeliveredAt),
            OpenedAt = Utc(doc.OpenedAt),
            FailedAt = Utc(doc.FailedAt),
            FailureReason = MapperHelpers.Truncated(
                doc.FailureReason, 1000, Collection, legacyId, "failure_reason", report),
            RetryCount = doc.RetryCount ?? 0,
            MaxRetries = doc.MaxRetries ?? 3,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.Metadata is { } metadata)
        {
            notification.Metadata.UserAgent = MapperHelpers.Truncated(
                metadata.UserAgent, 500, Collection, legacyId, "metadata.user_agent", report);
            notification.Metadata.IpAddress = MapperHelpers.Truncated(
                metadata.IpAddress, 64, Collection, legacyId, "metadata.ip_address", report);
            notification.Metadata.EmailClient = MapperHelpers.Truncated(
                metadata.EmailClient, 200, Collection, legacyId, "metadata.email_client", report);
            notification.Metadata.DeviceType = MapperHelpers.Truncated(
                metadata.DeviceType, 100, Collection, legacyId, "metadata.device_type", report);
        }

        return notification;
    }

    /// <summary>
    /// Both vocabularies are identical on the two sides, so an out-of-set value means
    /// a document written outside the model. It falls back to the column's own default
    /// by name rather than costing the notification.
    /// </summary>
    private static string Vocabulary(
        string? raw, string[] allowed, string fallback, string field, string legacyId, DataQualityReport report)
    {
        var value = MapperHelpers.Trimmed(raw);
        if (value is null)
        {
            return fallback;
        }

        if (allowed.Contains(value, StringComparer.Ordinal))
        {
            return value;
        }

        report.Normalisation(MigrationRules.NotificationVocabularyUnknown, Collection, legacyId, field,
            $"'{value}' is not one of {string.Join(", ", allowed)}; recorded as '{fallback}'");
        return fallback;
    }

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}
