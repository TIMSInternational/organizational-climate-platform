namespace ClimateProject.Application.Tracking;

public sealed record Envelope<TData>(bool Success, TData Data);

public sealed record NodoInternalDto(
    string NodoId,
    string Nombre,
    string? NodoPadreId,
    string? LiderId,
    int CantidadColaboradores,
    bool Activo,
    string CompanyId);

public sealed record NodosData(IReadOnlyList<NodoInternalDto> Nodos);

public sealed record PersonaInternalDto(
    string PersonaId,
    string NombreCompleto,
    string Correo,
    string NodoId,
    string? ManagerId,
    string Rol,
    bool Activo,
    string CompanyId);

public sealed record PersonasData(IReadOnlyList<PersonaInternalDto> Personas);

public sealed record CicloInternalDto(
    string CicloId,
    DateTimeOffset FechaApertura,
    DateTimeOffset FechaCierre,
    int NumeroPreguntas,
    string Estado,
    string CompanyId);

public sealed record CiclosData(IReadOnlyList<CicloInternalDto> Ciclos);

public sealed record HallazgoInternalDto(
    string HallazgoId,
    string NodoId,
    string Categoria,
    decimal ResultadoPct,
    decimal? BenchmarkSectorPct,
    decimal? ResultadoAnioAnteriorPct,
    string? CicloId);

public sealed record HallazgosData(IReadOnlyList<HallazgoInternalDto> Hallazgos);
