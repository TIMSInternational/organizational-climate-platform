using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The one place <see cref="Domain.Entities.SystemSettings.SessionTimeoutMinutes"/> is read
/// for enforcement.
/// </summary>
/// <remarks>
/// Deliberately does NOT call <c>SystemSettingsEndpoints.GetOrCreateAsync</c>, for the same
/// reason <c>CheckSystemSettingsGateAsync</c> does not: a sign-in must never have the side
/// effect of creating the singleton row. A missing row means the entity's default, which
/// <see cref="SessionWindows.DefaultIdleMinutes"/> states as the same 60 minutes
/// <c>SystemSettings.SessionTimeoutMinutes</c> ships with.
/// </remarks>
internal static class SessionTimeouts
{
    public static async Task<int> LoadMinutesAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings
            .AsNoTracking()
            .Select(s => (int?)s.SessionTimeoutMinutes)
            .FirstOrDefaultAsync(cancellationToken);

        return settings ?? SessionWindows.DefaultIdleMinutes;
    }
}
