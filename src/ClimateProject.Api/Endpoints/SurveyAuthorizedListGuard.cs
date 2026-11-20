using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>One person a send would reach who is not on the survey's authorized list.</summary>
public sealed record SurveyRecipientNotAuthorized(Guid UserId, string Email, string? Name);

/// <summary>
/// THE guard of «Lista autorizada del cliente» (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>, ruling 3): while a survey has a
/// non-empty list, every survey-targeted send, resend, reissue or reminder that would reach
/// anybody whose address is not on it is refused -- 409 <see cref="AdminRefusals.SurveyRecipientNotAuthorized"/>,
/// naming each of them -- and an empty list is today's behaviour exactly.
/// </summary>
/// <remarks>
/// <para><b>Why it exists.</b> 28 Oct 2026: a client asked for 3 re-sends and 11 went out; the 8
/// extra were people the client never named. The audience is not the population (ESPH Clima:
/// audience 633, list 617), so a guard that asks "is this person in the audience?" answers yes for
/// exactly the people who must not be mailed. This asks the only question that separates them:
/// "is this ADDRESS on the client's list?" (CLAUDE.md, "Never send anything to someone the client
/// did not name").</para>
///
/// <para><b>Called first, before the handler's first write.</b> Credentials and personal-link
/// tokens are minted before their mail goes, so a guard that ran at the send would leave a key
/// or a rotated token behind for somebody who was never mailed. Every caller runs this before it
/// mints, hashes, rotates, stamps or sends.</para>
///
/// <para><b>Whole, never trimmed.</b> A bulk send with one outsider is refused whole, naming
/// them; the client widens the list first. Dropping them in silence would read as done when it
/// is not -- the shape <c>personal_link_not_in_audience</c> already has.</para>
///
/// <para><b>Matched on the address the mail would go to</b> -- the account's email now,
/// normalised as the list stores it (<see cref="SurveyAuthorizedPerson.NormaliseEmail"/>) -- and
/// only among the survey's own company's accounts, so a caller cannot learn another tenant's
/// address by naming its id: those ids are left to the handler's own not-found refusal.</para>
/// </remarks>
internal static class SurveyAuthorizedListGuard
{
    /// <summary>
    /// Null when the send may go ahead (no list, or everybody on it); otherwise the 409 to return.
    /// </summary>
    public static async Task<IResult?> RefuseOutsidersAsync(
        ClimateProjectDbContext db,
        Survey survey,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        var outsiders = await OutsidersAsync(db, survey, userIds, cancellationToken);
        if (outsiders.Count == 0)
        {
            return null;
        }

        return Results.Json(
            new
            {
                message = $"{outsiders.Count} of the people this would reach are not on the client's authorized list for this survey: "
                          + string.Join(", ", outsiders.Select(o => o.Email))
                          + ". Nothing was sent. Add them to the list first, or leave them out.",
                code = AdminRefusals.SurveyRecipientNotAuthorized,
                notAuthorized = outsiders,
            },
            statusCode: 409);
    }

    /// <summary>
    /// The people among <paramref name="userIds"/> (of the survey's company) whose address is not
    /// on its list, ordered by address. Empty when the survey has no list at all.
    /// </summary>
    public static async Task<IReadOnlyList<SurveyRecipientNotAuthorized>> OutsidersAsync(
        ClimateProjectDbContext db,
        Survey survey,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(survey);
        ArgumentNullException.ThrowIfNull(userIds);

        if (userIds.Count == 0
            || !await db.SurveyAuthorizedPeople.AnyAsync(p => p.SurveyId == survey.Id, cancellationToken))
        {
            return [];
        }

        var ids = userIds.Distinct().ToList();
        var people = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.CompanyId == survey.CompanyId)
            .Select(u => new { u.Id, u.Email, u.Name })
            .ToListAsync(cancellationToken);

        var addresses = people.Select(p => SurveyAuthorizedPerson.NormaliseEmail(p.Email)).Distinct().ToList();
        var listed = (await db.SurveyAuthorizedPeople
                .AsNoTracking()
                .Where(p => p.SurveyId == survey.Id && addresses.Contains(p.Email))
                .Select(p => p.Email)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        return people
            .Where(p => !listed.Contains(SurveyAuthorizedPerson.NormaliseEmail(p.Email)))
            .Select(p => new SurveyRecipientNotAuthorized(p.Id, p.Email, p.Name))
            .OrderBy(p => p.Email, StringComparer.Ordinal)
            .ThenBy(p => p.UserId)
            .ToList();
    }
}
