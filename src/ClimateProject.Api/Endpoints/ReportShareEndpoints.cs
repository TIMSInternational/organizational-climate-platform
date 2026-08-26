using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The API half of #139: minting a report share link, and resolving one without a session.
///
/// ## The one rule the resolve path exists to keep
///
/// <c>GET /shared/reports/{token}</c> is the highest-exposure endpoint in the product -- it
/// serves a company's climate data to anybody holding a URL. Its acceptance criterion is that
/// <b>expired, revoked and invalid tokens are indistinguishable to the caller</b>, because a
/// caller who can tell "this token was real once" from "this token was never real" can
/// enumerate. So there is exactly one failure in <see cref="ResolveAsync"/>:
/// <see cref="NotAvailable"/>, built by one method, returned by every rejecting branch, with a
/// fixed body and fixed headers. There is no code path that can answer 410, or 403, or a
/// different sentence -- see the remarks on that method.
///
/// The client half is already shipped and holds the same line from the other side:
/// <c>web/src/features/reports/api/sharedReports.ts</c> collapses every failure into a
/// <c>SharedReportUnavailableError</c> that carries no fields at all.
///
/// ## Why this is a separate file from ReportEndpoints
///
/// <c>ReportEndpoints</c> maps one group, <c>/admin/reports</c>, and every route in it is
/// authorized. This file maps into that group <em>and</em> maps a route that is deliberately
/// outside every authorization boundary in the application. Keeping the anonymous route in a
/// file whose name says so means nobody adds a fifth admin route next to it by muscle memory.
/// </summary>
public static class ReportShareEndpoints
{
    /// <summary>The fixed body of every rejected resolve. Says nothing about why.</summary>
    private const string UnavailableMessage = "Report not available";

    /// <summary>
    /// <c>audit_logs.resource</c> for a share-link read. Matches what
    /// <c>AuditPolicy.DeriveResource</c> would derive from <c>/shared/reports/{token}</c>, so a
    /// hand-written row and a middleware-written one file under the same name.
    /// </summary>
    private const string SharedReadResource = "shared.reports";

    public static void MapReportShareEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/admin/reports").RequireAuthorization();

        // POST, so AuditWritingMiddleware audits it with no marker: minting a public link to a
        // company's climate data is exactly the kind of act #143 exists to have a record of.
        admin.MapPost("/{id:guid}/share", CreateAsync);

        // Metadata only -- ids, counts and dates, never a token. Not marked as a sensitive read
        // for the same reason the report list is not: it discloses that links exist, not what
        // any of them opens.
        admin.MapGet("/{id:guid}/shares", ListAsync);

        // DELETE, so likewise audited by method.
        admin.MapDelete("/{id:guid}/shares/{shareId:guid}", RevokeAsync);

        // Outside every group in this file, and mapped on `app` rather than on an authorized
        // group so that "unauthenticated" is a property of how it is registered rather than of
        // an AllowAnonymous() that a later edit could drop while the route kept working for the
        // signed-in developer testing it.
        //
        // Not marked [AuditSensitiveRead]: the middleware refuses to write for a caller it
        // cannot place in a tenant (audit_logs.company_id is NOT NULL behind a RESTRICT foreign
        // key), and a marker that produces a warning instead of a row would be a coverage claim
        // this endpoint does not honour. It writes its own row instead -- see ResolveAsync,
        // which knows the tenant because it just loaded the report.
        app.MapGet("/shared/reports/{token}", ResolveAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    /// <summary>
    /// Resolves the acting administrator to a user row, or null.
    /// </summary>
    /// <remarks>
    /// Null rather than <c>Guid.Empty</c>: <c>report_shares.created_by</c> is nullable behind
    /// SetNull precisely so an unresolvable caller costs an attribution rather than a 500. See
    /// <c>ReportShare.CreatedBy</c>.
    /// </remarks>
    private static Task<Guid?> ResolveActorAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);

