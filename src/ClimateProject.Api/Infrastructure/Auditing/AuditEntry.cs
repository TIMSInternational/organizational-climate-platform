namespace ClimateProject.Api.Infrastructure.Auditing;

/// <summary>
/// The row <see cref="AuditWritingMiddleware"/> is going to write for this request, exposed to
/// the handler so it can fill in what only the handler knows (#143).
///
/// ## This is enrichment, never enrolment
///
/// A handler that never touches this object is still audited -- the middleware derives the
/// action, resource and actor from the request itself. Nothing here can stop a row from being
/// written, and there is deliberately no <c>Suppress()</c>: opting out is
/// <see cref="AuditExemptAttribute"/>, which is route metadata and is enumerated by a test.
///
/// What a handler can add is what the HTTP layer cannot see:
/// <list type="bullet">
/// <item><description>the id of a row it just created, which is in the response body and not
/// in the route (<see cref="SetResourceId"/>);</description></item>
/// <item><description>a domain action name more precise than <c>{resource}.{verb}</c> --
/// <c>profile.password_change</c> rather than <c>profile.password.update</c>
/// (<see cref="Describe"/>);</description></item>
/// <item><description>the acting user it has already resolved, sparing the middleware a
/// second lookup (<see cref="AttributeTo"/>);</description></item>
/// <item><description>what a field was before the request and what it is after
/// (<see cref="RecordChange"/>) -- the "before/after where meaningful" the issue asks for,
/// which the HTTP layer cannot see at all.</description></item>
/// </list>
///
/// Registered scoped, so it is one instance per request and the middleware and the handler are
/// looking at the same object.
/// </summary>
public sealed class AuditEntry
{
    /// <summary>Overrides the derived <c>audit_logs.action</c>. Null means "use the derived one".</summary>
    public string? Action { get; private set; }

    /// <summary>Overrides the derived <c>audit_logs.resource</c>. Null means "use the derived one".</summary>
    public string? Resource { get; private set; }

    /// <summary>The row this request acted on, if the handler knows it.</summary>
    public string? ResourceId { get; private set; }

    /// <summary>The acting user, if the handler already resolved one.</summary>
    public Guid? ActorUserId { get; private set; }

    /// <summary>The tenant to file this row under, if the handler already resolved one.</summary>
    public Guid? CompanyId { get; private set; }

    private readonly Dictionary<string, AuditFieldChange> _changes = new(StringComparer.Ordinal);

    /// <summary>
    /// The before/after values the handler recorded, keyed by field name. Empty unless it
    /// called <see cref="RecordChange"/>.
    /// </summary>
    public IReadOnlyDictionary<string, AuditFieldChange> Changes => _changes;

    /// <summary>
    /// What one field was before this request and what it is after.
    /// </summary>
    /// <remarks>
    /// #143 asks the trail to record "before/after where meaningful". The middleware cannot
    /// produce that on its own -- it sees an HTTP request, not a change tracker -- so the
    /// handler, which is holding both values, hands them over here and the writer serialises
    /// them into <c>audit_logs.details</c> alongside the method, path and status.
    ///
    /// Two rules, both deliberate:
    ///
    /// <list type="bullet">
    /// <item><description>**Only what changed.** A pair of identical values is dropped, so a
    /// PUT that rewrites a row with its own contents records no diff rather than a wall of
    /// unchanged fields.</description></item>
    /// <item><description>**Never a secret and never free text.** <c>audit_logs</c> is a
    /// long-retention table every CompanyAdmin in the tenant can read, and
    /// <c>docs/decisions/audit-logging.md</c> commits to keeping request bodies out of it.
    /// Passwords, tokens, invitation codes and survey answer content must not be passed here;
    /// a field name and a status ("set", "cleared") is the right shape when the value itself
    /// is sensitive.</description></item>
    /// </list>
    ///
    /// Last call for a field wins, so a handler that assigns twice records the final state.
    /// Surveys have a richer facility of their own -- <c>SurveyAuditTrail</c> writes a
    /// field-level diff and a version number to <c>survey_audit_logs</c>, which
    /// <c>audit_logs</c> has no column for.
    /// </remarks>
    public void RecordChange(string field, string? before, string? after)
    {
        if (string.IsNullOrWhiteSpace(field) || string.Equals(before, after, StringComparison.Ordinal))
        {
            return;
        }

        _changes[field] = new AuditFieldChange(
            AuditPolicy.TruncateOptional(before, MaxChangeValueLength),
            AuditPolicy.TruncateOptional(after, MaxChangeValueLength));
    }

    /// <summary>
    /// How much of one value is kept.
    /// </summary>
    /// <remarks>
    /// <c>details</c> is jsonb with no width limit, which is exactly why there is a limit
    /// here: an unbounded before/after would let a 500 KB description field be copied into a
    /// table that is never deleted. Long enough for the names, statuses and identifiers this
    /// is meant for.
    /// </remarks>
    public const int MaxChangeValueLength = 200;

    /// <summary>
    /// Names the domain action this request performed, and optionally the resource and row.
    /// </summary>
    /// <remarks>
    /// Used where a route's shape does not carry the meaning: <c>PUT /profile/password</c>
    /// derives <c>profile.password.update</c>, but the vocabulary <c>GET /profile/activity</c>
    /// reads back and that <c>ProfileAuditActions</c> defines is <c>profile.password_change</c>.
    /// Last call wins, so a handler with several outcomes can name the one it took.
    /// </remarks>
    public void Describe(string action, string? resource = null, string? resourceId = null)
    {
        Action = AuditPolicy.TruncateOptional(action, AuditPolicy.MaxActionLength);

        if (resource is not null)
        {
            Resource = AuditPolicy.TruncateOptional(resource, AuditPolicy.MaxResourceLength);
        }

        if (resourceId is not null)
        {
            SetResourceId(resourceId);
        }
    }

    /// <summary>The row this request acted on -- typically one it created, whose id is not in the route.</summary>
    public void SetResourceId(string? resourceId)
        => ResourceId = AuditPolicy.TruncateOptional(resourceId, AuditPolicy.MaxResourceIdLength);

    /// <inheritdoc cref="SetResourceId(string?)"/>
    public void SetResourceId(Guid resourceId) => SetResourceId(resourceId.ToString());

    /// <summary>
    /// The acting user and the tenant the row belongs to.
    /// </summary>
    /// <remarks>
    /// <c>audit_logs.company_id</c> is NOT NULL behind a RESTRICT foreign key, so the company
    /// is not optional: a row that cannot name one cannot be inserted at all. Both are taken
    /// together for that reason -- there is no useful state where the actor is known and the
    /// company is not.
    /// </remarks>
    public void AttributeTo(Guid actorUserId, Guid companyId)
    {
        ActorUserId = actorUserId;
        CompanyId = companyId;
    }
}

/// <summary>One field's value before and after a request, as it appears in <c>details</c>.</summary>
/// <param name="Before">The value the field held when the request arrived. Null means it had none.</param>
/// <param name="After">The value it holds now. Null means it was cleared.</param>
public sealed record AuditFieldChange(string? Before, string? After);
