using System.Globalization;
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>GET /surveys/{id}/participation</c>: who has answered, who started and stopped, and who
/// has not opened it at all.
/// </summary>
/// <remarks>
/// <para>
/// Ruled 2026-10-12: "collect name and email because we need to know who has answered and who
/// has not, but DON'T link them to their answers." Nothing here is an answer. What this reads
/// from <c>responses</c> is three columns -- <c>user_id</c>, <c>is_complete</c> and the day --
/// and never <c>question_responses</c>, so there is no answer in the shape to filter out.
/// </para>
/// <para>
/// Administrators only: <see cref="SurveyEndpoints.CanAdminister"/>, a super_admin or the
/// company_admin of the survey's own company. A list of named people is personal data even
/// without answers attached, so a department admin, a leader and an employee are refused, and
/// so is another tenant's admin. The demographics on each row raise the stakes of that rule,
/// not the rule itself: they are the spreadsheet the same administrator uploaded.
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
            .Select(s => new { s.Id, s.CompanyId, s.Settings.CollectParticipantIdentity, s.Settings.Anonymous })
            .FirstOrDefaultAsync(cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId))
        {
            return Results.Forbid();
        }

        var roster = await BuildRosterAsync(survey.Id, survey.CompanyId, survey.Anonymous, db, cancellationToken);

        // Respondents with NO account. `survey_participations` is written only for them
        // (`participation-is-not-linked-to-answers.md`), and the 2026-10-13 identity ruling
        // switched off the step that fed it -- so on a mass invite this is empty and the whole
        // answer comes from the roster. It stays because a public-link survey still fills it.
        var accountless = await db.SurveyParticipations
            .AsNoTracking()
            .Where(p => p.SurveyId == survey.Id && p.CompanyId == survey.CompanyId)
            .Select(p => new SurveyParticipantRow(p.Name, p.Email, p.ParticipatedOn))
            .ToListAsync(cancellationToken);

        var accountlessEmails = accountless
            .Where(p => p.Email is not null)
            .Select(p => p.Email!.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // `Answered` and `Pending` are PROJECTIONS of the roster, computed in this same pass,
        // so the Participación panel and the roster screen cannot disagree about who answered.
        var answered = accountless
            .Concat(roster
                .Where(row => row.Status == SurveyParticipantStatuses.Completed)
                .Where(row => !string.IsNullOrWhiteSpace(row.Name))
                .Select(row => new SurveyParticipantRow(
                    row.Name,
                    string.IsNullOrWhiteSpace(row.Email) ? null : row.Email,
                    row.LastActivityOn ?? DateOnly.FromDateTime(DateTime.UtcNow))))
            .GroupBy(p => p.Email is null ? $"name:{p.Name}" : $"mail:{p.Email.Trim().ToLowerInvariant()}", StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(p => p.Name, NameOrder)
            .ThenBy(p => p.Email, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var pending = roster
            .Where(row => row.Status != SurveyParticipantStatuses.Completed)
            .Where(row => !accountlessEmails.Contains(row.Email.Trim()))
            .Select(row => new SurveyPendingParticipantRow(row.Name, row.Email))
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
            pending,
            roster.Count(row => row.Status == SurveyParticipantStatuses.Started),
            roster.Count(row => row.Status == SurveyParticipantStatuses.NotStarted),
            roster,
            // An anonymous survey writes no user id, so a HALF-finished response belongs to
            // nobody and `started` is unknowable. Saying so is the difference between "nobody
            // answered" and "nobody is counted".
            !survey.Anonymous,
            // COMPLETION is a different question, and the answer is yes even there: it is
            // recorded in survey_participations, apart from the answers, with nothing to join
            // them by. So the screen still shows who has finished and who has not.
            survey.Anonymous));
    }

    /// <summary>
    /// Every active account in the company that can be invited, with where it stands on this
    /// survey and the demographics it was imported with.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The state comes from <c>responses</c> and not from <c>survey_invitations.status</c>.
    /// That column's <c>started</c> is written only by <c>RecordStateAsync</c>, which loads the
    /// invitation BY TOKEN -- a mass-invite respondent signs in with a username and never
    /// passes through it, so the column would report nobody as having started however many
    /// people were halfway through. A response row is the thing that actually exists.
    /// </para>
    /// <para>
    /// An ANONYMOUS survey writes no <c>user_id</c>, so every row comes back
    /// <c>not_started</c> rather than being guarded by a flag that could be read from the
    /// wrong column. It fails closed on absent data, which is the same property the answered
    /// list relies on.
    /// </para>
    /// </remarks>
    private static async Task<List<SurveyRosterRow>> BuildRosterAsync(
        Guid surveyId,
        Guid companyId,
        bool anonymous,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.CompanyId == companyId && u.IsActive && u.Email != "")
            .Select(u => new { u.Id, u.Name, u.Email, u.Username, u.Role })
            .ToListAsync(cancellationToken);

        if (users.Count == 0)
        {
            return [];
        }

        var responses = await db.Responses
            .AsNoTracking()
            .Where(r => r.SurveyId == surveyId && r.UserId != null)
            .Select(r => new { UserId = r.UserId!.Value, r.IsComplete, r.CompletionTime, r.UpdatedAt })
            .ToListAsync(cancellationToken);

        // One person can hold more than one row only in the states the respond flow allows --
        // a partial plus the completion that replaced it. Complete wins, and among complete
        // rows the earliest day stands, which is the same rule `Advances` applies to an
        // invitation: the first completion is the one that happened.
        var stateByUser = responses
            .GroupBy(r => r.UserId)
            .ToDictionary(
                group => group.Key,
                group =>
                {
                    var complete = group.Where(r => r.IsComplete).ToList();
                    if (complete.Count > 0)
                    {
                        var day = complete.Min(r => r.CompletionTime ?? r.UpdatedAt);
                        return (Status: SurveyParticipantStatuses.Completed, Day: (DateOnly?)DayOf(day));
                    }

                    return (Status: SurveyParticipantStatuses.Started, Day: (DateOnly?)DayOf(group.Max(r => r.UpdatedAt)));
                });

        // Completion recorded APART from the answers.
        //
        // `survey_participations` holds a name, an email and a calendar day -- no response id,
        // no session id, no timestamp -- so there is nothing to join it to an answer by. That
        // is what lets an ANONYMOUS survey still say who finished: the answers carry no user
        // id and never will, and this table carries no answers and never will. It is the
        // storage shape the 2026-10-12 ruling asked for in so many words -- "we need to know
        // who has answered and who has not, but DON'T link them to their answers" -- and the
        // respondent copy promises exactly it: *registramos que usted respondió, nunca qué
        // respondió*.
        //
        // Matched by email because that is the key the table carries and the one its unique
        // index is built on; a resend cannot change it, while a username can be regenerated.
        var participations = await db.SurveyParticipations
            .AsNoTracking()
            .Where(p => p.SurveyId == surveyId && p.Email != null)
            .Select(p => new { Email = p.Email!, p.ParticipatedOn })
            .ToListAsync(cancellationToken);

        var completedOn = participations
            .GroupBy(p => p.Email, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                // The earliest day stands, the same rule the response path applies: the first
                // completion is the one that happened.
                group => group.Min(p => p.ParticipatedOn),
                StringComparer.OrdinalIgnoreCase);

        var demographics = await db.UserDemographics
            .AsNoTracking()
            .Where(d => db.Users.Any(u => u.Id == d.UserId && u.CompanyId == companyId))
            .Join(
                db.DemographicFields.AsNoTracking().Where(f => f.CompanyId == companyId),
                value => value.DemographicFieldId,
                field => field.Id,
                (value, field) => new { value.UserId, field.Field, field.LabelEn, field.LabelEs, field.Order, value.Value })
            .ToListAsync(cancellationToken);

        var demographicsByUser = demographics
            .GroupBy(d => d.UserId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<SurveyRosterDemographic>)[.. group
                    .OrderBy(d => d.Order)
                    .ThenBy(d => d.Field, StringComparer.Ordinal)
                    .Select(d => new SurveyRosterDemographic(d.Field, d.LabelEn, d.LabelEs, d.Value))]);

        return
        [
            .. users
                .Select(u =>
                {
                    // A user id on an answer is the richest source -- it separates "stopped
                    // halfway" from "never opened". Failing that, a participation row still
                    // settles the question the administrator actually asks on launch day.
                    var state = stateByUser.TryGetValue(u.Id, out var found)
                        ? found
                        : completedOn.TryGetValue(u.Email, out var participatedOn)
                            ? (Status: SurveyParticipantStatuses.Completed, Day: (DateOnly?)participatedOn)
                            // `not_started` would be a claim this survey cannot support: with
                            // no user id on the answers, somebody halfway through is
                            // indistinguishable from somebody who never opened it.
                            : anonymous
                                ? (Status: SurveyParticipantStatuses.NotCompleted, Day: (DateOnly?)null)
                                : (Status: SurveyParticipantStatuses.NotStarted, Day: (DateOnly?)null);
                    return new SurveyRosterRow(
                        u.Id,
                        u.Name,
                        u.Email,
                        u.Username,
                        u.Role,
                        state.Status,
                        state.Day,
                        demographicsByUser.TryGetValue(u.Id, out var own) ? own : []);
                })
                .OrderBy(row => row.Name, NameOrder)
                .ThenBy(row => row.Email, StringComparer.OrdinalIgnoreCase),
        ];
    }

    /// <summary>
    /// The DAY, never the instant. The stored rows carry a day in the COMPANY's zone and these
    /// are UTC, so the two can differ by one at a boundary; neither this screen nor its
    /// question ("has this person answered") turns on which day it was, and inventing a zone
    /// neither the survey nor the company stores would be worse than saying so.
    /// </summary>
    private static DateOnly DayOf(DateTimeOffset moment) => DateOnly.FromDateTime(moment.UtcDateTime);
}
