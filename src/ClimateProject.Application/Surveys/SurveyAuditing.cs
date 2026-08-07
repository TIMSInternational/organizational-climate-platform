using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The vocabulary of <c>survey_audit_logs.action</c>, for the survey domain only.
///
/// <b>Scope boundary, for #143.</b> This is deliberately NOT a general audit framework.
/// It writes to <c>survey_audit_logs</c>, a table whose <c>survey_id</c> is NOT NULL with
/// a foreign key to <c>surveys</c> -- so by construction it can only ever describe events
/// that belong to one survey, and it is mapped from the <c>/surveys</c> endpoints and
/// nowhere else. The general table is the separate <c>audit_logs</c> entity, which this
/// lane does not touch.
///
/// #143 should build the cross-domain mechanism on <c>audit_logs</c> and treat this as one
/// of its emitters, not wrap or replace it: a survey's history is a product surface a
/// company admin reads (<c>GET /surveys/{id}/history</c>), whereas a global audit log is a
/// compliance surface. The shapes that would need reconciling if #143 wants one writer are
/// small and named: <see cref="SurveyAuditActions"/>, <see cref="SurveyAuditEntityTypes"/>
/// and <see cref="SurveyAuditChangeSet"/>.
/// </summary>
public static class SurveyAuditActions
{
    /// <summary>A survey was created, by <c>POST /surveys</c> or as the copy from <c>POST /surveys/{id}/duplicate</c>.</summary>
    public const string Created = "created";

    /// <summary>Content or schedule was rewritten by <c>PUT /surveys/{id}</c>. Carries the changed field paths.</summary>
    public const string Updated = "updated";

    /// <summary>A lifecycle transition. Carries <c>from</c> and <c>to</c>.</summary>
    public const string StatusChanged = "status_changed";

    /// <summary>This survey was the SOURCE of a duplicate. Carries the copy's id as the entity id.</summary>
    public const string Duplicated = "duplicated";

    /// <summary>A content snapshot was written to <c>survey_versions</c>. Carries the version number.</summary>
    public const string VersionCreated = "version_created";

    public static readonly string[] All = [Created, Updated, StatusChanged, Duplicated, VersionCreated];

    /// <summary>
    /// Deletion is absent, and not by oversight. <c>survey_audit_logs.survey_id</c> cascades
    /// from <c>surveys</c>, so a "deleted" row would be deleted by the same statement that
    /// deleted the survey -- and a survey with responses cannot be deleted at all, only
    /// archived, which does produce a <see cref="StatusChanged"/> row. Recording deletions
    /// durably needs the tenant-scoped <c>audit_logs</c> table, which is #143's.
    /// </summary>
    public static bool IsRecorded(string? action) => action is not null && All.Contains(action, StringComparer.Ordinal);
}

/// <summary>What a survey audit entry is about. Maps to <c>survey_audit_logs.entity_type</c> (max 20 chars).</summary>
public static class SurveyAuditEntityTypes
{
    public const string Survey = "survey";
    public const string Status = "status";
    public const string Version = "version";

    public static readonly string[] All = [Survey, Status, Version];
}

/// <summary>
/// The <c>changes</c> jsonb of a survey audit entry, typed in both directions rather than
/// handed around as a raw <c>JsonElement</c>.
///
/// Every member is optional and omitted when null, so one shape serves an update (field
/// paths), a status change (from/to) and a version snapshot (number) without three
/// columns or three readers.
/// </summary>
public sealed record SurveyAuditChangeSet(
    IReadOnlyList<string>? Fields = null,
    string? From = null,
    string? To = null,
    int? VersionNumber = null)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public string ToJson() => JsonSerializer.Serialize(this, Json);

    /// <summary>
    /// Null, empty or unparseable JSON reads back as <c>null</c> rather than throwing. The
    /// history endpoint must be able to render an entry whose payload predates a shape
    /// change; the actor and timestamp on the row are still true.
    /// </summary>
    public static SurveyAuditChangeSet? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<SurveyAuditChangeSet>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
