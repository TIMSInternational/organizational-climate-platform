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
