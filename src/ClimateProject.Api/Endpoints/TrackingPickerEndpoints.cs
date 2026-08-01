using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class TrackingPickerEndpoints
{
    public static void MapTrackingPickerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/tracking/picker").RequireAuthorization();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListNodosAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId && d.IsActive)
            .OrderBy(d => d.Name)
            .ToListAsync(cancellationToken);

        var items = departments
            .Select(d => new NodoPickerItem(TrackingIdentifiers.ExternalNodoId(d), d.Name))
            .ToList();

        return Results.Ok(new NodoPickerResponse(items));
    }

    private static async Task<IResult> ListPersonasAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var users = await db.Users
            .Where(u => u.CompanyId == companyId && u.IsActive)
            .OrderBy(u => u.Name)
            .ToListAsync(cancellationToken);

        var items = users
            .Select(u => new PersonaPickerItem(TrackingIdentifiers.ExternalPersonaId(u), u.Name, u.Email))
            .ToList();

        return Results.Ok(new PersonaPickerResponse(items));
    }
}
