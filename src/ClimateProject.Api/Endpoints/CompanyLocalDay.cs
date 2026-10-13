using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The calendar day an instant falls on in a COMPANY's time zone -- the one precision this
/// product keeps for "when did this person answer".
/// </summary>
/// <remarks>
/// One implementation for every writer that records a day instead of a time: a
/// participation row (<c>survey_participations.participated_on</c>) and a named invitee's
/// completion (<c>survey_invitations.completed_on</c>). The company's
/// <c>settings_timezone</c> is resolved through <see cref="SchedulingTimeZone.Resolve"/>, so a
/// blank or unknown zone is UTC rather than an exception. The migration that backfilled
/// <c>completed_on</c> applies the same rule in SQL.
/// </remarks>
internal static class CompanyLocalDay
{
    public static async Task<DateOnly> OfAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var timezone = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.Timezone)
            .FirstOrDefaultAsync(cancellationToken);

        return DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(now, SchedulingTimeZone.Resolve(timezone)));
    }
}
