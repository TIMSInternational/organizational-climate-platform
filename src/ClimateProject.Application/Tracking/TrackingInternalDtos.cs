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

/// <param name="ResultadoPct">
/// The department's score for this dimension, as a fraction of the instrument's scale --
/// **null when it is withheld**.
///
/// Nullable is the whole disclosure control on this surface. A department below
/// <c>SurveyResultsPrivacy.MinimumSegmentRespondents</c> still gets its findings, so a
/// small team can be given an action plan, but never its numbers; and a dimension with no
/// single numeric scale has no fraction to report. Both arrive here as null, and telling
/// them apart is not something a consumer should be able to do -- <c>SurveyClimateTrends</c>
/// collapses the same three cases into one suppressed point for the same reason.
/// climate-tracking's <c>HallazgoDto</c> carries the matching <c>decimal?</c>.
/// </param>
/// <param name="BenchmarkSectorPct">Null in v1. See <c>TrackingHallazgos</c>.</param>
/// <param name="ResultadoAnioAnteriorPct">Null in v1. See <c>TrackingHallazgos</c>.</param>
public sealed record HallazgoInternalDto(
    string HallazgoId,
    string NodoId,
    string Categoria,
    decimal? ResultadoPct,
    decimal? BenchmarkSectorPct,
    decimal? ResultadoAnioAnteriorPct,
    string? CicloId);

public sealed record HallazgosData(IReadOnlyList<HallazgoInternalDto> Hallazgos);
