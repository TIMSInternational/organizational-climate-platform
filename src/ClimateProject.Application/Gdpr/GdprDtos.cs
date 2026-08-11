namespace ClimateProject.Application.Gdpr;

/// <summary>
/// Whether a database that holds subject data was actually read while building a response.
/// </summary>
/// <param name="Name">The store, as an operator would name it.</param>
/// <param name="Included">
/// True only if this response contains that store's data. False makes the whole response
/// incomplete, and <see cref="SubjectAccessResponse.Complete"/> says so at the top level.
/// </param>
/// <param name="Detail">What was read, or precisely why it was not.</param>
public sealed record SubjectDataSource(string Name, bool Included, string Detail);

/// <summary>
/// The databases that hold data about a data subject, and this API's ability to reach each.
///
/// <para>Two stores exist. This repository's Postgres, which the API owns, and
/// <c>services/tracking-api</c>'s Postgres, which it does not: that service caches the
/// employee roster (<c>PersonaCache</c> — name and email) and keys its action plans,
/// progress log and notification recipients by persona external id. Nothing in
/// <c>ClimateProject.Api</c> can read it. There is no project reference, no HTTP client and
/// no connection string pointed at it, and the only integration between the two services runs
/// the other way — the tracking service pulls from <c>/api/internal</c> here, guarded by
/// <c>InternalApiKeyFilter</c>, and this service has no equivalent inbound surface to call.
/// </para>
///
/// <para>So a subject access response assembled here is <b>incomplete</b>, and it says so
/// rather than presenting a partial export as a finished one. Closing the gap needs a
/// GDPR subject endpoint on the tracking service plus an outbound client and a shared key
/// here; it is not something this API can do by reading harder.</para>
/// </summary>
public static class SubjectDataSources
{
    public const string PrimaryDatabaseName = "organizational-climate-platform (this API's Postgres)";
    public const string TrackingDatabaseName = "services/tracking-api (climate-tracking Postgres)";

    /// <summary>
    /// Why the tracking store is absent. A constant so that the endpoint, the compliance
    /// report and the tests all state the same reason, and so that whoever implements the
    /// cross-service read has one place to delete.
    /// </summary>
    public const string TrackingUnavailableDetail =
        "NOT INCLUDED. The climate-tracking service keeps its own Postgres (persona cache, action plans, "
        + "progress log, notification recipients) and this API cannot read it: no project reference, no client "
        + "and no connection string exist, and the only link between the services runs the other way. This "
        + "response is therefore incomplete. A data subject request must be completed by hand against that "
        + "service until an internal GDPR endpoint is added there.";

    /// <param name="detail">
    /// What was read, in the caller's own terms. Each caller supplies its own count rather than
    /// sharing one phrase, because "tables exported", "tables acted on" and "tables described"
    /// are three different numbers and one sentence covering all three would be true of none.
    /// </param>
    public static SubjectDataSource Primary(string detail) => new(PrimaryDatabaseName, true, detail);

    public static SubjectDataSource TrackingUnavailable()
        => new(TrackingDatabaseName, false, TrackingUnavailableDetail);
}

/// <summary>One classified table's contribution to a subject access export.</summary>
/// <param name="Entity">EF entity name, matching <see cref="SubjectDataEntry.Entity"/>.</param>
/// <param name="Records">
/// One dictionary per row. Every record carries <c>_link</c>, naming which of the entity's
/// declared link properties matched it. Beyond that, a full record carries the entity's mapped
/// property names and a reference record carries <c>id</c> and <c>label</c>.
/// </param>
public sealed record SubjectAccessSection(
    string Entity,
    string Table,
    SubjectLink Link,
    ExportTreatment Treatment,
    string LawfulBasis,
    string Retention,
    int RecordCount,
    IReadOnlyList<IReadOnlyDictionary<string, object?>> Records);

/// <summary>Who the export is about.</summary>
public sealed record SubjectIdentity(Guid? UserId, string? Email, string? Name);

/// <summary>
/// A subject access response (GDPR Art. 15).
/// </summary>
/// <param name="Complete">
/// False when any entry in <paramref name="Sources"/> was not read. Callers must not treat an
/// incomplete response as a discharged obligation.
/// </param>
public sealed record SubjectAccessResponse(
    SubjectIdentity Subject,
    DateTimeOffset GeneratedAt,
    bool Complete,
    IReadOnlyList<SubjectDataSource> Sources,
    IReadOnlyList<string> Limitations,
    IReadOnlyList<SubjectAccessSection> Sections);

/// <summary>What erasure did to one classified table.</summary>
public sealed record ErasureAction(
    string Entity,
    string Table,
    ErasureTreatment Treatment,
    int RowsAffected,
    string Reason);

/// <summary>
/// An erasure response (GDPR Art. 17).
/// </summary>
/// <param name="Complete">
/// False when a store holding subject data was not reached — same meaning as on
/// <see cref="SubjectAccessResponse"/>.
/// </param>
public sealed record ErasureResponse(
    SubjectIdentity Subject,
    DateTimeOffset ErasedAt,
    bool Complete,
    IReadOnlyList<SubjectDataSource> Sources,
    IReadOnlyList<string> Limitations,
    IReadOnlyList<ErasureAction> Actions);

/// <summary>One table's line in the compliance report.</summary>
public sealed record ComplianceReportEntry(
    string Entity,
    string Table,
    SubjectLink Link,
    string LawfulBasis,
    string Retention,
    ErasureTreatment OnErasure,
    string Rationale,
    long RowCount);

/// <summary>
/// A record-of-processing style report: what is held, on what basis, for how long, and what
/// erasure does to it. Company-scoped row counts where the table is company-scoped.
/// </summary>
public sealed record ComplianceReportResponse(
    Guid? CompanyId,
    DateTimeOffset GeneratedAt,
    bool Complete,
    IReadOnlyList<SubjectDataSource> Sources,
    int TablesHoldingSubjectData,
    int TablesWithNoSubjectData,
    IReadOnlyList<ComplianceReportEntry> Entries);

/// <summary>What one retention sweep deleted, per category.</summary>
public sealed record RetentionCleanupCategory(string Category, string Predicate, int Deleted, bool MoreRemaining);

/// <summary>The result of a retention cleanup run.</summary>
public sealed record RetentionCleanupResult(
    DateTimeOffset RanAt,
    int TotalDeleted,
    IReadOnlyList<RetentionCleanupCategory> Categories);

/// <summary>Body of <c>POST /gdpr/erasure</c>.</summary>
/// <param name="UserId">The data subject's user id.</param>
/// <param name="Confirm">
/// Must be true. Erasure is irreversible and unrecoverable through the API, so the caller has
/// to say so in the body rather than by having typed a URL.
/// </param>
public sealed record ErasureRequest(Guid UserId, bool Confirm);
