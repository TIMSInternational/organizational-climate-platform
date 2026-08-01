using ClimateTracking.Domain.Enums;

namespace ClimateTracking.Domain.Entities;

public class CicloEncuestaCache
{
    public Guid Id { get; set; }
    public required string ExternalId { get; set; }
    public DateOnly FechaApertura { get; set; }
    public DateOnly FechaCierre { get; set; }
    public int NumeroPreguntas { get; set; }
    public EstadoCicloEncuesta Estado { get; set; }
    public DateTimeOffset LastSyncedAt { get; set; }
}
