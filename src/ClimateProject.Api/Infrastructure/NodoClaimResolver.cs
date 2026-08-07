using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Resolves the <c>nodoId</c> JWT claim for a user about to be issued a token (#151).
///
/// Every token-minting path -- /auth/login, /auth/signup, /auth/google, /auth/refresh and
/// /invitations/{token}/accept -- goes through here, so all five agree with each other and,
/// via <see cref="TrackingIdentifiers.NodoIdClaimForUser"/>, with /api/internal/personas.
/// Before #151 they all read <c>User.NodoId</c>, a column nothing ever wrote.
/// </summary>
public static class NodoClaimResolver
{
    public static async Task<string?> ResolveAsync(
        ClimateProjectDbContext db,
        User user,
        CancellationToken cancellationToken)
    {
        // AsNoTracking: this is a read purely to derive a claim value. The callers in
        // AuthEndpoints have a tracked `user` they mutate and save (LastLoginAt), and
        // attaching an unrelated Department to that change tracker would be noise at best.
        var department = user.DepartmentId.HasValue
            ? await db.Departments
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == user.DepartmentId.Value, cancellationToken)
            : null;

        return TrackingIdentifiers.NodoIdClaimForUser(department, user.CompanyId);
    }
}
