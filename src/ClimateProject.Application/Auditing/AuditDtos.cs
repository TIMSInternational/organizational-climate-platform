namespace ClimateProject.Application.Auditing;

/// <summary>The names <see cref="AuditLogItem.Source"/> can take.</summary>
/// <remarks>
/// There are two audit tables and #143 asks for one query surface over them rather than two
/// trails. <c>audit_logs</c> is the tenant-wide trail every audited request writes;
/// <c>survey_audit_logs</c> is the narrower per-survey change history behind
/// <c>GET /surveys/{id}/history</c> (#106), which carries a field-level diff the general table
/// has no column for. The entity trail merges them and this field says which row came from
/// which, so a reader can tell a request-level record from a content-level one.
/// </remarks>
public static class AuditSources
{
    public const string General = "audit_logs";
    public const string Survey = "survey_audit_logs";
}

/// <summary>One entry in the audit trail, from either table.</summary>
/// <param name="UserName">The actor's current name, or null if the account is gone.</param>
/// <param name="Success">
/// Always true for a <see cref="AuditSources.Survey"/> row: <c>survey_audit_logs</c> is
/// written inside the handler's own unit of work and so only ever records what committed,
/// where <c>audit_logs</c> records the attempt and its outcome.
/// </param>
public sealed record AuditLogItem(
    Guid Id,
    string Source,
    Guid? UserId,
    string? UserName,
    string? UserEmail,
    string Action,
    string Resource,
    string? ResourceId,
    bool Success,
    string? ErrorMessage,
    string? IpAddress,
    DateTimeOffset Timestamp);

/// <param name="Total">Matching rows before paging, so a client can size a pager.</param>
public sealed record AuditLogPage(
    IReadOnlyList<AuditLogItem> Items,
    int Total,
    int Page,
    int PageSize);

public sealed record AuditActionCount(string Action, int Count);

public sealed record AuditActorCount(Guid? UserId, string? UserName, int Count);

/// <summary>The aggregate behind legacy <c>api/audit/report</c>.</summary>
public sealed record AuditReportResponse(
    DateTimeOffset From,
    DateTimeOffset To,
    int Total,
    int Failures,
    IReadOnlyList<AuditActionCount> TopActions,
    IReadOnlyList<AuditActorCount> TopActors);
