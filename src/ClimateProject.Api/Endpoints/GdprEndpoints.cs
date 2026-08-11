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
/// <para><b>Every action is audit-logged</b>, including the ones that only read: a subject
/// access export is a bulk disclosure of one person's data and the fact that it happened is
/// itself the thing an investigation needs. The rows are written to <c>audit_logs</c> through
/// the same shape <c>ProfileEndpoints</c> uses, and the log is attributed to the
/// <i>caller</i>, with the subject in <c>resource_id</c>. #143 is landing an audit-logging
/// convention in parallel; when it does, these four writes should move onto it rather than
/// keep their own copy.</para>
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

    private static async Task<IResult> AccessAsync(
        Guid? userId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
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
        var export = await SubjectAccessExport.BuildAsync(db, subject, now, cancellationToken);

        await AuditAsync(db, caller, AccessAction, subject.Id.ToString(), now, cancellationToken);

        return Results.Ok(export);
    }

    private static async Task<IResult> EraseAsync(
        ErasureRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
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
        await AuditAsync(db, caller, ErasureAction, subject.Id.ToString(), now, cancellationToken);

        var result = await SubjectErasure.EraseAsync(db, subject, now, cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> ComplianceReportAsync(
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
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

        await AuditAsync(db, caller, ComplianceReportAction, scope?.ToString(), now, cancellationToken);

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

        // Audited before the sweep, for the same reason as erasure: this deletes rows.
        await AuditAsync(db, caller, RetentionCleanupAction, resourceId: null, now, cancellationToken);

        // The same entry point the scheduled worker calls, with no cap: a human asking for the
        // sweep by hand is asking it to finish, exactly as DELETE /surveys/drafts/expired does.
        var result = await RetentionCleanupJob.RunAsync(
            db, loggerFactory, now, maxRowsPerCategory: null, cancellationToken);

        return Results.Ok(result);
    }

    /// <summary>
    /// One <c>audit_logs</c> row per GDPR action, attributed to the caller.
    /// </summary>
    /// <remarks>
    /// Skipped for a caller with no company, and the omission is deliberate rather than
    /// overlooked: <c>audit_logs.company_id</c> is NOT NULL with a restricting foreign key to
    /// <c>companies</c>, and a global super admin (#191) has no company row to attribute an
    /// entry to. Widening the column is a migration, and this issue adds none. The same
    /// trade-off is already recorded on <c>ProfileEndpoints.AddActivity</c>. The consequence
    /// is bounded and visible: actions by a company-less super admin are not audited here, and
    /// the action itself still runs.
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
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (caller.CompanyId is not { } companyId)
        {
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
