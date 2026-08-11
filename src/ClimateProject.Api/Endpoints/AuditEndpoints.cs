using System.Globalization;
using System.Security.Claims;
using System.Text;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Reading the audit trail (#143), replacing legacy <c>api/audit/logs</c>,
/// <c>api/audit/[entityType]/[entityId]</c>, <c>api/audit/export</c> and
/// <c>api/audit/report</c>.
///
/// ## Who may read it
///
/// SuperAdmin sees every tenant and may filter to one. CompanyAdmin sees their own tenant and
/// cannot widen it — the <c>companyId</c> query parameter is ignored for them rather than
/// honoured, so there is no value of it that reaches another company's rows. Every other role
/// gets 403: the trail names who did what to whom across the whole company, and an employee's
/// own history is <c>GET /profile/activity</c>, which is scoped to their own user id.
///
/// Authorized inside each handler through <c>principal.GetCurrentUser()</c>, as everything in
/// this codebase is; <c>[Authorize(Roles=)]</c> is not used here.
///
/// ## These reads are themselves audited
///
/// <c>GET /audit/export</c> carries <see cref="AuditSensitiveReadAttribute"/>, so pulling a
/// copy of the trail writes a row to the trail. That is the point of the "who exported this
/// data" question in the issue, and it applies to the audit table as much as to any report.
/// The paged list and the report aggregate are not marked: they are the screen an admin sits
/// on, and auditing every refresh would drown the table in records of people looking at it.
/// </summary>
public static class AuditEndpoints
{
    /// <summary>Entries returned when the caller does not ask for a size.</summary>
    private const int DefaultPageSize = 50;

    /// <summary>Upper bound on one page, matching the shape of the other list endpoints here.</summary>
    private const int MaxPageSize = 200;

    /// <summary>
    /// Upper bound on one export. An export is a single response held entirely in memory, and
    /// an unbounded one over a mature tenant's trail is a way to make the API allocate as much
    /// as the table weighs. A caller who needs more narrows the window and exports twice.
    /// </summary>
    private const int MaxExportRows = 10_000;

    /// <summary>How many rows the entity trail returns before it starts dropping the oldest.</summary>
    private const int EntityTrailLimit = 200;

    /// <summary>The <c>resource</c> an export of the trail is filed under.</summary>
    public const string ExportResource = "audit";

    /// <summary>The <c>action</c> an export of the trail is filed under.</summary>
    public const string ExportAction = "audit.export";

    /// <summary>The window <c>GET /audit/report</c> covers when the caller gives no dates.</summary>
    private static readonly TimeSpan DefaultReportWindow = TimeSpan.FromDays(30);

    public static void MapAuditEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/audit").RequireAuthorization();

        group.MapGet("/logs", ListAsync);
        group.MapGet("/report", ReportAsync);

        group.MapGet("/export", ExportAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));

        // Three segments, so it cannot collide with the two-segment literals above.
        group.MapGet("/{resource}/{resourceId}", ForEntityAsync);
    }

    /// <summary>SuperAdmin, or CompanyAdmin with a company to be scoped to.</summary>
    private static bool CanReadAuditTrail(CurrentUser currentUser)
        => currentUser.Role == Roles.SuperAdmin
            || (currentUser.Role == Roles.CompanyAdmin && Guid.TryParse(currentUser.CompanyId, out _));

    /// <summary>
    /// The company filter to apply, or null for "every company".
    /// </summary>
    /// <remarks>
    /// Null is only ever returned for a SuperAdmin. For a CompanyAdmin the claim wins over the
    /// query parameter unconditionally — this is the single place tenant isolation is decided
    /// for the whole file, so it is written as a function returning the filter rather than as
    /// a check each handler has to remember to perform.
    /// </remarks>
    private static Guid? ResolveCompanyFilter(CurrentUser currentUser, Guid? requestedCompanyId)
    {
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Guid.Parse(currentUser.CompanyId);
        }

        return requestedCompanyId;
    }

    private static IQueryable<Domain.Entities.AuditLog> Filtered(
        ClimateProjectDbContext db,
        Guid? companyId,
        Guid? userId,
        string? resource,
        string? action,
        bool? success,
        DateTimeOffset? from,
        DateTimeOffset? to)
    {
        var query = db.AuditLogs.AsNoTracking();

        if (companyId is { } company) query = query.Where(a => a.CompanyId == company);
        if (userId is { } actor) query = query.Where(a => a.UserId == actor);
        if (!string.IsNullOrWhiteSpace(resource)) query = query.Where(a => a.Resource == resource);
        if (!string.IsNullOrWhiteSpace(action)) query = query.Where(a => a.Action == action);
        if (success is { } outcome) query = query.Where(a => a.Success == outcome);
        if (from is { } start) query = query.Where(a => a.Timestamp >= start);
        if (to is { } end) query = query.Where(a => a.Timestamp <= end);

        return query;
    }

    /// <summary>
    /// Attaches actor names to a page of rows.
    /// </summary>
    /// <remarks>
    /// A second query keyed on the ids already fetched, not a <c>Join</c> onto
    /// <c>db.Users</c> — the same two-query shape, for the same kind of reason, as
    /// <c>InvitationReminderJob</c>'s sweeps. <c>User</c> carries two owned types
    /// (<c>Preferences</c>, <c>Notifications</c>), and this codebase has already met one
    /// case where an owned type inside a <c>Join</c>'s inner query produced an expression EF
    /// could not translate at run time. Both queries here are single-key lookups on indexed
    /// columns, so the round trip is not worth finding out whether this is another one.
    /// </remarks>
    private static async Task<Dictionary<Guid, (string Name, string Email)>> LoadActorsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        var users = await db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.Name, u.Email })
            .ToListAsync(cancellationToken);

        return users.ToDictionary(u => u.Id, u => (u.Name, u.Email));
    }

    private static async Task<IResult> ListAsync(
        Guid? companyId,
        Guid? userId,
        string? resource,
        string? action,
        bool? success,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int? page,
        int? pageSize,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanReadAuditTrail(currentUser)) return Results.Forbid();

        var size = Math.Clamp(pageSize ?? DefaultPageSize, 1, MaxPageSize);
        var index = Math.Max(page ?? 1, 1);

        var query = Filtered(
            db, ResolveCompanyFilter(currentUser, companyId), userId, resource, action, success, from, to);

        var total = await query.CountAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Skip((index - 1) * size)
            .Take(size)
            .ToListAsync(cancellationToken);

        var actors = await LoadActorsAsync(
            db,
            rows.Where(r => r.UserId is not null).Select(r => r.UserId!.Value).Distinct().ToList(),
            cancellationToken);

        return Results.Ok(new AuditLogPage(
            rows.Select(row => ToItem(row, actors)).ToList(),
            total,
            index,
            size));
    }

    /// <summary>
    /// Everything recorded about one row: the resource named and everything filed beneath it,
    /// from both audit tables.
    /// </summary>
    /// <remarks>
    /// <paramref name="resource"/> is matched against <c>audit_logs.resource</c> — the derived
    /// dotted name, <c>surveys</c> or <c>admin.benchmarks</c>, see <see cref="AuditPolicy"/>.
    ///
    /// **Matched as a prefix, not as a literal.** The derivation names a row after the route
    /// that touched it, so the mutations of one survey are spread over <c>surveys</c>,
    /// <c>surveys.status</c>, <c>surveys.duplicate</c>, <c>surveys.invitations</c> and more,
    /// every one of them carrying that survey's id in <c>resource_id</c>. An exact match
    /// returned only the first of those, which made "who changed this survey after responses
    /// arrived" — the question #143 opens with — unanswerable from the endpoint built to
    /// answer it. So <c>surveys</c> matches itself and anything under <c>surveys.</c>, and the
    /// trailing dot is what keeps it from also matching a hypothetical <c>surveys_archive</c>.
    /// Asking for <c>surveys.status</c> still narrows to that one route's rows.
    ///
    /// What the prefix does *not* do is re-file rows onto a different id. A route that names a
    /// nested row — <c>/surveys/{surveyId}/invitations/{invitationId}/revoke</c> — records the
    /// invitation's id, not the survey's (see
    /// <c>AuditWritingMiddleware.DeriveResourceId</c>), so it answers
    /// <c>/audit/surveys.invitations.revoke/{invitationId}</c> and not the survey's trail.
    ///
    /// When it names surveys and the id is a Guid, the survey's own change history is merged in
    /// so a reader gets one ordered trail rather than having to know there are two tables.
    /// </remarks>
    private static async Task<IResult> ForEntityAsync(
        string resource,
        string resourceId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanReadAuditTrail(currentUser)) return Results.Forbid();

        var companyFilter = ResolveCompanyFilter(currentUser, requestedCompanyId: null);

        var subResourcePrefix = resource + ".";

        var general = await Filtered(db, companyFilter, null, null, null, null, null, null)
            .Where(a => a.Resource == resource || a.Resource.StartsWith(subResourcePrefix))
            .Where(a => a.ResourceId == resourceId)
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Take(EntityTrailLimit)
            .ToListAsync(cancellationToken);

        var actors = await LoadActorsAsync(
            db,
            general.Where(r => r.UserId is not null).Select(r => r.UserId!.Value).Distinct().ToList(),
            cancellationToken);

        var items = general.Select(row => ToItem(row, actors)).ToList();

        if (resource == SurveyResource && Guid.TryParse(resourceId, out var surveyId))
        {
            items.AddRange(await LoadSurveyTrailAsync(db, surveyId, companyFilter, cancellationToken));
        }

        return Results.Ok(items
            .OrderByDescending(i => i.Timestamp)
            .ThenByDescending(i => i.Id)
            .Take(EntityTrailLimit)
            .ToList());
    }

    /// <summary>
    /// The route-derived resource name for <c>/surveys/...</c>. Kept next to the one place that
    /// compares against it rather than in a constants file with no other member.
    /// </summary>
    private const string SurveyResource = "surveys";

    /// <summary>
    /// The survey's own change history, in the shared item shape.
    /// </summary>
    /// <remarks>
    /// Tenant-scoped by the survey rather than by the audit row: <c>survey_audit_logs</c> has
    /// no <c>company_id</c> column, so the check is that the survey belongs to the caller's
    /// company. A CompanyAdmin asking about another tenant's survey gets an empty list, which
    /// is the same answer they get from the general table.
    /// </remarks>
    private static async Task<List<AuditLogItem>> LoadSurveyTrailAsync(
        ClimateProjectDbContext db,
        Guid surveyId,
        Guid? companyFilter,
        CancellationToken cancellationToken)
    {
        if (companyFilter is { } company)
        {
            var visible = await db.Surveys
                .AsNoTracking()
                .AnyAsync(s => s.Id == surveyId && s.CompanyId == company, cancellationToken);

            if (!visible)
            {
                return [];
            }
        }

        return await db.SurveyAuditLogs
            .AsNoTracking()
            .Where(a => a.SurveyId == surveyId)
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Take(EntityTrailLimit)
            .Select(a => new AuditLogItem(
                a.Id,
                AuditSources.Survey,
                a.UserId,
                a.UserName,
                a.UserEmail,
                a.Action,
                a.EntityType,
                a.EntityId,
                true,
                null,
                a.IpAddress,
                a.Timestamp))
            .ToListAsync(cancellationToken);
    }

    private static async Task<IResult> ExportAsync(
        Guid? companyId,
        Guid? userId,
        string? resource,
        string? action,
        bool? success,
        DateTimeOffset? from,
        DateTimeOffset? to,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanReadAuditTrail(currentUser)) return Results.Forbid();

        // Named rather than left to derivation: the route is /audit/export, so the derived
        // pair would be resource "audit.export" and action "audit.export.export". The trail
        // reads better filed under the resource it is about.
        audit.Describe(ExportAction, ExportResource);

        var rows = await Filtered(
                db, ResolveCompanyFilter(currentUser, companyId), userId, resource, action, success, from, to)
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Take(MaxExportRows)
            .ToListAsync(cancellationToken);

        var actors = await LoadActorsAsync(
            db,
            rows.Where(r => r.UserId is not null).Select(r => r.UserId!.Value).Distinct().ToList(),
            cancellationToken);

        var csv = new StringBuilder("timestamp,action,resource,resource_id,user_id,user_name,user_email,success,ip_address\n");
        foreach (var row in rows)
        {
            var item = ToItem(row, actors);
            csv.Append(CultureInfo.InvariantCulture, $"{Csv(item.Timestamp.ToString("O", CultureInfo.InvariantCulture))},");
            csv.Append(CultureInfo.InvariantCulture, $"{Csv(item.Action)},{Csv(item.Resource)},{Csv(item.ResourceId)},");
            csv.Append(CultureInfo.InvariantCulture, $"{Csv(item.UserId?.ToString())},{Csv(item.UserName)},{Csv(item.UserEmail)},");
            csv.Append(CultureInfo.InvariantCulture, $"{(item.Success ? "true" : "false")},{Csv(item.IpAddress)}\n");
        }

        return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "audit-log.csv");
    }

    /// <summary>
    /// The leading characters a spreadsheet reads as the start of a formula rather than as
    /// text. See <see cref="Csv"/>.
    /// </summary>
    /// <remarks>
    /// <c>=</c> and <c>+</c> begin a formula in Excel, LibreOffice Calc and Sheets; <c>-</c>
    /// does too (it is parsed as unary minus applied to an expression); <c>@</c> is Excel's
    /// legacy intersection/function prefix. Tab and carriage return are included because a
    /// leading whitespace character can be dropped on import, which would promote the
    /// character after it into the leading position this rule is about.
    /// </remarks>
    private static readonly char[] FormulaLeadingCharacters = ['=', '+', '-', '@', '\t', '\r'];

    /// <summary>
    /// One CSV field, quoted and made inert.
    /// </summary>
    /// <remarks>
    /// Two separate jobs, and quoting only does the first.
    ///
    /// **Delimiters.** Always quoted, with embedded quotes doubled. Unconditional quoting
    /// rather than quote-when-needed because these values are user-controlled — a name or a
    /// user agent can contain a comma or a newline.
    ///
    /// **Formulas.** Quoting a field does *not* stop Excel or LibreOffice evaluating it: a
    /// cell whose text begins with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c> is a formula
    /// however it was quoted in the file. That matters here because this export's
    /// <c>user_name</c> and <c>user_email</c> columns are strings an ordinary Employee
    /// controls — <c>PUT /profile</c> accepts any non-blank name — and the person who opens
    /// the file is by definition a CompanyAdmin or a SuperAdmin, so the payload would run with
    /// the reader's authority on the reader's machine. A leading apostrophe is the standard
    /// neutraliser: spreadsheets treat the rest of the cell as literal text and do not display
    /// the apostrophe itself.
    ///
    /// Applied to every field rather than only the two known-hostile ones. <c>action</c> and
    /// <c>resource</c> are derived from route patterns today, but the point of a rule with no
    /// exceptions is that it survives someone adding a column that is not.
    /// </remarks>
    private static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        var escaped = value.Replace("\"", "\"\"", StringComparison.Ordinal);
        var inert = FormulaLeadingCharacters.Contains(value[0]) ? "'" + escaped : escaped;

        return $"\"{inert}\"";
    }

    private static async Task<IResult> ReportAsync(
        Guid? companyId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanReadAuditTrail(currentUser)) return Results.Forbid();

        var end = to ?? DateTimeOffset.UtcNow;
        var start = from ?? end - DefaultReportWindow;

        var query = Filtered(
            db, ResolveCompanyFilter(currentUser, companyId), null, null, null, null, start, end);

        var total = await query.CountAsync(cancellationToken);
        var failures = await query.CountAsync(a => !a.Success, cancellationToken);

        var topActions = await query
            .GroupBy(a => a.Action)
            .Select(g => new AuditActionCount(g.Key, g.Count()))
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.Action)
            .Take(10)
            .ToListAsync(cancellationToken);

        var topActorCounts = await query
            .Where(a => a.UserId != null)
            .GroupBy(a => a.UserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.UserId)
            .Take(10)
            .ToListAsync(cancellationToken);

        var actors = await LoadActorsAsync(
            db,
            topActorCounts.Select(c => c.UserId).ToList(),
            cancellationToken);

        return Results.Ok(new AuditReportResponse(
            start,
            end,
            total,
            failures,
            topActions,
            topActorCounts
                .Select(c => new AuditActorCount(
                    c.UserId,
                    actors.TryGetValue(c.UserId, out var actor) ? actor.Name : null,
                    c.Count))
                .ToList()));
    }

    private static AuditLogItem ToItem(
        Domain.Entities.AuditLog row,
        Dictionary<Guid, (string Name, string Email)> actors)
    {
        var actor = row.UserId is { } id && actors.TryGetValue(id, out var found)
            ? found
            : ((string Name, string Email)?)null;

        return new AuditLogItem(
            row.Id,
            AuditSources.General,
            row.UserId,
            actor?.Name,
            actor?.Email,
            row.Action,
            row.Resource,
            row.ResourceId,
            row.Success,
            row.ErrorMessage,
            row.IpAddress,
            row.Timestamp);
    }
}
