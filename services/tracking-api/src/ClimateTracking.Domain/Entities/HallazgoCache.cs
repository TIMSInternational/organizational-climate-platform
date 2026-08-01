namespace ClimateTracking.Domain.Entities;

public class HallazgoCache
{
    public Guid Id { get; set; }
    public required string ExternalId { get; set; }
    public required string CicloExternalId { get; set; }
    public required string NodoExternalId { get; set; }
    public required string Categoria { get; set; }
    public decimal ResultadoPct { get; set; }
    public decimal BenchmarkSectorPct { get; set; }
    public decimal ResultadoAnioAnteriorPct { get; set; }
    public DateTimeOffset LastSyncedAt { get; set; }
}
