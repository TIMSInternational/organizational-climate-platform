namespace ClimateProject.Domain.Entities;

/// <summary>
/// One share link minted for a report (#139) -- the row behind
/// <c>GET /shared/reports/{token}</c>.
///
/// ## Why this is a table and not three columns on <c>reports</c>
///
/// The issue's second acceptance criterion is that <b>expired</b>, <b>revoked</b> and
/// <b>invalid</b> tokens are indistinguishable to the caller. Two of those three are states a
/// link is in, so they have to exist somewhere before they can be flattened: a single
/// <c>reports.share_token</c> column can only ever model "there is a link" and "there is not",
/// and revoking would be a delete, which makes a revoked link and a never-minted one the same
/// row -- convenient for the response, useless for the audit trail that has to answer "who
/// opened the link we revoked in March".
///
/// A row per link also means a report can be shared with two audiences and one of them cut
/// off, and that <see cref="AccessCount"/> attributes reads to the link they came through
/// rather than to the report in aggregate.
/// </summary>
public class ReportShare
{
    public Guid Id { get; set; }

    /// <summary>The report this link opens. Cascade-deleted with it -- see the configuration.</summary>
    public Guid ReportId { get; set; }

    /// <summary>
    /// SHA-256 of the token, lower-case hex. <b>The token itself is never stored.</b>
    /// </summary>
    /// <remarks>
    /// The token in the URL is the entire credential for an unauthenticated page serving a
    /// company's climate data, which makes this column equivalent to a password column, and it
    /// is treated as one. A database backup, a leaked read replica or a stray <c>SELECT *</c>
    /// in a log yields hashes, not working links.
    ///
    /// Plain SHA-256 rather than a password KDF on purpose: the input is 256 bits of
    /// <c>RandomNumberGenerator</c> output, not a human-chosen secret, so there is no
    /// dictionary to run and the work factor a KDF buys would be paid on every page load for
    /// nothing. This is the same reasoning applied to API keys, not to passwords.
    /// </remarks>
    public required string TokenHash { get; set; }

    /// <summary>
    /// The administrator who minted the link, when the application can resolve them to a user
    /// row; null when it cannot.
    /// </summary>
    /// <remarks>
    /// Nullable, unlike <c>reports.created_by</c>, and deliberately.
    /// <c>ActingUserResolver.ResolveIdAsync</c> answers <c>Guid?</c> -- <b>null</b>, never
    /// <c>Guid.Empty</c> -- for a caller it cannot place. What the callers do with that null is
    /// where the two columns part: <c>reports.created_by</c> is a required FK, so
    /// <c>ReportEndpoints.ResolveCurrentUserIdAsync</c> coerces the null to <c>Guid.Empty</c>
    /// and the insert then fails on a foreign key to a user row that does not exist -- a 500,
    /// which its own comment records as pre-existing behaviour left alone by #285. This column
    /// is nullable, so the same caller costs an attribution instead. Failing to hand an
    /// administrator their link because the application could not name them is the worse
    /// outcome of the two, and the null is not the only record of who did it -- the mint is a
    /// POST, so <c>AuditWritingMiddleware</c> has already written a row naming the caller.
    /// </remarks>
    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// When the link stops resolving. Always set -- a share link with no expiry is a permanent
    /// unauthenticated hole in the tenant boundary, so the mint endpoint defaults it rather
    /// than allowing null.
    /// </summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>When the link was revoked, or null. A revoked link never resolves again.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Who revoked it, when resolvable. See <see cref="CreatedBy"/> for why nullable.</summary>
    public Guid? RevokedBy { get; set; }

    /// <summary>How many times this link has been successfully resolved.</summary>
    public int AccessCount { get; set; }

    /// <summary>The last successful resolve, or null if it has never been opened.</summary>
    public DateTimeOffset? LastAccessedAt { get; set; }
}
