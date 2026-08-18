using System.Text.Json;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;
using MongoDB.Bson.IO;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>
/// A survey's content snapshot. The three Mixed snapshots land in the target's jsonb
/// columns verbatim - they are a historical record of what the survey WAS, so
/// re-mapping them through the current question rules would rewrite history to match
/// today's schema and quietly destroy the only evidence of what respondents actually
/// saw. Title and description DO attribute (#195), taking the language from the survey
/// they snapshot rather than re-deriving it from the company.
/// </summary>
public static class SurveyVersionMapper
{
    public const string Collection = "surveyversions";

    public static SurveyVersion? Map(LegacySurveyVersion doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SurveyId, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{doc.SurveyId}' is {surveyRef.Kind}; a version cannot outlive its survey",
                "survey_id");
            return null;
        }

        // created_by is a NOT NULL Restrict FK, exactly like Survey.CreatedBy.
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

        if (doc.VersionNumber is not { } versionNumber)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "version has no version_number; (survey, number) is the unique key", "version_number");
            return null;
        }

        var surveyId = surveyRef.TargetId!.Value;
        var language = context.SurveyLanguages.TryGetValue(surveyId, out var surveyLanguage) && surveyLanguage == "es"
            ? "es"
            : "en";
        var english = language == "en";

        var title = MapperHelpers.Truncated(doc.Title, 200, Collection, legacyId, "title", report);
        if (title is not null)
        {
            report.Attribution(Collection, legacyId, "title", language);
        }

        var description = MapperHelpers.Truncated(doc.Description, 1000, Collection, legacyId, "description", report);
        if (description is not null)
        {
            report.Attribution(Collection, legacyId, "description", language);
        }

        // reason is NOT NULL in the target and required in the legacy schema, but Mixed
        // history predates that guarantee; a marked placeholder beats losing the row,
        // because the version's SNAPSHOT is the irreplaceable part, not its note.
        var reason = MapperHelpers.Truncated(doc.Reason, 500, Collection, legacyId, "reason", report);
        if (reason is null)
        {
            reason = "(no reason recorded in the legacy system)";
            report.Normalisation(MigrationRules.AuditActorFieldFabricated, Collection, legacyId, "reason",
                "version carries no reason; the target column is NOT NULL, so a marked placeholder is used");
        }

        return new SurveyVersion
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyId,
            VersionNumber = versionNumber,
            TitleEn = english ? title : null,
            TitleEs = english ? null : title,
            DescriptionEn = english ? description : null,
            DescriptionEs = english ? null : description,
            Changes = (doc.Changes ?? [])
                .Select(MapperHelpers.Trimmed)
                .Where(change => change is not null)
                .Select(change => change!)
                .ToArray(),
            Reason = reason,
            CreatedBy = creatorRef.TargetId!.Value,
            QuestionsSnapshot = LegacyJson.Serialize(doc.Questions),
            DemographicsSnapshot = LegacyJson.Serialize(doc.Demographics),
            SettingsSnapshot = LegacyJson.Serialize(doc.Settings),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
        };
    }
}

/// <summary>
/// The survey history feed. Two vocabularies shrank between the systems and this
/// mapper is where that is reconciled, out loud:
///
/// legacy <c>action</c> has FOURTEEN members, the target's SurveyAuditActions five;
/// legacy <c>entity_type</c> has nine, the target's three. Each remap is a named rule.
/// The three legacy actions with no target meaning - <c>deleted</c>, <c>draft_saved</c>,
/// <c>draft_recovered</c> - are reported skips, not raw strings written into the
/// column: SurveyAuditActions is a validated vocabulary the history endpoint reads, and
/// a member it does not know renders as nothing, which is the survey-status trap in a
/// different table. (Deletion's absence is deliberate and documented in
/// SurveyAuditActions itself; drafts are a different lane entirely, and #143's
/// cross-domain audit_logs table is where those rows belong if the client wants them.)
///
/// Nothing is destroyed by the narrowing: the original action, entity type and the raw
/// legacy before/after/diff are preserved in the target's metadata jsonb, so a
/// migrated row can always be read back as what it was.
/// </summary>
public static class SurveyAuditLogMapper
{
    public const string Collection = "surveyauditlogs";

    /// <summary>Legacy action -> target action. Absent means unrepresentable.</summary>
    private static readonly Dictionary<string, string> ActionRemap = new(StringComparer.Ordinal)
    {
        ["created"] = SurveyAuditActions.Created,
        ["updated"] = SurveyAuditActions.Updated,

        // Lifecycle transitions: the target folds all three into one action that
        // carries from/to, which is exactly what these legacy rows describe.
        ["published"] = SurveyAuditActions.StatusChanged,
        ["cancelled"] = SurveyAuditActions.StatusChanged,
        ["completed"] = SurveyAuditActions.StatusChanged,

        // Field-level edits: the target records one 'updated' whose changes carry the
        // changed field paths - so the legacy entity_type becomes that path.
        ["question_added"] = SurveyAuditActions.Updated,
        ["question_removed"] = SurveyAuditActions.Updated,
        ["question_modified"] = SurveyAuditActions.Updated,
        ["audience_updated"] = SurveyAuditActions.Updated,
        ["schedule_changed"] = SurveyAuditActions.Updated,
        ["settings_modified"] = SurveyAuditActions.Updated,
    };

