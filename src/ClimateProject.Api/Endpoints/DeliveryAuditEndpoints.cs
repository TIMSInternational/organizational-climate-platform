using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /admin/companies/{companyId}/delivery-audit</c> — the delivery audit as a workbook:
/// per survey that hands out codes, how many went out, how many people got in, and who never
/// received the email and what their mail server answered.
/// </summary>
/// <remarks>
/// <para>
/// <b>Super admin only.</b> It is TIMS's operational record — names, addresses and server replies
/// — and the client never receives it (ruled 26 Oct 2026 for the script it replaces). A company
/// administrator reads the status workbook instead. Audited as a sensitive read, like the other
/// files that carry a list of named people out of the server.
/// </para>
/// <para>
/// <b>Proof of receipt is a sign-in.</b> A code that has been used reached its holder, whatever
/// SES said about any mail; a code that has not, and whose latest mail bounced after it was
/// minted, did not. The rule is <see cref="DeliveryAuditWorkbook"/>'s and is written down there.
/// </para>
/// <para>
/// <b>An approximation, stated.</b> A bounce is recorded against an ADDRESS, not a survey — the
/// product does not tag mail with the survey it is for. A person holding codes for two surveys
/// whose address bounced after both were minted is listed under both. That is the truth about
/// the address, which is what an operator fixes.
/// </para>
/// </remarks>
public static class DeliveryAuditEndpoints
{
    public static void MapDeliveryAuditEndpoints(this WebApplication app)
    {
        app.MapGet("/admin/companies/{companyId:guid}/delivery-audit", ExportAsync)
            .RequireAuthorization()
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));
    }

    private static async Task<IResult> ExportAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies.AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => new { c.Name, c.Settings.Language, c.Settings.Timezone })
            .FirstOrDefaultAsync(cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        var spanish = SurveyRosterCsv.IsSpanish(company.Language);

        // Every survey that hands out codes and has gone out. A draft has sent nothing.
        var surveys = await db.Surveys.AsNoTracking()
            .Where(s => s.CompanyId == companyId
                && s.Settings.CredentialMode == CredentialModes.PerSurvey
                && s.Status != SurveyStatuses.Draft)
            .OrderBy(s => s.CreatedAt)
            .Select(s => new { s.Id, s.TitleEs, s.TitleEn })
            .ToListAsync(cancellationToken);
        var surveyIds = surveys.Select(s => s.Id).ToList();

        var credentials = await db.SurveyCredentials.AsNoTracking()
            .Where(c => surveyIds.Contains(c.SurveyId))
            .Select(c => new { c.SurveyId, c.UserId, c.CreatedAt, c.LastSignInAt })
            .ToListAsync(cancellationToken);
        var userIds = credentials.Select(c => c.UserId).Distinct().ToList();

        var people = await db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.Name, u.Email })
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        // Each person's latest failure; only the latest decides whether the current mail failed.
        var latest = (await db.EmailDeliveryEvents.AsNoTracking()
                .Where(e => userIds.Contains(e.UserId))
                .Select(e => new { e.UserId, e.Email, e.EventType, e.BounceType, e.Diagnostic, e.OccurredAt })
                .ToListAsync(cancellationToken))
            .GroupBy(e => e.UserId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.OccurredAt).First());

        var recordingSince = await db.EmailDeliveryEvents.AsNoTracking()
            .Select(e => (DateTimeOffset?)e.ReceivedAt)
            .MinAsync(cancellationToken);

        var lines = new List<DeliveryAuditSurvey>(surveys.Count);
        var failures = new List<DeliveryAuditFailure>();
        foreach (var survey in surveys)
        {
            var title = (spanish ? survey.TitleEs ?? survey.TitleEn : survey.TitleEn ?? survey.TitleEs) ?? survey.Id.ToString();
            var held = credentials.Where(c => c.SurveyId == survey.Id).ToList();
            var notDelivered = 0;
            foreach (var credential in held)
            {
                if (!latest.TryGetValue(credential.UserId, out var failure) || failure.OccurredAt < credential.CreatedAt)
                {
                    continue;
                }

                var signedIn = credential.LastSignInAt is not null;
                if (!signedIn)
                {
                    notDelivered++;
                }

                var person = people.GetValueOrDefault(credential.UserId);
                failures.Add(new DeliveryAuditFailure(
                    person?.Name ?? "",
                    person?.Email ?? failure.Email,
                    title,
                    credential.CreatedAt,
                    failure.EventType,
                    failure.BounceType,
                    failure.Diagnostic,
                    failure.OccurredAt,
                    signedIn));
            }

            lines.Add(new DeliveryAuditSurvey(
                title, held.Count, held.Count(c => c.LastSignInAt is not null), notDelivered));
        }

        var today = DateOnly.FromDateTime(
            SchedulingTimeZone.ToLocal(DateTimeOffset.UtcNow, SchedulingTimeZone.Resolve(company.Timezone)));

        return Results.File(
            DeliveryAuditWorkbook.Build(company.Name, lines, failures, today, recordingSince, spanish),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            SurveyParticipationEndpoints.CompanyFileName(spanish ? "auditoria-envios" : "delivery-audit", company.Name, today));
    }
}