    private static async Task<IResult> CreateAsync(
        Guid id,
        CreateReportShareRequest? request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        var now = DateTimeOffset.UtcNow;
        var lifetimeDays = ReportShareTokens.ClampLifetimeDays(request?.ExpiresInDays);
        var token = ReportShareTokens.NewToken();

        var share = new ReportShare
        {
            Id = Guid.NewGuid(),
            ReportId = report.Id,
            TokenHash = ReportShareTokens.Hash(token),
            CreatedBy = await ResolveActorAsync(currentUser, db, cancellationToken),
            CreatedAt = now,
            ExpiresAt = now.AddDays(lifetimeDays),
        };

        db.ReportShares.Add(share);
        await db.SaveChangesAsync(cancellationToken);

        // The token is returned here and nowhere else, ever again. Nothing logs it.
        return Results.Json(
            new CreateReportShareResponse(share.Id, token, $"/shared/reports/{token}", share.ExpiresAt),
            statusCode: 201);
    }

    private static async Task<IResult> ListAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        var now = DateTimeOffset.UtcNow;
        var shares = await db.ReportShares
            .Where(s => s.ReportId == id)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new ReportShareSummary(
                s.Id,
                s.CreatedAt,
                s.ExpiresAt,
                s.RevokedAt,
                s.AccessCount,
                s.LastAccessedAt,
                s.RevokedAt == null && s.ExpiresAt > now))
            .ToListAsync(cancellationToken);

        return Results.Ok(shares);
    }

    private static async Task<IResult> RevokeAsync(
        Guid id,
        Guid shareId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (report is null) return Results.Json(new { message = "Report not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, report.CompanyId)) return Results.Forbid();

        // Scoped to the report in the path as well as to the id, so a share id guessed from
        // another company's report cannot be revoked through a report this caller can reach.
        var share = await db.ReportShares
            .FirstOrDefaultAsync(s => s.Id == shareId && s.ReportId == id, cancellationToken);
        if (share is null) return Results.Json(new { message = "Share link not found" }, statusCode: 404);

        // Idempotent: revoking an already-revoked link is a success, not a 409. The caller's
        // intent -- "this link must not resolve" -- is satisfied either way, and a retried
        // request after a dropped response is the common case, not an error.
        if (share.RevokedAt is null)
        {
            share.RevokedAt = DateTimeOffset.UtcNow;
            share.RevokedBy = await ResolveActorAsync(currentUser, db, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    /// <summary>
    /// Resolves a share token into the report it opens, for a caller with no session (#139).
    /// </summary>
    /// <param name="lang">
    /// Accepted because the shipped client sends it, and ignored on purpose: the document was
    /// localized once by <c>ReportGeneration</c>, in each survey's own language, and there is
    /// nothing left here to resolve. Declared rather than silently dropped so that a reader
    /// asking "does this honour ?lang" gets an answer instead of a grep.
    /// </param>
    private static async Task<IResult> ResolveAsync(
        string token,
        string? lang,
        HttpContext http,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        _ = lang;
        var logger = loggerFactory.CreateLogger(typeof(ReportShareEndpoints));

        // Hash and query unconditionally -- no length check, no charset check, no early return
        // for an obviously-wrong token. A short-circuit would make a malformed token measurably
        // faster than a real-but-dead one, which is the same disclosure as a different status
        // code, only harder to notice. Every request does one SHA-256 and one unique-index probe.
        var tokenHash = ReportShareTokens.Hash(token);

        var match = await db.ReportShares
            .Where(s => s.TokenHash == tokenHash)
            .Join(db.Reports, s => s.ReportId, r => r.Id, (s, r) => new { Share = s, Report = r })
            .FirstOrDefaultAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;

        // The four ways this can fail, collapsed into one answer. They are written out
        // separately rather than as one boolean so that the reason survives for the reader --
        // and then every one of them returns the identical response.
        if (match is null)
        {
            // No such token: never minted, or minted for a report that has since been deleted
            // (the row cascades away with it).
            return NotAvailable(http, logger, "no share matches the token");
        }

        if (match.Share.RevokedAt is not null)
        {
            return NotAvailable(http, logger, "share is revoked");
        }

        if (match.Share.ExpiresAt <= now)
        {
            return NotAvailable(http, logger, "share is expired");
        }

        if (match.Report.ExpiresAt is { } reportExpiry && reportExpiry <= now)
        {
            // The report itself has an expiry independent of any link. A link cannot outlive
            // the thing it points at.
            return NotAvailable(http, logger, "report is expired");
        }

        if (!string.Equals(match.Report.Status, "completed", StringComparison.Ordinal))
        {
            // Generating, or failed. Publishing a half-built document to an unauthenticated
            // audience is worse than publishing nothing, and "not available yet" and "not
            // available at all" have to look the same anyway.
            return NotAvailable(http, logger, "report is not completed");
        }

        // Past here the link is good, and this is the only branch that touches the database or
        // reveals anything at all.
        match.Share.AccessCount += 1;
        match.Share.LastAccessedAt = now;

        // AC5. The row is written here rather than by AuditWritingMiddleware because the
        // middleware has no tenant for an anonymous caller; this handler does, because it just
        // loaded the report. user_id is null -- that is the honest record of who read it: a
        // link holder, not an account.
        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = null,
            CompanyId = match.Report.CompanyId,
            Action = $"{SharedReadResource}.{AuditVerbs.Read}",
            Resource = SharedReadResource,
            ResourceId = AuditPolicy.Truncate(match.Report.Id.ToString(), AuditPolicy.MaxResourceIdLength),
            // The share id, so "who opened the link we revoked in March" is answerable. Never
            // the token: an audit trail that stores working credentials is a second copy of the
            // secret, kept forever, readable by everyone who can read the trail.
            Details = JsonSerializer.Serialize(new SharedReadDetails(match.Share.Id, match.Share.AccessCount)),
            IpAddress = AuditPolicy.TruncateOptional(
                http.Connection.RemoteIpAddress?.ToString(),
                AuditPolicy.MaxIpAddressLength),
            UserAgent = AuditPolicy.TruncateOptional(
                http.Request.Headers.UserAgent.ToString(),
                AuditPolicy.MaxUserAgentLength),
            Success = true,
            Timestamp = now,
        });

        await db.SaveChangesAsync(cancellationToken);

        ApplyPublicHeaders(http);
        return Results.Ok(new SharedReportResponse(
            match.Report.Title,
            match.Report.Description,
            match.Report.Type,
            match.Report.GenerationCompletedAt,
            match.Report.ReportOutput));
    }

    /// <summary>
    /// The one and only rejection a share-link holder can receive.
    /// </summary>
    /// <remarks>
    /// Everything a caller can observe is fixed here: the status code (404 -- never 410, which
    /// literally means "this existed and is gone"), the body, and the headers. <paramref
    /// name="reason"/> goes to the server log and nowhere near the response.
    ///
    /// It is a method rather than four <c>Results.Json</c> calls so that the promise is
    /// structural. A future edit that wants to distinguish a revoked link has to change this
    /// method, which changes every case at once and cannot be done by accident in one branch.
    ///
    /// No audit row: <c>audit_logs.company_id</c> is NOT NULL behind a RESTRICT foreign key, and
    /// a token that resolves to nothing resolves to no tenant either. A failed probe is
    /// therefore recorded in the application log only. This is a real gap and it is written down
    /// rather than papered over -- closing it needs a nullable company_id, which is the same
    /// outstanding migration <c>AuditCoverageTests.UnattributableMutatingRoutes</c> already
    /// names.
    /// </remarks>
    private static IResult NotAvailable(HttpContext http, ILogger logger, string reason)
    {
        // Structured, at Information, and with no token or hash in it -- the log line records
        // that a probe happened and why it failed, not what was probed with.
        logger.LogInformation("Shared report link not resolved: {Reason}", reason);

        ApplyPublicHeaders(http);
        return Results.Json(new { message = UnavailableMessage }, statusCode: 404);
    }

    /// <summary>
    /// Headers applied identically to the success and the failure of a resolve.
    /// </summary>
    /// <remarks>
    /// Identically is the point -- a header present on one outcome and absent on the other is a
    /// one-bit oracle, which is the whole thing this endpoint is trying not to be.
    ///
    /// <c>X-Robots-Tag: noindex</c> is the API's half of the issue's fourth criterion. The page
    /// carries its own <c>noindex</c> meta tag, but a crawler that reaches this JSON directly --
    /// from a link pasted into a page it indexes -- never renders the SPA and never sees that
    /// tag. The header is the only instruction such a crawler gets.
    ///
    /// <c>Cache-Control: no-store</c> because everything here is a private document behind a
    /// bearer-in-the-URL, and the response must not survive in a CDN, a corporate proxy or a
    /// browser's back-forward cache after the link is revoked.
    /// </remarks>
    private static void ApplyPublicHeaders(HttpContext http)
    {
        http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
        http.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        http.Response.Headers.Pragma = "no-cache";
    }

    /// <summary>The <c>audit_logs.details</c> payload for a share-link read.</summary>
    private sealed record SharedReadDetails(Guid ShareId, int AccessCount);
}
