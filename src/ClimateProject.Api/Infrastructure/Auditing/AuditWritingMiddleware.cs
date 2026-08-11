using System.Globalization;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;

namespace ClimateProject.Api.Infrastructure.Auditing;

/// <summary>
/// Writes one <c>audit_logs</c> row per audited request (#143).
///
/// ## Middleware, not a SaveChanges interceptor
///
/// The issue offered either. Middleware is the only one of the two that can answer the
/// questions the issue says the trail exists for:
///
/// <list type="bullet">
/// <item><description>"who read this report" and "who exported this data" are reads. A read
/// calls no <c>SaveChanges</c>, so an EF interceptor cannot see one at all.</description></item>
/// <item><description>A mutating endpoint that changes nothing -- a no-op update, a delete of
/// a row that was already gone, a 403 -- calls <c>SaveChanges</c> with an empty change
/// tracker or not at all. Those are exactly the attempts a security trail wants, and an
/// interceptor records none of them.</description></item>
/// <item><description>The actor, the IP and the user agent are HTTP facts. An interceptor
/// would have to reach back into <c>IHttpContextAccessor</c> for all three.</description></item>
/// </list>
///
/// What the choice costs, stated because it is the requirement it forfeits: an interceptor is
/// the only one of the two holding the before and after values (<c>EntityEntry.OriginalValues</c>
/// and <c>CurrentValues</c>), so middleware cannot produce #143's "before/after where
/// meaningful" by itself. A handler that has both hands them to <see cref="AuditEntry.RecordChange"/>
/// and they are serialised into <c>details</c>; <c>SurveyAuditTrail</c> writes the richer
/// field-level diff for surveys. docs/decisions/audit-logging.md tracks the rest.
///
/// The interceptor still exists, for the one job it is genuinely better at:
/// <see cref="AuditLogAppendOnlyInterceptor"/> refuses to let anything UPDATE or DELETE an
/// audit row. Writing is the middleware's; protecting what is written is the interceptor's.
///
/// ## The write is in its own scope, and its own transaction
///
/// It would be cheaper to reuse the request's <c>ClimateProjectDbContext</c>, and wrong. That
/// context can still be holding changes a handler made and then deliberately did not save --
/// an entity mutated in place before a validation branch returned 400. Calling
/// <c>SaveChangesAsync</c> on it here would flush them, turning the audit trail into a
/// mechanism that commits the writes it was only supposed to observe. A fresh scope has an
/// empty change tracker and can only insert the row it was given.
///
/// The cost is one extra round trip per audited request -- two when the handler did not
/// enrich, because the actor has to be resolved. What it is *not* is a second pooled
/// connection held alongside the request's own: <c>next(context)</c> has returned by the time
/// this runs, and EF closes the connection it opened as soon as each operation finishes,
/// returning it to Npgsql's pool rather than holding it for the <c>DbContext</c>'s lifetime.
/// The two contexts use the pool one after the other.
///
/// <c>AuditPoolPressureTests</c> pins that against a pool deliberately smaller than the number
/// of concurrent mutations, and it counts the rows as well as the responses: made to hold the
/// request's connection open across this write, the same test still returns 201 for every
/// request and writes **zero** audit rows, because a write that cannot get a connection is
/// swallowed by the handler below. Doubling the pool demand would cost the trail silently, not
/// loudly. Reads are not audited by default so even the sequential cost stays bounded to
/// mutations and the handful of reads that ask for it.
///
/// ## A failed audit never fails the request
///
/// The row is written after the response; nothing about it can be reported to the caller. A
/// write that throws is logged at Error and swallowed. The alternative -- 500-ing a mutation
/// that already succeeded -- would tell the caller their change failed when it did not.
/// </summary>
internal sealed class AuditWritingMiddleware(
    RequestDelegate next,
    IServiceScopeFactory scopeFactory,
    ILogger<AuditWritingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context, AuditEntry entry)
    {
        var decision = AuditPolicy.Decide(context.GetEndpoint(), context.Request.Method);
        if (!decision.IsAudited)
        {
            await next(context);
            return;
        }

        Exception? failure = null;
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            // Recorded, then rethrown untouched so UseExceptionHandler still turns it into the
            // response it would have. An unhandled exception on a mutating endpoint is one of
            // the things most worth having in the trail.
            failure = exception;
            throw;
        }
        finally
        {
            await WriteAsync(context, entry, decision, failure);
        }
    }

    private async Task WriteAsync(
        HttpContext context,
        AuditEntry entry,
        AuditDecision decision,
        Exception? failure)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

            var actor = await ResolveActorAsync(context, entry, db);
            if (actor is not { } resolved)
            {
                // Not an error: this is where every mutating endpoint that accepts an
                // unidentified caller lands. audit_logs.company_id is NOT NULL behind a
                // RESTRICT foreign key to companies, so a request with no resolvable tenant has
                // no row that can legally be inserted. Warning rather than silence so the gap
                // is visible in the logs of any environment that hits it.
                //
                // The set of endpoints this can happen on is not written out here -- a
                // hand-copied list goes stale, and this one already had. It is derived from the
                // live route table and asserted exactly by
                // AuditCoverageTests.UnattributableMutatingRoutes, so a new one fails the build;
                // docs/decisions/audit-logging.md records what closing the gap needs.
                logger.LogWarning(
                    "Audit row for {Method} {Path} was not written: no company could be resolved for the caller.",
                    context.Request.Method,
                    context.Request.Path.Value);
                return;
            }

            db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                UserId = resolved.UserId,
                CompanyId = resolved.CompanyId,
                Action = entry.Action ?? decision.Action,
                Resource = entry.Resource ?? decision.Resource,
                ResourceId = entry.ResourceId ?? DeriveResourceId(context),
                Details = Describe(context, entry, failure),
                IpAddress = AuditPolicy.TruncateOptional(
                    context.Connection.RemoteIpAddress?.ToString(),
                    AuditPolicy.MaxIpAddressLength),
                UserAgent = AuditPolicy.TruncateOptional(
                    context.Request.Headers.UserAgent.ToString(),
                    AuditPolicy.MaxUserAgentLength),
                Success = failure is null && context.Response.StatusCode < StatusCodes.Status400BadRequest,
                ErrorMessage = DescribeFailure(context, failure),
                Timestamp = DateTimeOffset.UtcNow,
            });

            // CancellationToken.None, not context.RequestAborted: a caller who disconnects
            // mid-request has still caused whatever the handler already committed, and that is
            // the case where an audit row matters most.
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Failed to write the audit row for {Method} {Path}. The request itself was unaffected.",
                context.Request.Method,
                context.Request.Path.Value);
        }
    }

    /// <summary>
    /// Who to file the row under, or null when nothing can be.
    /// </summary>
    /// <remarks>
    /// Prefers what the handler already resolved -- see <see cref="AuditEntry.AttributeTo"/> --
    /// so an enriched request costs no extra query. Otherwise resolves the <c>sub</c> claim
    /// through <see cref="ActingUserResolver"/>, which is the one place in this codebase that
    /// knows <c>sub</c> is <c>PersonaExternalId ?? Id</c> and that the two must be tried in
    /// that order.
    ///
    /// <c>audit_logs.user_id</c> is nullable but <c>company_id</c> is not, so a user row whose
    /// <c>CompanyId</c> is null -- the company-less SuperAdmin of #191 -- is unattributable and
    /// returns null here.
    /// </remarks>
    private static async Task<(Guid? UserId, Guid CompanyId)?> ResolveActorAsync(
        HttpContext context,
        AuditEntry entry,
        ClimateProjectDbContext db)
    {
        if (entry.CompanyId is { } enrichedCompanyId)
        {
            return (entry.ActorUserId, enrichedCompanyId);
        }

        if (context.User.FindFirst("sub") is null)
        {
            return null;
        }

        var resolved = await ActingUserResolver.ResolveIdAndCompanyAsync(
            context.User.GetCurrentUser(),
            db,
            CancellationToken.None);

        if (resolved is not { } user || user.CompanyId is not { } companyId)
        {
            return null;
        }

        return (user.UserId, companyId);
    }

    /// <summary>
    /// The row the request acted on, when the route says which.
    /// </summary>
    /// <remarks>
    /// The last route value that parses as a Guid. Last rather than first because the nested
    /// routes in this application put the acted-on row second:
    /// <c>/surveys/{surveyId}/invitations/{invitationId}/revoke</c> revokes the invitation.
    /// A handler that disagrees, or that created the row and so has an id no route carries,
    /// calls <see cref="AuditEntry.SetResourceId(Guid)"/> and wins.
    /// </remarks>
    private static string? DeriveResourceId(HttpContext context)
    {
        string? found = null;

        foreach (var value in context.Request.RouteValues.Values)
        {
            if (value is string text && Guid.TryParse(text, out _))
            {
                found = text;
            }
        }

        return AuditPolicy.TruncateOptional(found, AuditPolicy.MaxResourceIdLength);
    }

    /// <summary>
    /// The <c>details</c> jsonb: method, path, status, and the before/after values the handler
    /// chose to record. Nothing else.
    /// </summary>
    /// <remarks>
    /// Deliberately not the request body and not the query string. The bodies on this API
    /// include passwords (<c>PUT /profile/password</c>, <c>/auth/login</c>) and free-text
    /// survey answers, and the query strings carry demographic filters; an audit table is a
    /// long-retention table read by admins, and is the last place any of that should be
    /// copied to. The path alone is enough to reconstruct which endpoint and which row.
    ///
    /// <c>Changes</c> is the one exception, and it is opt-in per field rather than automatic
    /// for that reason -- see <see cref="AuditEntry.RecordChange"/>, which says what must not
    /// be passed to it. Null, not an empty object, when the handler recorded none: a reader
    /// scanning the column can then tell "no diff was captured" from "nothing changed".
    /// </remarks>
    private static string Describe(HttpContext context, AuditEntry entry, Exception? failure)
        => JsonSerializer.Serialize(new AuditDetails(
            context.Request.Method,
            context.Request.Path.Value ?? string.Empty,
            StatusToRecord(context, failure),
            entry.Changes.Count == 0 ? null : entry.Changes));

    /// <summary>
    /// The response status, or null when the request ended in an exception.
    /// </summary>
    /// <remarks>
    /// This runs from a <c>finally</c> while the exception is still travelling outwards, so
    /// <c>UseExceptionHandler</c> -- registered upstream in <c>Program.cs</c> -- has not turned
    /// it into a status yet and <c>Response.StatusCode</c> still reads 200. Recording that 200
    /// would be a lie on the one kind of row where the outcome matters most: a request that
    /// became a 500, or the 409 the handler turns a unique-index violation into. Null says the
    /// status was not decided yet; <c>error_message</c> carries the exception's type name and
    /// <c>success</c> is false, so the row is unambiguous without inventing a number.
    /// </remarks>
    private static int? StatusToRecord(HttpContext context, Exception? failure)
        => failure is null ? context.Response.StatusCode : null;

    /// <summary>
    /// Why a request failed, in a form safe to keep.
    /// </summary>
    /// <remarks>
    /// The exception's type name, never its message: Npgsql and EF messages carry the database
    /// host, the failing SQL and the row values, and this table is readable by every
    /// CompanyAdmin in the tenant. A request that failed without throwing is described by its
    /// status code instead, which is all there is to say about it here.
    /// </remarks>
    private static string? DescribeFailure(HttpContext context, Exception? failure)
    {
        if (failure is not null)
        {
            return AuditPolicy.TruncateOptional(failure.GetType().Name, AuditPolicy.MaxErrorMessageLength);
        }

        return context.Response.StatusCode >= StatusCodes.Status400BadRequest
            ? string.Create(CultureInfo.InvariantCulture, $"HTTP {context.Response.StatusCode}")
            : null;
    }

    private sealed record AuditDetails(
        string Method,
        string Path,
        int? Status,
        IReadOnlyDictionary<string, AuditFieldChange>? Changes);
}

/// <summary>Pipeline registration for <see cref="AuditWritingMiddleware"/>.</summary>
public static class AuditWritingMiddlewareExtensions
{
    /// <summary>
    /// Adds the audit writer to the pipeline. Must sit **after** <c>UseAuthentication</c> --
    /// it reads <c>HttpContext.User</c> -- and **before** <c>UseAuthorization</c>, so that a
    /// mutating request refused by the authorization middleware is still recorded rather than
    /// vanishing. The second half only reaches a caller the request identifies: a 401 with no
    /// token has no tenant to file a row under. See the class remarks.
    /// </summary>
    public static IApplicationBuilder UseAuditLogging(this IApplicationBuilder app)
        => app.UseMiddleware<AuditWritingMiddleware>();
}
