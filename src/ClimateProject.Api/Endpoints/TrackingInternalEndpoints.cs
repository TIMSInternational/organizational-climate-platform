using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Tracking;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class TrackingInternalEndpoints
{
    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static void MapTrackingInternalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/internal").AddEndpointFilter<InternalApiKeyFilter>();

        group.MapGet("/nodos", ListNodosAsync);
        group.MapGet("/personas", ListPersonasAsync);
    }

    private static async Task<IResult> ListNodosAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(companyId, out var companyGuid))
        {
            return Results.Json(new { message = "company_id must be a valid GUID." }, statusCode: 400);
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var departmentsById = departments.ToDictionary(d => d.Id);
        var managerIds = departments.Where(d => d.ManagerId.HasValue).Select(d => d.ManagerId!.Value).ToList();
        var managers = await db.Users
            .Where(u => managerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var nodos = departments.Select(d => new NodoInternalDto(
            NodoId: TrackingIdentifiers.ExternalNodoId(d),
            Nombre: d.Name,
            NodoPadreId: d.ParentDepartmentId.HasValue && departmentsById.TryGetValue(d.ParentDepartmentId.Value, out var parent)
                ? TrackingIdentifiers.ExternalNodoId(parent)
                : null,
            LiderId: d.ManagerId.HasValue && managers.TryGetValue(d.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            CantidadColaboradores: d.EmployeeCount,
            Activo: d.IsActive,
            CompanyId: d.CompanyId.ToString()))
            .ToList();

        return Results.Json(new Envelope<NodosData>(true, new NodosData(nodos)), SnakeCaseOptions);
    }

    private static async Task<IResult> ListPersonasAsync(
        [FromQuery(Name = "company_id")] string companyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(companyId, out var companyGuid))
        {
            return Results.Json(new { message = "company_id must be a valid GUID." }, statusCode: 400);
        }

        var users = await db.Users
            .Where(u => u.CompanyId == companyGuid)
            .ToListAsync(cancellationToken);

        var usersById = users.ToDictionary(u => u.Id);

        var personas = users.Select(u => new PersonaInternalDto(
            PersonaId: TrackingIdentifiers.ExternalPersonaId(u),
            NombreCompleto: u.Name,
            Correo: u.Email,
            NodoId: u.NodoId ?? string.Empty,
            ManagerId: u.ManagerId.HasValue && usersById.TryGetValue(u.ManagerId.Value, out var manager)
                ? TrackingIdentifiers.ExternalPersonaId(manager)
                : null,
            Rol: u.Role,
            Activo: u.IsActive,
            CompanyId: u.CompanyId.ToString()))
            .ToList();

        return Results.Json(new Envelope<PersonasData>(true, new PersonasData(personas)), SnakeCaseOptions);
    }
}
