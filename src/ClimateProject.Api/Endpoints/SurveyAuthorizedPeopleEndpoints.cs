using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>One address on a survey's authorized list, as an editor reads it.</summary>
/// <param name="AddedByName">Who added it, or null once that account is gone (or it was never known).</param>
public sealed record SurveyAuthorizedPersonDto(
    Guid Id, string Email, string? DisplayName, DateTimeOffset AddedAt, Guid? AddedBy, string? AddedByName);

/// <param name="Editable">Whether THIS caller may change the list now (see the routes' remarks).</param>
/// <param name="LockReason">Null when editable; else the refusal code a write would get.</param>
public sealed record SurveyAuthorizedListView(
    Guid SurveyId, int Count, bool Editable, string? LockReason, IReadOnlyList<SurveyAuthorizedPersonDto> People);

public sealed record AddSurveyAuthorizedPersonRequest(string? Email, string? DisplayName = null);

public sealed record SurveyAuthorizedEntryInput(string? Email, string? DisplayName = null);

/// <param name="Replace">
/// True: the list becomes exactly these addresses (rows already on it are kept as they were, with
/// who added them and when; the others are removed). False: these are added to it.
/// </param>
public sealed record BulkSurveyAuthorizedPeopleRequest(IReadOnlyList<SurveyAuthorizedEntryInput>? Entries, bool Replace = false);

/// <param name="Added">Addresses written by this call.</param>
/// <param name="AlreadyOnList">Addresses in the paste that the list already held; left untouched.</param>
/// <param name="DuplicatesInPaste">Addresses that appeared more than once in the paste; the first one counted.</param>
/// <param name="Removed">Addresses a replace took off the list.</param>
public sealed record BulkSurveyAuthorizedPeopleResult(
    IReadOnlyList<string> Added,
    IReadOnlyList<string> AlreadyOnList,
    IReadOnlyList<string> DuplicatesInPaste,
    IReadOnlyList<string> Removed,
    SurveyAuthorizedListView List);

/// <summary>
/// «Lista autorizada del cliente» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>,
/// ruling 3): the routes over <c>survey_authorized_people</c>. The guard every send obeys is
/// <see cref="SurveyAuthorizedListGuard"/>.
/// </summary>
/// <remarks>
/// <para><b>Routes.</b> <c>GET /surveys/{surveyId}/authorized-people</c> (whoever administers the
/// survey); <c>POST</c> on it adds one address; <c>POST …/bulk</c> adds or replaces from a pasted
/// column; <c>DELETE …/{personId}</c> removes one.</para>
///
/// <para><b>Who writes.</b> Whoever administers the survey (<c>SurveyEndpoints.CanAdminister</c>:
/// a super admin, or a company admin of its company -- 403 otherwise); a company admin while it is
/// draft, scheduled or active; a super admin in any status but archived; archived is 409 for
/// everybody. The same rule as the survey's respondent texts
/// (<see cref="RespondentContentPermissions.SurveyLock"/>), on purpose: both are what TIMS fixes on
/// a live survey for a client.</para>
///
/// <para><b>Recorded.</b> Each row keeps who added it and when (<c>added_by</c>, <c>added_at</c>),
/// which is the ruling's "which records who added them and when". Every write is audited and filed
/// under the survey's company -- a TIMS operator has none of their own and would otherwise write no
/// audit row.</para>
///
/// <para><b>An empty list is no list.</b> Removing the last address turns the guard off, which is
/// the ruling ("no list = today's behaviour"). A pasted list must hold at least one address and no
/// entry that is not one, or nothing is written: a paste that went wrong must not empty the list
/// and switch the guard off in passing.</para>
///
/// <para><b>Not copied by «Duplicar».</b> The list is people the client named for THIS survey;
/// a copy starts without one (asserted by <c>SurveyAuthorizedListTests</c>).</para>
/// </remarks>
public static class SurveyAuthorizedPeopleEndpoints
{
    /// <summary>The most addresses one paste may carry: ESPH's population was 617.</summary>
    public const int MaxBulkEntries = 5000;

    public static void MapSurveyAuthorizedPeopleEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        var surveys = app.MapGroup("/surveys").RequireAuthorization();
        surveys.MapGet("/{surveyId:guid}/authorized-people", GetAsync);
        surveys.MapPost("/{surveyId:guid}/authorized-people", AddAsync);
        surveys.MapPost("/{surveyId:guid}/authorized-people/bulk", BulkAsync);
        surveys.MapDelete("/{surveyId:guid}/authorized-people/{personId:guid}", RemoveAsync);
    }

    private static async Task<IResult> GetAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return SurveyNotFound();
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ViewAsync(db, survey, currentUser.Role, cancellationToken));
    }

    private static async Task<IResult> AddAsync(
        Guid surveyId,
        AddSurveyAuthorizedPersonRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (survey, actorId, refusal) = await AuthorizeWriteAsync(surveyId, principal, db, audit, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var email = Normalise(request.Email);
        if (email is null)
        {
            return Results.Json(
                new { message = "That is not an email address.", code = AdminRefusals.SurveyAuthorizedEmailInvalid },
                statusCode: 400);
        }

        if (await db.SurveyAuthorizedPeople.AnyAsync(p => p.SurveyId == survey!.Id && p.Email == email, cancellationToken))
        {
            return Results.Json(
                new { message = $"{email} is already on this survey's authorized list.", code = AdminRefusals.SurveyAuthorizedEmailDuplicate, email },
                statusCode: 409);
        }

        var person = new SurveyAuthorizedPerson
        {
            Id = Guid.NewGuid(),
            SurveyId = survey!.Id,
            Email = email,
            DisplayName = CleanName(request.DisplayName),
            AddedBy = actorId,
            AddedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyAuthorizedPeople.Add(person);
        await db.SaveChangesAsync(cancellationToken);

        audit.RecordChange("authorizedPerson", null, email);

        var currentUser = principal.GetCurrentUser();
        var view = await ViewAsync(db, survey, currentUser.Role, cancellationToken);
        return Results.Json(view.People.Single(p => p.Id == person.Id), statusCode: 201);
    }

    private static async Task<IResult> BulkAsync(
        Guid surveyId,
        BulkSurveyAuthorizedPeopleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (survey, actorId, refusal) = await AuthorizeWriteAsync(surveyId, principal, db, audit, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        // Everything checked before the first write.
        var entries = request.Entries ?? [];
        if (entries.Count > MaxBulkEntries)
        {
            return Results.Json(
                new { message = $"Paste at most {MaxBulkEntries} addresses at a time; this has {entries.Count}.", code = AdminRefusals.SurveyAuthorizedListInvalid, invalid = Array.Empty<string>() },
                statusCode: 400);
        }

        var invalid = new List<string>();
        var duplicatesInPaste = new List<string>();
        var wanted = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            var email = Normalise(entry.Email);
            if (email is null)
            {
                invalid.Add((entry.Email ?? string.Empty).Trim());
                continue;
            }

            if (!wanted.TryAdd(email, CleanName(entry.DisplayName)))
            {
                duplicatesInPaste.Add(email);
            }
        }

        if (invalid.Count > 0 || wanted.Count == 0)
        {
            return Results.Json(
                new
                {
                    message = wanted.Count == 0 && invalid.Count == 0
                        ? "The pasted list holds no address. Nothing was changed."
                        : $"{invalid.Count} of the pasted entries are not email addresses. Nothing was changed.",
                    code = AdminRefusals.SurveyAuthorizedListInvalid,
                    invalid,
                },
                statusCode: 400);
        }

        var existing = await db.SurveyAuthorizedPeople
            .Where(p => p.SurveyId == survey!.Id)
            .ToListAsync(cancellationToken);
        var existingEmails = existing.Select(p => p.Email).ToHashSet(StringComparer.Ordinal);

        var now = DateTimeOffset.UtcNow;
        var added = new List<string>();
        var alreadyOnList = new List<string>();
        foreach (var (email, name) in wanted)
        {
            if (existingEmails.Contains(email))
            {
                alreadyOnList.Add(email);
                continue;
            }

            db.SurveyAuthorizedPeople.Add(new SurveyAuthorizedPerson
            {
                Id = Guid.NewGuid(),
                SurveyId = survey!.Id,
                Email = email,
                DisplayName = name,
                AddedBy = actorId,
                AddedAt = now,
            });
            added.Add(email);
        }

        var removed = new List<string>();
        if (request.Replace)
        {
            foreach (var row in existing.Where(p => !wanted.ContainsKey(p.Email)))
            {
                db.SurveyAuthorizedPeople.Remove(row);
                removed.Add(row.Email);
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        audit.RecordChange("authorizedPeople.added", null, added.Count.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (request.Replace)
        {
            audit.RecordChange("authorizedPeople.removed", null, removed.Count.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        static List<string> Sorted(IEnumerable<string> values) => [.. values.Order(StringComparer.Ordinal)];

        return Results.Ok(new BulkSurveyAuthorizedPeopleResult(
            Sorted(added),
            Sorted(alreadyOnList),
            Sorted(duplicatesInPaste.Distinct(StringComparer.Ordinal)),
            Sorted(removed),
            await ViewAsync(db, survey!, principal.GetCurrentUser().Role, cancellationToken)));
    }

    private static async Task<IResult> RemoveAsync(
        Guid surveyId,
        Guid personId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (survey, _, refusal) = await AuthorizeWriteAsync(surveyId, principal, db, audit, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var row = await db.SurveyAuthorizedPeople
            .FirstOrDefaultAsync(p => p.Id == personId && p.SurveyId == survey!.Id, cancellationToken);
        if (row is null)
        {
            return Results.Json(new { message = "That address is not on this survey's authorized list." }, statusCode: 404);
        }

        db.SurveyAuthorizedPeople.Remove(row);
        await db.SaveChangesAsync(cancellationToken);

        audit.RecordChange("authorizedPerson", row.Email, null);
        return Results.NoContent();
    }

    // ------------------------------------------------------------------

    /// <summary>
    /// The survey, the acting user and nothing else -- or the refusal. The audit row is filed under
    /// the survey's company before any status refusal, so a refused write is on the trail too.
    /// </summary>
    private static async Task<(Survey? Survey, Guid? ActorId, IResult? Refusal)> AuthorizeWriteAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return (null, null, SurveyNotFound());
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return (null, null, Results.Forbid());
        }

        var actorId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actorId is { } actor)
        {
            audit.AttributeTo(actor, survey.CompanyId);
        }

        audit.SetResourceId(survey.Id);

        var lockReason = LockReason(currentUser.Role, survey.Status);
        if (lockReason is not null)
        {
            var message = lockReason == AdminRefusals.SurveyAuthorizedListArchived
                ? "An archived survey's authorized list cannot be changed."
                : "This survey is no longer draft, scheduled or active, so only a TIMS super administrator can change its authorized list.";
            return (null, null, Results.Json(new { message, code = lockReason }, statusCode: 409));
        }

        return (survey, actorId, null);
    }

    private static string? LockReason(string? role, string? status)
        => RespondentContentPermissions.SurveyLock(role, status) switch
        {
            RespondentContentSurveyLock.Archived => AdminRefusals.SurveyAuthorizedListArchived,
            RespondentContentSurveyLock.Locked => AdminRefusals.SurveyAuthorizedListLocked,
            _ => null,
        };

    private static async Task<SurveyAuthorizedListView> ViewAsync(
        ClimateProjectDbContext db, Survey survey, string? role, CancellationToken cancellationToken)
    {
        var people = await db.SurveyAuthorizedPeople
            .AsNoTracking()
            .Where(p => p.SurveyId == survey.Id)
            .OrderBy(p => p.Email)
            .Select(p => new SurveyAuthorizedPersonDto(
                p.Id,
                p.Email,
                p.DisplayName,
                p.AddedAt,
                p.AddedBy,
                db.Users.Where(u => u.Id == p.AddedBy).Select(u => u.Name).FirstOrDefault()))
            .ToListAsync(cancellationToken);
        var lockReason = LockReason(role, survey.Status);
        return new SurveyAuthorizedListView(survey.Id, people.Count, lockReason is null, lockReason, people);
    }

    /// <summary>
    /// The stored form of a typed or pasted address, or null when it is not one: one local part,
    /// one '@', a domain with a dot, no whitespace inside, within the column's width.
    /// </summary>
    internal static string? Normalise(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var value = SurveyAuthorizedPerson.NormaliseEmail(email);
        if (value.Length > SurveyAuthorizedPersonConfiguration.EmailMaxLength || value.Any(char.IsWhiteSpace))
        {
            return null;
        }

        var at = value.IndexOf('@', StringComparison.Ordinal);
        if (at <= 0 || at != value.LastIndexOf('@'))
        {
            return null;
        }

        var domain = value[(at + 1)..];
        var dot = domain.LastIndexOf('.');
        return dot > 0 && dot < domain.Length - 1 ? value : null;
    }

    private static string? CleanName(string? name)
    {
        var collapsed = string.Join(' ', (name ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (collapsed.Length == 0)
        {
            return null;
        }

        return collapsed.Length > SurveyAuthorizedPersonConfiguration.DisplayNameMaxLength
            ? collapsed[..SurveyAuthorizedPersonConfiguration.DisplayNameMaxLength]
            : collapsed;
    }

    private static IResult SurveyNotFound() => Results.Json(new { message = "Survey not found" }, statusCode: 404);
}
