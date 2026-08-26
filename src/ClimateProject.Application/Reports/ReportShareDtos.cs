namespace ClimateProject.Application.Reports;

/// <summary>Body of <c>POST /admin/reports/{id}/share</c>. Every field optional.</summary>
/// <param name="ExpiresInDays">
/// How long the link should live. Null takes <c>ReportShareTokens.DefaultLifetimeDays</c>;
/// out-of-range values are clamped rather than rejected, because the caller is an administrator
/// picking a duration, not an attacker probing a parser.
/// </param>
public record CreateReportShareRequest(int? ExpiresInDays);

/// <summary>
/// The response to a mint -- <b>the only time the token is ever readable</b>.
/// </summary>
/// <remarks>
/// <c>report_shares</c> stores a SHA-256 hash, so this value cannot be recovered afterwards
/// from the database or from <see cref="ReportShareSummary"/>. That is the point: a link
/// nobody can re-read is a link that cannot leak twice.
/// </remarks>
/// <param name="Id">The share row, for revoking it later.</param>
/// <param name="Token">The share token. Belongs in a URL, not in a log.</param>
/// <param name="Path">
/// The path the token opens, ready to be appended to the web origin:
/// <c>/shared/reports/{token}</c>. Built here rather than in the browser so the API and the
/// route in <c>router.tsx</c> cannot drift; the origin is not, because the API does not know
/// which of its front ends is asking.
/// </param>
public record CreateReportShareResponse(Guid Id, string Token, string Path, DateTimeOffset ExpiresAt);

/// <summary>
/// A minted link as the administrator surface lists it. <b>Carries no token and no hash.</b>
/// </summary>
/// <remarks>
/// Listing links is how an administrator gets an id to revoke, and how they see that a link
/// they forgot about is still live and has been opened 400 times. It is not a way to recover a
/// link they lost -- that is a new mint and a new revoke, which is the safer motion anyway.
/// </remarks>
/// <param name="IsActive">Whether this link resolves right now: not revoked, not expired.</param>
public record ReportShareSummary(
    Guid Id,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RevokedAt,
    int AccessCount,
    DateTimeOffset? LastAccessedAt,
    bool IsActive);

/// <summary>
/// What <c>GET /shared/reports/{token}</c> returns to an unauthenticated holder.
/// </summary>
/// <remarks>
/// A deliberately small projection of <c>ReportDetail</c>, and the omissions are the payload's
/// security half: no <c>id</c>, no <c>companyId</c>, no <c>createdBy</c>, no <c>status</c>, no
/// <c>downloadCount</c>. The holder is being shown a document, not the record that produced it
/// -- and <c>companyId</c> and <c>createdBy</c> are precisely the two identifiers that would
/// let a holder join this document to another tenant surface.
///
/// Matches, field for field, the <c>SharedReportWire</c> that
/// <c>web/src/features/reports/api/sharedReports.ts</c> already parses.
/// </remarks>
/// <param name="ReportOutput">
/// <c>reports.report_output</c> verbatim. The anonymity floor and the suppression flags were
/// decided by <c>ReportGeneration</c> when the document was built and are carried through
/// untouched -- nothing is recomputed here, so a public link cannot disagree with the
/// authenticated view of the same report.
/// </param>
public record SharedReportResponse(
    string Title,
    string? Description,
    string Type,
    DateTimeOffset? GeneratedAt,
    string? ReportOutput);