    /// <summary>The status each lifecycle action moved the survey TO, for the changes payload.</summary>
    private static readonly Dictionary<string, string> StatusTransition = new(StringComparer.Ordinal)
    {
        ["published"] = SurveyStatuses.Active,
        ["cancelled"] = SurveyStatuses.Archived,
        ["completed"] = SurveyStatuses.Closed,
    };

    public static SurveyAuditLog? Map(LegacySurveyAuditLog doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra), ("changes", doc.Changes?.Extra), ("metadata", doc.Metadata?.Extra));

        // The ObjectId-or-string normalisation this collection alone needs.
        var surveyHex = LegacyReferences.HexOf(doc.SurveyId);
        if (surveyHex is null && doc.SurveyId is not null && doc.SurveyId.BsonType != BsonType.Null)
        {
            report.Skip(MigrationRules.AuditReferenceNotAnIdentifier, Collection, legacyId,
                $"survey_id is a {doc.SurveyId.BsonType}, neither an ObjectId nor a string", "survey_id");
            return null;
        }

        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, surveyHex, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{surveyHex}' is {surveyRef.Kind}; the column is a non-nullable FK to surveys",
                "survey_id");
            return null;
        }

        var userHex = LegacyReferences.HexOf(doc.UserId);
        if (userHex is null && doc.UserId is not null && doc.UserId.BsonType != BsonType.Null)
        {
            report.Skip(MigrationRules.AuditReferenceNotAnIdentifier, Collection, legacyId,
                $"user_id is a {doc.UserId.BsonType}, neither an ObjectId nor a string", "user_id");
            return null;
        }

        var userRef = ReferenceResolver.Classify(UserMapper.Collection, userHex, context.Users);
        if (userRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                userRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"user_id '{userHex}' is {userRef.Kind}; user_id is a non-nullable Restrict FK",
                "user_id");
            return null;
        }

        var legacyAction = MapperHelpers.Trimmed(doc.Action);
        if (legacyAction is null || !ActionRemap.TryGetValue(legacyAction, out var action))
        {
            report.Skip(MigrationRules.AuditActionUnrepresentable, Collection, legacyId,
                $"action '{doc.Action}' has no member in the target vocabulary "
                + $"({string.Join(", ", SurveyAuditActions.All)}); writing it would produce history the product cannot render "
                + "(a cross-domain audit_logs row under #143 is where it belongs)",
                "action");
            return null;
        }

        if (action != legacyAction)
        {
            report.Normalisation(MigrationRules.AuditActionRemapped, Collection, legacyId, "action",
                $"legacy action '{legacyAction}' recorded as '{action}'");
        }

        var legacyEntityType = MapperHelpers.Trimmed(doc.EntityType);
        var entityType = MapEntityType(legacyEntityType, action);
        if (legacyEntityType is not null && entityType != legacyEntityType)
        {
            report.Normalisation(MigrationRules.AuditEntityTypeRemapped, Collection, legacyId, "entity_type",
                $"legacy entity_type '{legacyEntityType}' recorded as '{entityType}'");
        }

        // The actor columns are all NOT NULL, and an audit row whose actor is unnamed is
        // still evidence that something happened - so each missing field is marked
        // rather than costing the row.
        var userName = Fabricated(doc.UserName, 200, "user_name", "(unnamed in the legacy record)", legacyId, report);
        var userEmail = Fabricated(doc.UserEmail, 255, "user_email", "unknown@legacy.invalid", legacyId, report);
        var userRole = Fabricated(doc.UserRole, 32, "user_role", "unknown", legacyId, report);

        return new SurveyAuditLog
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyRef.TargetId!.Value,
            Action = action,
            EntityType = entityType,
            EntityId = MapperHelpers.Truncated(doc.EntityId, 100, Collection, legacyId, "entity_id", report),
            Changes = TranslateChanges(legacyAction, legacyEntityType),
            UserId = userRef.TargetId!.Value,
            UserName = userName,
            UserEmail = userEmail,
            UserRole = userRole,
            Timestamp = MapperHelpers.Timestamp(doc.Timestamp, doc.Id, Collection, "timestamp", report),
            IpAddress = MapperHelpers.Truncated(doc.IpAddress, 64, Collection, legacyId, "ip_address", report),
            UserAgent = MapperHelpers.Truncated(doc.UserAgent, 500, Collection, legacyId, "user_agent", report),
            SessionId = MapperHelpers.Truncated(doc.SessionId, 200, Collection, legacyId, "session_id", report),
            Metadata = BuildMetadata(doc, legacyAction, legacyEntityType),
        };
    }

    private static string MapEntityType(string? legacyEntityType, string action)
    {
        // The target's three: survey, status, version. A lifecycle row is about status;
        // 'draft' cannot reach here (its actions are unrepresentable); everything else
        // legacy distinguished - title, description, questions, audience, schedule,
        // distribution - is a part of the survey, and the part it was survives as the
        // changed field path in the changes payload.
        if (action == SurveyAuditActions.StatusChanged)
        {
            return SurveyAuditEntityTypes.Status;
        }

        return legacyEntityType is not null
               && SurveyAuditEntityTypes.All.Contains(legacyEntityType, StringComparer.Ordinal)
            ? legacyEntityType
            : SurveyAuditEntityTypes.Survey;
    }

    /// <summary>
    /// The target's changes column is a typed SurveyAuditChangeSet, not legacy's
    /// before/after/diff - so this builds the target's shape from what the legacy row
    /// actually knows, and the raw legacy payload is preserved under metadata.
    /// </summary>
    private static string? TranslateChanges(string legacyAction, string? legacyEntityType)
    {
        if (StatusTransition.TryGetValue(legacyAction, out var to))
        {
            return new SurveyAuditChangeSet(To: to).ToJson();
        }

        // A field-level edit: the legacy entity_type IS the changed field path, which is
        // exactly what the target's Fields carries.
        var field = legacyAction switch
        {
            "question_added" or "question_removed" or "question_modified" => "questions",
            "audience_updated" => "audience",
            "schedule_changed" => "schedule",
            "settings_modified" => "settings",
            _ => legacyEntityType is not null and not "survey" ? legacyEntityType : null,
        };

        return field is null ? null : new SurveyAuditChangeSet(Fields: [field]).ToJson();
    }

    private static string? BuildMetadata(
        LegacySurveyAuditLog doc, string legacyAction, string? legacyEntityType)
    {
        // Everything the narrowing would otherwise cost, kept: the original vocabulary
        // values and the raw before/after/diff. A migrated row can be read back as
        // exactly what the legacy system recorded.
        var payload = new Dictionary<string, object?>
        {
            ["legacy_action"] = legacyAction,
        };

        if (legacyEntityType is not null) payload["legacy_entity_type"] = legacyEntityType;
        if (doc.Metadata?.Reason is { } reason) payload["reason"] = reason;
        if (doc.Metadata?.Automated is { } automated) payload["automated"] = automated;
        if (doc.Metadata?.ApiVersion is { } apiVersion) payload["api_version"] = apiVersion;

        var legacyChanges = new Dictionary<string, object?>();
        if (LegacyJson.Serialize(doc.Changes?.Before) is { } before) legacyChanges["before"] = JsonDocument.Parse(before).RootElement;
        if (LegacyJson.Serialize(doc.Changes?.After) is { } after) legacyChanges["after"] = JsonDocument.Parse(after).RootElement;
        if (LegacyJson.Serialize(doc.Changes?.Diff) is { } diff) legacyChanges["diff"] = JsonDocument.Parse(diff).RootElement;
        if (legacyChanges.Count > 0) payload["legacy_changes"] = legacyChanges;

        return JsonSerializer.Serialize(payload);
    }

    private static string Fabricated(
        string? raw, int max, string field, string placeholder, string legacyId, DataQualityReport report)
    {
        var value = MapperHelpers.Truncated(raw, max, Collection, legacyId, field, report);
        if (value is not null)
        {
            return value;
        }

        report.Normalisation(MigrationRules.AuditActorFieldFabricated, Collection, legacyId, field,
            $"the legacy row carries no {field} but the column is NOT NULL; recorded as '{placeholder}'");
        return placeholder;
    }
}

/// <summary>
/// BSON -> JSON for the jsonb snapshot columns. Relaxed extended JSON, because it is
/// the mode that renders dates and numbers as ordinary JSON while still round-tripping
/// the types Mongo has and JSON does not (an ObjectId stays <c>{"$oid": …}</c> rather
/// than becoming an anonymous string). A snapshot is evidence; losing its types to make
/// it prettier would be the wrong trade.
/// </summary>
internal static class LegacyJson
{
    private static readonly JsonWriterSettings Settings = new() { OutputMode = JsonOutputMode.RelaxedExtendedJson };

    public static string? Serialize(BsonValue? value)
    {
        if (value is null || value.BsonType is BsonType.Null or BsonType.Undefined)
        {
            return null;
        }

        // A bare scalar is legal jsonb, but every caller here snapshots a document or
        // an array; wrapping keeps the column's shape predictable for readers.
        return value.BsonType switch
        {
            BsonType.Document => value.AsBsonDocument.ToJson(Settings),
            BsonType.Array => value.AsBsonArray.ToJson(Settings),
            _ => new BsonDocument("value", value).ToJson(Settings),
        };
    }
}
