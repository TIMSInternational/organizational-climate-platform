using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Gdpr;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Data-subject rights (#144). Replaces the legacy <c>api/gdpr/access</c>,
/// <c>api/gdpr/erasure</c>, <c>api/gdpr/compliance-report</c> and
/// <c>api/gdpr/retention-cleanup</c> routes, which had no equivalent in this stack.
///
/// <para>The product holds employees' opinions about their employer, so these are live
/// obligations rather than a checklist. The reasoning behind every treatment is in
/// <c>docs/compliance/gdpr-subject-rights.md</c>; <see cref="SubjectDataMap"/> is the
/// machine-readable half of the same document.</para>
///
/// <para><b>Authorisation, and why each route sits where it does.</b> No
/// <c>[Authorize(Roles=)]</c> anywhere — this repo authorises inside the handler against
/// <c>principal.GetCurrentUser()</c> and an explicit <c>Can…</c> helper.</para>
/// <list type="bullet">
/// <item><description><b>Access</b> — the subject themselves, or an administrator of the
/// tenant they belong to. Self-service is the case #137 builds a page for.</description></item>
/// <item><description><b>Erasure</b> — administrators only, never self-service, and it takes
/// an explicit confirmation in the body. Erasure here is irreversible and there is no undo
/// through this API; a person asking to be erased should be making a request that a
/// controller acts on, not firing an unrecoverable statement from a browser.</description></item>
/// <item><description><b>Compliance report</b> — administrators. A company admin sees their
/// own tenant's volumes; a super admin may ask about any tenant, or about none.</description></item>
/// <item><description><b>Retention cleanup</b> — super admins only. It sweeps every tenant at
/// once, which is not something one company's administrator should be able to trigger. It is
/// the same cross-tenant reasoning <c>DELETE /surveys/drafts/expired</c> already uses.
/// </description></item>
/// </list>
///
/// <para><b>Every action attempts an audit row</b>, including the ones that only read: a
/// subject access export is a bulk disclosure of one person's data and the fact that it
/// happened is itself the thing an investigation needs. The rows are written to
/// <c>audit_logs</c> through the same shape <c>ProfileEndpoints</c> uses, attributed to the
/// <i>caller</i>, with the subject in <c>resource_id</c>. "Attempts" rather than "writes" is
/// deliberate, and the exception is exact rather than "super admins are not audited":
/// <c>audit_logs.company_id</c> is NOT NULL, so a row exists only where the caller has a
/// company <i>or</i> the action names one. A global super admin (#191) has neither on
/// <c>POST /gdpr/retention-cleanup</c>, which sweeps every tenant, nor on
/// <c>GET /gdpr/compliance-report</c> asked about no tenant in particular. Those two run
/// unaudited, and <see cref="AuditAsync"/> logs a warning when they do. Every other
/// combination is filed against the tenant that was acted on — including the two that a
/// company-less super admin can use to disclose or destroy one person's data, which are the
/// ones that had to be closed. #143 is landing an audit-logging convention in parallel; when
/// it does, these four writes should move onto it rather than keep their own copy.</para>
///
/// <para><b>Authority is a tenant, and it is passed down rather than assumed.</b> Both the
/// exporter and the eraser match some rows on the subject's email address, which is not unique
/// across tenants; <see cref="AuthorityScope"/> turns the caller into the one company they may
/// act in (or "all of them", for a super admin) and every such lookup takes it. Without it a
/// company admin's export of their own employee returns another tenant's invitation to the
/// same address, and an erasure rewrites it.</para>
/// </summary>
public static class GdprEndpoints
{
    /// <summary>The <c>audit_logs.resource</c> value every action here is filed under.</summary>
    public const string AuditResource = "gdpr";

    /// <summary>Audit action for a subject access export.</summary>
    public const string AccessAction = "gdpr.access";

    /// <summary>Audit action for an erasure.</summary>
    public const string ErasureAction = "gdpr.erasure";

    /// <summary>Audit action for a compliance report.</summary>
    public const string ComplianceReportAction = "gdpr.compliance_report";

    /// <summary>Audit action for a retention sweep.</summary>
    public const string RetentionCleanupAction = "gdpr.retention_cleanup";

    public static void MapGdprEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/gdpr").RequireAuthorization();

        group.MapGet("/access", AccessAsync);
        group.MapPost("/erasure", EraseAsync);
        group.MapGet("/compliance-report", ComplianceReportAsync);
        group.MapPost("/retention-cleanup", RetentionCleanupAsync);
    }

    /// <summary>
    /// An administrator may act for a subject in their own tenant; a super admin for anyone.
    /// </summary>
    /// <remarks>
    /// The subject's company is read from the subject's row, never from the request, so a
    /// company admin cannot name a user id in another tenant and have it accepted. A subject
    /// with <c>CompanyId == null</c> is global scope (today only a super admin, see the remark
    /// on <c>User.CompanyId</c>) and is reachable only by a super admin.
    /// </remarks>
    private static bool CanAdministerSubject(CurrentUser currentUser, User subject)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return subject.CompanyId is { } companyId && currentUser.CompanyId == companyId.ToString();
    }

    /// <summary>
    /// The one tenant this caller may act in, or null for a super admin, whose reach is every
    /// tenant. Handed to the exporter and the eraser, which use it on every lookup that matches
    /// on an email address rather than on a foreign key.
    /// </summary>
    /// <remarks>
    /// Read from the caller's own row rather than from the subject's, so that widening what a
    /// caller may be shown takes a change to their authority and not to whose data they asked
    /// about. For everyone except a super admin the two are the same tenant anyway, because
    /// <see cref="CanAdministerSubject"/> has already refused the cross-tenant case and
    /// self-service means caller and subject are one row.
    ///
    /// A non-super-admin whose own row carries no company has no tenant to act in, and the
    /// scope becomes <see cref="Guid.Empty"/> — a value no company row carries in practice,
    /// since those ids are generated — so the lookups match nothing rather than everything.
    /// Erring open on a caller shape nobody expected is how the leak this scope exists to close
    /// would come back.
    /// </remarks>
    private static Guid? AuthorityScope(CurrentUser currentUser, User caller)
        => currentUser.Role == Roles.SuperAdmin ? null : caller.CompanyId ?? Guid.Empty;

    private static async Task<IResult> AccessAsync(
        Guid? userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var caller = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (caller is null) return Results.Forbid();

        // Omitting userId means "about me". That is the self-service case and needs no role.
        var subject = userId is not { } requested || requested == caller.Id
            ? caller
            : await db.Users.FirstOrDefaultAsync(u => u.Id == requested, cancellationToken);

        if (subject is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (subject.Id != caller.Id && !CanAdministerSubject(currentUser, subject))
        {
            return Results.Forbid();
        }

        var now = DateTimeOffset.UtcNow;
        var export = await SubjectAccessExport.BuildAsync(
            db, subject, AuthorityScope(currentUser, caller), now, cancellationToken);

        await AuditAsync(
            db, caller, AccessAction, subject.Id.ToString(), subject.CompanyId, now, loggerFactory,
            cancellationToken);

        return Results.Ok(export);
    }

    private static async Task<IResult> EraseAsync(
        ErasureRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var caller = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (caller is null) return Results.Forbid();

        if (!request.Confirm)
        {
            return Results.Json(
                new { message = "Erasure is irreversible. Set Confirm to true to proceed." },
                statusCode: 400);
        }

        var subject = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (subject is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAdministerSubject(currentUser, subject))
        {
            return Results.Forbid();
        }

        // A subject can no more erase themselves here than they can grant themselves a role.
        // #137's self-service page raises a request; a controller acts on it.
        if (subject.Id == caller.Id)
        {
            return Results.Json(
                new { message = "An administrator cannot erase their own account through this endpoint." },
                statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;

        // Written and saved BEFORE the erasure runs. SubjectErasure opens its own transaction
        // and commits it, so an audit row added afterwards would be a second, separate write --
        // and the one moment an audit trail must not have a gap is around the action that
        // destroys data. Filed against the caller, naming the subject, so it survives the
        // erasure of the subject's own rows.
        await AuditAsync(
            db, caller, ErasureAction, subject.Id.ToString(), subject.CompanyId, now, loggerFactory,
            cancellationToken);

        var result = await SubjectErasure.EraseAsync(
            db, subject, AuthorityScope(currentUser, caller), now, cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> ComplianceReportAsync(
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var caller = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (caller is null) return Results.Forbid();

        Guid? scope;
        if (currentUser.Role == Roles.SuperAdmin)
        {
            scope = companyId;
        }
        else
        {
            // A company admin's report is always about their own tenant, whatever the query
            // string says -- asking about another tenant is refused rather than silently
            // rescoped, so a caller cannot mistake the answer for the one they asked for.
            if (!Guid.TryParse(currentUser.CompanyId, out var ownCompanyId)) return Results.Forbid();
            if (companyId is { } requested && requested != ownCompanyId) return Results.Forbid();
            scope = ownCompanyId;
        }

        var now = DateTimeOffset.UtcNow;
        var report = await ComplianceReport.BuildAsync(db, scope, now, cancellationToken);

        await AuditAsync(
            db, caller, ComplianceReportAction, scope?.ToString(), scope, now, loggerFactory, cancellationToken);

        return Results.Ok(report);
    }

    private static async Task<IResult> RetentionCleanupAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin) return Results.Forbid();

        var caller = await ActingUserResolver.ResolveAsync(currentUser, db, cancellationToken);
        if (caller is null) return Results.Forbid();

        var now = DateTimeOffset.UtcNow;

        // Audited before the sweep, for the same reason as erasure: this deletes rows. It names
        // no subject and crosses every company, so there is no tenant to fall back on when the
        // caller has none of their own, and a company-less super admin leaves no record here.
        // That combination is warned about rather than silently skipped; see AuditAsync.
        await AuditAsync(
            db, caller, RetentionCleanupAction, resourceId: null, fallbackCompanyId: null, now, loggerFactory,
            cancellationToken);

        // The same entry point the scheduled worker calls, with no cap: a human asking for the
        // sweep by hand is asking it to finish, exactly as DELETE /surveys/drafts/expired does.
        var result = await RetentionCleanupJob.RunAsync(
            db, loggerFactory, now, maxRowsPerCategory: null, cancellationToken);

        return Results.Ok(result);
    }

    /// <summary>
    /// One <c>audit_logs</c> row per GDPR action, attributed to the caller.
    /// </summary>
    /// <param name="fallbackCompanyId">
    /// The tenant the action was performed <i>on</i>, used when the caller's own row has no
    /// company: the subject's company for an access export or an erasure, the requested scope
    /// for a compliance report, and nothing at all for the global sweep.
    /// </param>
    /// <remarks>
    /// <c>audit_logs.company_id</c> is NOT NULL with a restricting foreign key to
    /// <c>companies</c>, and a global super admin (#191) has no company row to attribute an
    /// entry to. Widening the column is a migration, and this issue adds none — so the row is
    /// filed against the tenant that was acted on instead, which is arguably where it belonged
    /// all along: it puts the record of "somebody exported one of your employees' data" in
    /// front of the administrators of the tenant whose data moved.
    ///
    /// What that leaves is a caller with no company performing an action that names no tenant
    /// either: the retention sweep, always, and a compliance report asked about every tenant at
    /// once. Both log a warning rather than being passed over in silence, since the first of
    /// them deletes rows, and both are closed by #143's audit convention. The same NOT NULL
    /// trade-off is recorded on <c>ProfileEndpoints.AddActivity</c>.
    ///
    /// Saved immediately rather than left for a later <c>SaveChangesAsync</c>. Erasure runs in
    /// its own transaction and retention cleanup issues <c>ExecuteDelete</c> statements, so
    /// neither has a pending save for an audit row to ride along with, and the two actions that
    /// destroy data need their record committed before the destruction rather than after it.
    /// </remarks>
    private static async Task AuditAsync(
        ClimateProjectDbContext db,
        User caller,
        string action,
        string? resourceId,
        Guid? fallbackCompanyId,
        DateTimeOffset now,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if ((caller.CompanyId ?? fallbackCompanyId) is not { } companyId)
        {
            loggerFactory.CreateLogger(typeof(GdprEndpoints)).LogWarning(
                "GDPR action {Action} by user {UserId} ran without an audit row: neither the caller nor the "
                + "action names a company, and audit_logs.company_id is NOT NULL.",
                action,
                caller.Id);
            return;
        }

        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = caller.Id,
            CompanyId = companyId,
            Action = action,
            Resource = AuditResource,
            ResourceId = resourceId,
            Success = true,
            Timestamp = now,
        });

        await db.SaveChangesAsync(cancellationToken);
    }
}
