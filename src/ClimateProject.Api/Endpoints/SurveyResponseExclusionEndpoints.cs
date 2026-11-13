using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Taking one person's response out of a survey's results, and putting it back
/// (ruled 2026-11-08, <c>docs/decisions/operators-reopen-exclude-delete.md</c>).
/// </summary>
/// <remarks>
/// <para><b>Why it exists.</b> On 28 Oct 2026 somebody outside ESPH's Clima population received a
/// Clima key by mistake and answered. The only remedy was a note telling the results generator to
/// subtract her by hand (<c>esph-excluir-de-resultados.md</c>). This is that note as a button.</para>
///
/// <para><b>Excluded, not deleted.</b> <c>responses.excluded_at</c> is set and the row stays, with
/// every answer: the client may yet decide the person counts. The query filter
/// <see cref="ResponseQueryFilters.Counted"/> drops it from every result, report, export, dashboard
/// and benchmark; <c>surveys.response_count</c> moves with it, because the detail page and the PDFs
/// read that counter.</para>
///
/// <para><b>Only TIMS, and only by person.</b> Super admins only. The response is found from the
/// PERSON -- by user id on an identified survey, by the derived resume id on an anonymous one, the
/// same two keys the roster reads states by -- and nothing about the answers is ever returned.
/// A response written through a public link carries neither key, so it cannot be traced to anyone
/// and cannot be excluded this way; that is refused rather than guessed at.</para>
///
/// <para><b>What the audit row says, and what it leaves out.</b> Client administrators can read
/// their company's activity log. Whoever knows WHOSE response left the results, and compares the
/// results before and after, can work that person's answers out by subtraction. So the row is
/// filed under the survey (its resource id is the survey, and the person travels in the request
/// BODY, which the trail never copies), and carries the reason and nothing naming the person. The
/// person is visible only to super admins, on the roster. The confirmation tells the operator
/// both things: the subtraction, and that the reason is readable by the client.</para>
/// </remarks>
public static class SurveyResponseExclusionEndpoints
{
    /// <summary>The longest reason kept: <c>AuditEntry.MaxChangeValueLength</c>, so nothing is cut.</summary>
    public const int MaxReasonLength = AuditEntry.MaxChangeValueLength;

    /// <summary>The shortest reason accepted. A reason is the only record of why the results changed.</summary>
    public const int MinReasonLength = 5;

    public static void MapSurveyResponseExclusionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/surveys/{surveyId:guid}/response-exclusions").RequireAuthorization();
        group.MapPost("", ExcludeAsync);
        group.MapPost("/restore", RestoreAsync);
    }

    private static Task<IResult> ExcludeAsync(
        Guid surveyId,
        ExcludeResponseRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IConfiguration configuration,
        AuditEntry audit,
        CancellationToken cancellationToken)
        => ChangeAsync(surveyId, request.UserId, request.Reason, exclude: true, principal, db, configuration, audit, cancellationToken);

    private static Task<IResult> RestoreAsync(
        Guid surveyId,
        RestoreResponseRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IConfiguration configuration,
        AuditEntry audit,
        CancellationToken cancellationToken)
        => ChangeAsync(surveyId, request.UserId, reason: null, exclude: false, principal, db, configuration, audit, cancellationToken);

    private static async Task<IResult> ChangeAsync(
        Guid surveyId,
        Guid userId,
        string? reason,
        bool exclude,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IConfiguration configuration,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var survey = await db.Surveys
            .AsNoTracking()
            .Where(s => s.Id == surveyId)
            .Select(s => new { s.Id, s.CompanyId, s.Settings.Anonymous })
            .FirstOrDefaultAsync(cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        // Filed under the survey's company and the survey -- see the class remarks for why the
        // resource is never the person.
        if (await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, survey.CompanyId);
        }

        audit.SetResourceId(survey.Id);

        var trimmedReason = reason?.Trim() ?? string.Empty;
        if (exclude && (trimmedReason.Length < MinReasonLength || trimmedReason.Length > MaxReasonLength))
        {
            return Results.Json(
                new
                {
                    message = $"Say why, in {MinReasonLength} to {MaxReasonLength} characters: the reason is the only record of why the results changed.",
                    code = AdminRefusals.ExclusionReasonRequired,
                },
                statusCode: 400);
        }

        var personInCompany = await db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.CompanyId == survey.CompanyId, cancellationToken);
        if (!personInCompany)
        {
            return Results.Json(new { message = "That person is not in this survey's company." }, statusCode: 404);
        }

        var resumeKey = SurveyResumeSessionConfiguration.KeyFrom(configuration);
        var rows = await PersonResponses(db, survey.Id, survey.Anonymous, userId, resumeKey)
            .ToListAsync(cancellationToken);
        var completed = rows.Where(r => r.IsComplete).ToList();
        if (completed.Count == 0)
        {
            return Results.Json(
                new
                {
                    message = "This person has no finished response on this survey that can be traced to them, so there is nothing to take out of the results.",
                    code = AdminRefusals.ExclusionNoResponse,
                },
                statusCode: 409);
        }

        // Idempotent both ways: a retried click changes nothing and is not an error.
        var toChange = rows.Where(r => (r.ExcludedAt is null) == exclude).ToList();
        var countChange = toChange.Count(r => r.IsComplete);
        if (toChange.Count > 0)
        {
            var now = DateTimeOffset.UtcNow;
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            foreach (var row in toChange)
            {
                row.ExcludedAt = exclude ? now : null;
            }

            await db.SaveChangesAsync(cancellationToken);
            if (countChange > 0)
            {
                // Relative, not absolute: the respond flow increments this counter with its own
                // ExecuteUpdate, and writing back a number read earlier would lose a completion
                // that landed in between.
                var delta = exclude ? -countChange : countChange;
                await db.Surveys
                    .Where(s => s.Id == survey.Id)
                    .ExecuteUpdateAsync(
                        s => s.SetProperty(x => x.ResponseCount, x => x.ResponseCount + delta < 0 ? 0 : x.ResponseCount + delta),
                        cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }

        audit.RecordChange("response", exclude ? "counted" : "excluded", exclude ? "excluded" : "counted");
        if (exclude)
        {
            audit.RecordChange("reason", null, trimmedReason);
        }

        var responseCount = await db.Surveys
            .AsNoTracking()
            .Where(s => s.Id == survey.Id)
            .Select(s => s.ResponseCount)
            .FirstAsync(cancellationToken);

        return Results.Ok(new ResponseExclusionResult(exclude, toChange.Count > 0, responseCount));
    }

    /// <summary>
    /// Every response row of <paramref name="userId"/> on a survey, excluded or not, found by the
    /// key the respond flow wrote it with: the user id on an identified survey, the derived resume
    /// id on an anonymous one (<see cref="SurveyResumeSession"/>). A row written through a public
    /// link has neither and is never returned.
    /// </summary>
    internal static IQueryable<Response> PersonResponses(
        ClimateProjectDbContext db,
        Guid surveyId,
        bool anonymous,
        Guid userId,
        string? resumeKey)
    {
        var all = db.Responses.IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded).Where(r => r.SurveyId == surveyId);
        if (!anonymous)
        {
            return all.Where(r => r.UserId == userId);
        }

        var derived = SurveyResumeSession.IdFor(surveyId, userId, resumeKey);
        return derived is null
            ? all.Where(_ => false)
            : all.Where(r => r.UserId == null && r.SessionId == derived);
    }

    /// <summary>
    /// Which of <paramref name="userIds"/> have a response on the survey that is excluded from
    /// its results. For the roster, and for super admins only.
    /// </summary>
    internal static async Task<HashSet<Guid>> ExcludedPeopleAsync(
        ClimateProjectDbContext db,
        Guid surveyId,
        bool anonymous,
        IReadOnlyCollection<Guid> userIds,
        string? resumeKey,
        CancellationToken cancellationToken)
    {
        var excluded = db.Responses
            .IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded)
            .AsNoTracking()
            .Where(r => r.SurveyId == surveyId && r.ExcludedAt != null);

        if (!anonymous)
        {
            var ids = await excluded
                .Where(r => r.UserId != null)
                .Select(r => r.UserId!.Value)
                .Distinct()
                .ToListAsync(cancellationToken);
            return [.. ids.Where(userIds.Contains)];
        }

        var sessions = (await excluded
                .Where(r => r.UserId == null)
                .Select(r => r.SessionId)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
        if (sessions.Count == 0)
        {
            return [];
        }

        return [.. userIds.Where(id => SurveyResumeSession.IdFor(surveyId, id, resumeKey) is { } derived && sessions.Contains(derived))];
    }
}

/// <summary>Body of <c>POST /surveys/{id}/response-exclusions</c>. The person goes in the body so the audit trail, which records the path, never names them.</summary>
public sealed record ExcludeResponseRequest(Guid UserId, string? Reason);

/// <summary>Body of <c>POST /surveys/{id}/response-exclusions/restore</c>.</summary>
public sealed record RestoreResponseRequest(Guid UserId);

/// <summary>What an exclusion or a restore did: whether anything changed, and the survey's counted responses after it.</summary>
public sealed record ResponseExclusionResult(bool Excluded, bool Changed, int ResponseCount);
