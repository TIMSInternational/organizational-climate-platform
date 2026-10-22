using System.Globalization;
using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
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
/// from <c>responses</c> is four columns -- <c>user_id</c>, <c>session_id</c>,
/// <c>is_complete</c> and the day -- and never <c>question_responses</c>, so there is no answer
/// in the shape to filter out. <c>session_id</c> joined the list on 2026-10-15 and is how an
/// anonymous survey reports a half-finished response; <see cref="SurveyResumeSession"/> carries
/// why reading it adds nothing that resuming had not already spent.
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
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys
            .AsNoTracking()
            .Where(s => s.Id == surveyId)
            .Select(s => new
            {
                s.Id,
                s.CompanyId,
                s.Settings.CollectParticipantIdentity,
                s.Settings.Anonymous,
                s.Settings.CredentialMode,
                s.TitleEn,
                s.TitleEs,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId))
        {
            return Results.Forbid();
        }

        // The key an anonymous survey's partials are findable by. Null only where none is
        // configured, which no running environment is: `TrackingJwtSecret` is required for the
        // API to start.
        var resumeKey = SurveyResumeSessionConfiguration.KeyFrom(configuration);
        var (roster, signInOnly) = await BuildRosterAsync(
            survey.Id, survey.CompanyId, survey.Anonymous, resumeKey, db, cancellationToken);

        // Per-survey keys: who was mailed one and who has used it. Added HERE and not in
        // `BuildRosterAsync`, which the status-report export shares -- that sheet is about
        // answering, and a key's days are not something it was ever asked to carry.
        var credentialMode = survey.CredentialMode ?? CredentialModes.Shared;
        if (credentialMode == CredentialModes.PerSurvey && roster.Count > 0)
        {
            roster = await WithSurveyKeysAsync(roster, survey.Id, survey.CompanyId, db, cancellationToken);
        }

        // Three states for a survey whose answers carry a user id, and for an anonymous one
        // that can only be answered by signing in. `BuildRosterAsync` decides the second from
        // the data rather than from a setting -- see the reasoning on `signInOnly` there.
        var distinguishesStarted = !survey.Anonymous || signInOnly;

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
            // All three states, on an anonymous survey too, and the reason is the derived
            // session id rather than a user id: see `SurveyResumeSession`. False only where no
            // resume key is configured at all, when a stopped respondent really is
            // indistinguishable from an absent one and the screen must not claim otherwise.
            distinguishesStarted,
            // COMPLETION alone, which is all an anonymous survey could report before and is
            // still what it reports when there is no key.
            survey.Anonymous && !distinguishesStarted,
            credentialMode,
            survey.TitleEn,
            survey.TitleEs));
    }

    /// <summary>
    /// Each row with its survey key: the username it signs in with, the day the key now in force
    /// was mailed, and the day it was last used -- days in the company's zone, never instants
    /// (see <see cref="SurveyRosterRow"/>). A person with no key keeps three nulls, which the
    /// screen reads as "Sin código".
    /// </summary>
    private static async Task<List<SurveyRosterRow>> WithSurveyKeysAsync(
        List<SurveyRosterRow> roster,
        Guid surveyId,
        Guid companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var keys = await db.SurveyCredentials
            .AsNoTracking()
            .Where(c => c.SurveyId == surveyId)
            .Select(c => new { c.UserId, c.Username, c.CreatedAt, c.LastSignInAt })
            .ToDictionaryAsync(c => c.UserId, cancellationToken);
        if (keys.Count == 0)
        {
            return roster;
        }

        var zone = SchedulingTimeZone.Resolve(await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.Timezone)
            .FirstOrDefaultAsync(cancellationToken));
        DateOnly LocalDay(DateTimeOffset moment) => DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(moment, zone));

        return
        [
            .. roster.Select(row => keys.TryGetValue(row.UserId, out var key)
                ? row with
                {
                    SurveyUsername = key.Username,
                    CredentialIssuedOn = LocalDay(key.CreatedAt),
                    LastSignInOn = key.LastSignInAt is { } signedIn ? LocalDay(signedIn) : null,
                }
                : row),
        ];
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
    /// An ANONYMOUS survey writes no <c>user_id</c>, so for one the state comes from the
    /// DERIVED session id instead (<see cref="SurveyResumeSession"/>) -- the same id the
    /// respond flow resumes by, computed per person and looked up in <c>responses.session_id</c>.
    /// Both paths read a row's existence and its <c>is_complete</c>, never an answer, and both
    /// fail closed on absent data: a person with no row is reported as not having started, not
    /// as having scored nothing.
    /// </para>
    /// <para>
    /// With no resume key configured there is no derived id to look up, and then an anonymous
    /// survey genuinely cannot tell a stopped respondent from an absent one. It reports
    /// <see cref="SurveyParticipantStatuses.NotCompleted"/> and the view's
    /// <c>TracksIndividuals</c> is false, so the screen does not render a state it does not
    /// have. No deployed environment is in that position -- <c>TrackingJwtSecret</c> is
    /// required for the API to start -- but a test can be, and the honest answer is cheap.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Internal rather than private so <see cref="ResponseExportEndpoints"/> can put the same
    /// roster in its PENDIENTES sheet. Shared, not copied: "who has not answered" is the one
    /// question the morning and afternoon status reports are about, and two derivations of it
    /// would eventually disagree about somebody.
    /// </summary>
    internal static async Task<(List<SurveyRosterRow> Rows, bool SignInOnly)> BuildRosterAsync(
        Guid surveyId,
        Guid companyId,
        bool anonymous,
        string? resumeKey,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        // THE SURVEY'S AUDIENCE, not the company's payroll.
        //
        // This listed every active account in the tenant, whatever the survey was aimed at.
        // On a survey targeted at 240 people in a 642-person company that is 402 rows reading
        // "no iniciada" for people who cannot see it, were never invited and are not expected
        // to answer -- on the one screen an administrator opens to decide whom to chase, and
        // in the PENDIENTES sheet of the status-report export, which reuses this method
        // (`ResponseExportEndpoints`). It was wrong for department targets too, so it
        // predates per-person targeting rather than arriving with it.
        //
        // `SurveyQueries.Audience` is the same rule `/surveys/my`, the respond gate and the
        // invitation resolver apply, so the roster cannot name somebody the survey does not
        // reach. An untargeted survey is company-wide and this is unchanged for it.
        var users = await SurveyQueries
            .Audience(db.Users.AsNoTracking(), db.SurveyDepartmentTargets, db.SurveyUserTargets, surveyId, companyId)
            .Where(u => u.Email != "")
            .Select(u => new { u.Id, u.Name, u.Email, u.Username, u.Role })
            .ToListAsync(cancellationToken);

        if (users.Count == 0)
        {
            return ([], false);
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

        // Every account's derived id, computed once. 800 HMACs is microseconds, and the set is
        // needed as a whole for the attributability test below, not just per person.
        var derivedIdByUser = anonymous && resumeKey is not null
            ? users
                .Select(u => (u.Id, Derived: SurveyResumeSession.IdFor(surveyId, u.Id, resumeKey)))
                .Where(pair => pair.Derived is not null)
                .ToDictionary(pair => pair.Id, pair => pair.Derived!)
            : [];
        var derivedIds = derivedIdByUser.Values.ToHashSet(StringComparer.Ordinal);

        // The same question `stateByUser` answers, for a survey whose answers carry no user id.
        //
        // An anonymous partial is written with `session_id` = the DERIVED id
        // (`SurveyResumeSession`), which is how a respondent resumes on a second device. So the
        // rows are findable per person by computing that id -- and that is all this does: it
        // reads `session_id`, `is_complete` and a day. No answer, no score, no text. It is
        // strictly less than the respond flow already does with the same id, which finds the
        // row and hands its answers back.
        //
        // Before this, every anonymous row that had no participation record came back
        // `not_completed`, collapsing "never opened it" into "was interrupted" -- and those
        // call for opposite actions, which is the distinction the client asked for by name:
        // *"quiénes fueron invitados y todavía no han ingresado. Quiénes lo han comenzado pero
        // no lo han terminado."*
        var anonymousStateBySession = anonymous && resumeKey is not null
            ? (await db.Responses
                    .AsNoTracking()
                    .Where(r => r.SurveyId == surveyId && r.UserId == null && r.SessionId != null)
                    .Select(r => new { SessionId = r.SessionId!, r.IsComplete, r.CompletionTime, r.UpdatedAt })
                    .ToListAsync(cancellationToken))
                .GroupBy(r => r.SessionId, StringComparer.Ordinal)
                // Byte for byte the rule `stateByUser` applies above: complete wins, and among
                // complete rows the earliest day stands, because the first completion is the
                // one that happened.
                .ToDictionary(
                    group => group.Key,
                    group =>
                    {
                        var complete = group.Where(r => r.IsComplete).ToList();
                        return complete.Count > 0
                            ? (Status: SurveyParticipantStatuses.Completed,
                               Day: (DateOnly?)DayOf(complete.Min(r => r.CompletionTime ?? r.UpdatedAt)))
                            : (Status: SurveyParticipantStatuses.Started,
                               Day: (DateOnly?)DayOf(group.Max(r => r.UpdatedAt)));
                    },
                    StringComparer.Ordinal)
            : new Dictionary<string, (string Status, DateOnly? Day)>(StringComparer.Ordinal);

        // WHETHER `not_started` MAY BE CLAIMED AT ALL, which is a different question from
        // whether a partial can be found.
        //
        // A QR or public-link respondent signs in to nothing. Their response carries a random
        // session id that matches no account's derived id, so an account with no row of its own
        // might BE one of them -- and reporting "never opened it" would invent the one fact an
        // anonymous survey cannot have. A row we cannot attribute is exactly the signal that
        // this survey is answerable without signing in.
        //
        // So the three states are offered only when every anonymous row on the survey is one we
        // can attribute. Otherwise the roster falls back whole to the two states it served
        // before -- not a mixture, because a `started` row with no `not_started` beside it is a
        // filter set the screen cannot render coherently.
        //
        // It is self-correcting rather than a setting: a mass invite with nobody answering yet
        // has no unattributable rows and offers three states, and the moment somebody answers
        // through a link the roster drops back to two.
        var signInOnly = anonymous
            && resumeKey is not null
            && anonymousStateBySession.Keys.All(derivedIds.Contains);

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

        return (Rows:
        [
            .. users
                .Select(u =>
                {
                    // A user id on an answer is the richest source -- it separates "stopped
                    // halfway" from "never opened". Failing that, a participation row still
                    // settles the question the administrator actually asks on launch day.
                    // Richest source first. A user id on an answer separates every state
                    // outright; a participation row settles completion for somebody whose
                    // answers carry none; the derived session id settles the rest.
                    var state = stateByUser.TryGetValue(u.Id, out var found)
                        ? found
                        : completedOn.TryGetValue(u.Email, out var participatedOn)
                            ? (Status: SurveyParticipantStatuses.Completed, Day: (DateOnly?)participatedOn)
                            : AnonymousStateFor(u.Id) is { } derived
                                ? derived
                                // No row of any kind. On a sign-in-only survey that IS "never
                                // opened it", because the only way in leaves a row we can find.
                                // Anywhere else it is merely "has not finished".
                                : anonymous && !signInOnly
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
        ], SignInOnly: signInOnly);

        // This person's state on an anonymous survey, or null when they have no row we can
        // attribute. Returns null outright unless the survey is sign-in-only, so the fallback
        // to the old two states is whole rather than a mixture.
        (string Status, DateOnly? Day)? AnonymousStateFor(Guid userId)
            => signInOnly
                && derivedIdByUser.TryGetValue(userId, out var derivedId)
                && anonymousStateBySession.TryGetValue(derivedId, out var state)
                    ? state
                    : null;
    }

    /// <summary>
    /// The DAY, never the instant. The stored rows carry a day in the COMPANY's zone and these
    /// are UTC, so the two can differ by one at a boundary; neither this screen nor its
    /// question ("has this person answered") turns on which day it was, and inventing a zone
    /// neither the survey nor the company stores would be worse than saying so.
    /// </summary>
    private static DateOnly DayOf(DateTimeOffset moment) => DateOnly.FromDateTime(moment.UtcDateTime);
}
