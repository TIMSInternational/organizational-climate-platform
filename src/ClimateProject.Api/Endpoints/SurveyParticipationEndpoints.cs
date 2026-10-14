using System.Globalization;
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /surveys/{id}/participation</c>: who has answered, and who has not.
/// </summary>
/// <remarks>
/// <para>
/// Ruled 2026-10-12: "collect name and email because we need to know who has answered and who
/// has not, but DON'T link them to their answers." This endpoint reads exactly two sources --
/// <c>survey_participations</c> and the company's user rows -- and nothing from
/// <c>responses</c>, <c>question_responses</c> or <c>response_demographics</c>. There is no
/// join to make and no answer to filter out.
/// </para>
/// <para>
/// Administrators only: <see cref="SurveyEndpoints.CanAdminister"/>, a super_admin or the
/// company_admin of the survey's own company. A list of named people is personal data even
/// without answers attached, so a department admin, a leader and an employee are refused, and
/// so is another tenant's admin.
/// </para>
/// </remarks>
public static class SurveyParticipationEndpoints
{
    public static void MapSurveyParticipationEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapGroup("/surveys")
            .RequireAuthorization()
            .MapGet("/{surveyId:guid}/participation", GetAsync);
    }

    /// <summary>
    /// The order a person reads a list of names in: Spanish rules, case and accents aside, and
    /// numbers by value. Sorted here, not by ORDER BY, because the database's collation decides
    /// that -- under "C" (measured locally) "Álvaro" came after "Zoe", and "Persona 10" before
    /// "Persona 2" (EAGLE, 2026-10-12).
    /// </summary>
    internal static readonly StringComparer NameOrder = StringComparer.Create(
        CultureInfo.GetCultureInfo("es"),
        CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace | CompareOptions.NumericOrdering);

    private static async Task<IResult> GetAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys
            .AsNoTracking()
            .Where(s => s.Id == surveyId)
            .Select(s => new { s.Id, s.CompanyId, s.Settings.CollectParticipantIdentity })
            .FirstOrDefaultAsync(cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId))
        {
            return Results.Forbid();
        }

        var answered = await db.SurveyParticipations
            .AsNoTracking()
            .Where(p => p.SurveyId == survey.Id && p.CompanyId == survey.CompanyId)
            .Select(p => new SurveyParticipantRow(p.Name, p.Email, p.ParticipatedOn))
            .ToListAsync(cancellationToken);
        answered = [.. answered.OrderBy(p => p.Name, NameOrder).ThenBy(p => p.Email, StringComparer.OrdinalIgnoreCase)];

        // The OTHER half of "who answered", and the half this screen never read.
        //
        // `survey_participations` is written only for a respondent with NO account
        // (`participation-is-not-linked-to-answers.md`), and the 2026-10-13 identity ruling
        // then switched off the step that fed it -- so on a mass invite, where every
        // respondent HAS an account, the table is empty and this screen reported 0 answered
        // and the whole roster pending, for ever, however many people had answered.
        //
        // For an account holder the answer was never missing: an identified response carries
        // `responses.user_id` by design, which is the same column that enforces
        // one-response-per-person. Reading it creates no linkage that the response row did
        // not already hold, which is exactly why the ruling's unlinkability machinery -- the
        // random id, the separate transaction, the day instead of a timestamp -- exists for
        // the accountless case and not for this one.
        //
        // An ANONYMOUS survey writes no user id at all, so this fails closed on its own: the
        // query returns nothing rather than being guarded by a flag that could drift.
        var fromAccounts = await db.Responses
            .AsNoTracking()
            .Where(r => r.SurveyId == survey.Id && r.IsComplete && r.UserId != null)
            .Join(
                db.Users.AsNoTracking(),
                response => response.UserId!.Value,
                user => user.Id,
                (response, user) => new { user.Name, user.Email, response.CompletionTime })
            .ToListAsync(cancellationToken);

        // A day, never a time, so this list stays the shape the surface promises. The stored
        // rows carry a day in the COMPANY's zone and these are UTC, so the two can differ by
        // one at a boundary; neither this screen nor its question ("has this person answered")
        // turns on which day it was, and inventing a zone neither the survey nor the company
        // stores would be worse than saying so.
        answered =
        [
            .. answered,
            .. fromAccounts
                .Where(row => !string.IsNullOrWhiteSpace(row.Name))
                .Select(row => new SurveyParticipantRow(
                    row.Name,
                    string.IsNullOrWhiteSpace(row.Email) ? null : row.Email,
                    DateOnly.FromDateTime((row.CompletionTime ?? DateTimeOffset.UtcNow).UtcDateTime))),
        ];

        // One row per person even if both sources somehow name them: the question is whether
        // they answered, and counting them twice would also inflate AnsweredCount.
        answered = [.. answered
            .GroupBy(p => p.Email is null ? $"name:{p.Name}" : $"mail:{p.Email.Trim().ToLowerInvariant()}", StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(p => p.Name, NameOrder)
            .ThenBy(p => p.Email, StringComparer.OrdinalIgnoreCase)];

        var answeredEmails = answered
            .Where(p => p.Email is not null)
            .Select(p => p.Email!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.CompanyId == survey.CompanyId && u.IsActive && u.Email != "")
            .Select(u => new { u.Name, u.Email })
            .ToListAsync(cancellationToken);
        users = [.. users.OrderBy(u => u.Name, NameOrder).ThenBy(u => u.Email, StringComparer.OrdinalIgnoreCase)];

        var pending = users
            .Where(u => !string.IsNullOrWhiteSpace(u.Email) && !answeredEmails.Contains(u.Email.Trim()))
            .Select(u => new SurveyPendingParticipantRow(u.Name, u.Email))
            .ToList();

        return Results.Ok(new SurveyParticipationView(
            survey.Id,
            // What the respond flow ACTUALLY does, not what the survey was authored to do.
            // Reading the stored column here reported "this survey collects who answered"
            // beside an answered list that the 2026-10-13 ruling guarantees is empty -- the
            // column survives so the ruling is one line to revert, but it is not something
            // an administrator should be shown as though it were still in force.
            SurveyResponsePrivacy.CollectsParticipantIdentity(survey.CollectParticipantIdentity),
            answered.Count,
            pending.Count,
            answered,
            pending));
    }
}
