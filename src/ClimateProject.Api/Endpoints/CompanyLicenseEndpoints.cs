using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The super-admin surface for service licences: read a company's per-service seat allotment and
/// usage, grant or adjust seats, suspend or reactivate. Enforcement itself lives at the respond
/// endpoint (a seat is spent on a completed response); this only provisions the entitlement.
/// </summary>
public static class CompanyLicenseEndpoints
{
    public static void MapCompanyLicenseEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/companies").RequireAuthorization();

        group.MapGet("/{id:guid}/licenses", ListAsync);
        group.MapPut("/{id:guid}/licenses/{serviceType}", GrantAsync);
        group.MapPost("/{id:guid}/licenses/{serviceType}/suspend", SuspendAsync);
        group.MapPost("/{id:guid}/licenses/{serviceType}/reactivate", ReactivateAsync);
    }

    private static async Task<IResult> ListAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!await db.Companies.AnyAsync(c => c.Id == id, cancellationToken))
        {
            return CompanyNotFound();
        }

        var rows = await CompanyLicenses.ListAsync(db, id, cancellationToken);
        var byService = rows.ToDictionary(r => r.ServiceType, StringComparer.Ordinal);

        // One row per metered service, whether or not a licence has been granted, so the surface
        // shows the full catalogue and the client never has to know the service list.
        var services = ClimateServiceTypes.Metered
            .Select(service => byService.TryGetValue(service, out var licence)
                ? new CompanyServiceLicenseView(service, licence.SeatsTotal, licence.SeatsUsed, licence.Status, true, licence.Notes, licence.UpdatedAt)
                : new CompanyServiceLicenseView(service, 0, 0, LicenseStatuses.Active, false, null, null))
            .ToList();

        return Results.Ok(new CompanyLicensesResponse(services));
    }

    private static async Task<IResult> GrantAsync(
        Guid id,
        string serviceType,
        GrantLicenseRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!ClimateServiceTypes.IsMetered(serviceType))
        {
            return NotMetered(serviceType);
        }

        if (request.SeatsTotal < 0)
        {
            return Results.Json(new { message = "seatsTotal must be zero or greater" }, statusCode: 400);
        }

        if (!await db.Companies.AnyAsync(c => c.Id == id, cancellationToken))
        {
            return CompanyNotFound();
        }

        var licence = await CompanyLicenses.GrantOrUpdateAsync(
            db, id, serviceType, request.SeatsTotal, request.Notes?.Trim(), DateTimeOffset.UtcNow, cancellationToken);

        return Results.Ok(ToView(licence));
    }

    private static Task<IResult> SuspendAsync(
        Guid id, string serviceType, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => SetStatusAsync(id, serviceType, LicenseStatuses.Suspended, principal, db, cancellationToken);

    private static Task<IResult> ReactivateAsync(
        Guid id, string serviceType, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
        => SetStatusAsync(id, serviceType, LicenseStatuses.Active, principal, db, cancellationToken);

    private static async Task<IResult> SetStatusAsync(
        Guid id,
        string serviceType,
        string status,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (principal.GetCurrentUser().Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!ClimateServiceTypes.IsMetered(serviceType))
        {
            return NotMetered(serviceType);
        }

        var changed = await CompanyLicenses.SetStatusAsync(db, id, serviceType, status, DateTimeOffset.UtcNow, cancellationToken);
        if (!changed)
        {
            return Results.Json(new { message = "No licence exists for this company and service" }, statusCode: 404);
        }

        var rows = await CompanyLicenses.ListAsync(db, id, cancellationToken);
        var licence = rows.First(r => string.Equals(r.ServiceType, serviceType, StringComparison.Ordinal));
        return Results.Ok(ToView(licence));
    }

    private static CompanyServiceLicenseView ToView(CompanyServiceLicense licence)
        => new(licence.ServiceType, licence.SeatsTotal, licence.SeatsUsed, licence.Status, true, licence.Notes, licence.UpdatedAt);

    private static IResult CompanyNotFound()
        => Results.Json(new { message = "Company not found" }, statusCode: 404);

    private static IResult NotMetered(string serviceType)
        => Results.Json(new { message = $"'{serviceType}' is not a metered climate service" }, statusCode: 400);
}
