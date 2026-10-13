using ClimateProject.Application.Exports;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The company's reading of a score (<c>CompanySettings.ResultScale</c>), for the routes that
/// write a file a person downloads. Read when the file is built, like the result bands: a
/// company that switches to 0–100 gets 0–100 files from that moment on.
/// </summary>
internal static class CompanyScoreScale
{
    public static async Task<ScoreScale> LoadAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        var key = await db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.ResultScale)
            .FirstOrDefaultAsync(cancellationToken);

        // A missing company reads as the mean: the default, and what every file said before.
        return ScoreScales.Parse(key);
    }
}
