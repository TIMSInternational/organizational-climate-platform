using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The one place the configured <see cref="PasswordPolicy"/> is read for enforcement, so
/// signup, invitation acceptance, the profile's change-password and credential resets
/// cannot drift from each other. No settings row yet means the entity's defaults.
/// </summary>
internal static class PasswordPolicies
{
    public static async Task<PasswordPolicy> LoadAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return settings?.PasswordPolicy ?? new PasswordPolicy();
    }
}
