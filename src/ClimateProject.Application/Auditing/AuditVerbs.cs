namespace ClimateProject.Application.Auditing;

/// <summary>
/// The verb half of an <c>audit_logs.action</c> value (#143).
///
/// An action is written as <c>{resource}.{verb}</c> -- <c>surveys.create</c>,
/// <c>admin.benchmarks.update</c>, <c>audit.export</c>. The resource half is derived from the
/// route pattern rather than declared per endpoint, so the only vocabulary that needs
/// agreeing on is this one.
///
/// Constants rather than inline literals, so a query filter and the writer cannot drift --
/// the same reason <c>NotificationTypes</c> and <c>Roles</c> are constants.
/// </summary>
public static class AuditVerbs
{
    /// <summary>POST.</summary>
    public const string Create = "create";

    /// <summary>PUT and PATCH. One verb for both: the distinction is in <c>details.method</c>.</summary>
    public const string Update = "update";

    /// <summary>DELETE.</summary>
    public const string Delete = "delete";

    /// <summary>
    /// A read that is worth recording on its own -- a report view, a results page. Reads are
    /// audited only where an endpoint asks for it; see <c>AuditSensitiveReadAttribute</c>.
    /// </summary>
    public const string Read = "read";

    /// <summary>A read that hands the caller a copy of the data to keep.</summary>
    public const string Export = "export";
}
