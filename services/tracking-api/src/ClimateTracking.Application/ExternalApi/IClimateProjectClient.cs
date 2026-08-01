namespace ClimateTracking.Application.ExternalApi;

/// <summary>
/// Field names mirror climate-project's /internal/nodos response verbatim
/// (src/app/api/internal/nodos/route.ts).
/// </summary>
public sealed record NodoDto(
    string NodoId,
    string Nombre,
    string? NodoPadreId,
    string? LiderId,
    int CantidadColaboradores,
    bool Activo,
    string CompanyId);

/// <summary>Mirrors /internal/personas (src/app/api/internal/personas/route.ts).</summary>
public sealed record PersonaDto(
    string PersonaId,
    string NombreCompleto,
    string Correo,
    string NodoId,
    string? ManagerId,
    string Rol,
    bool Activo,
    string CompanyId);

/// <summary>Mirrors /internal/ciclos-encuesta (src/app/api/internal/ciclos-encuesta/route.ts).</summary>
public sealed record CicloDto(
    string CicloId,
    DateTimeOffset FechaApertura,
    DateTimeOffset FechaCierre,
    int NumeroPreguntas,
    string Estado,
    string CompanyId);

/// <summary>Mirrors /internal/hallazgos (src/app/api/internal/hallazgos/route.ts).</summary>
public sealed record HallazgoDto(
    string HallazgoId,
    string NodoId,
    string Categoria,
    decimal ResultadoPct,
    decimal? BenchmarkSectorPct,
    decimal? ResultadoAnioAnteriorPct);

public sealed record SendNotificationRequest(
    IReadOnlyList<string> DestinatariosIds,
    string TipoDisparador,
    string Contenido,
    string PlanId);

public interface IClimateProjectClient
{
    Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken);
    Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken);
}
