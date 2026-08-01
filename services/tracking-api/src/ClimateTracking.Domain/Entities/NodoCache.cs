namespace ClimateTracking.Domain.Entities;

public class NodoCache
{
    public Guid Id { get; set; }
    public required string ExternalId { get; set; }
    public required string Nombre { get; set; }
    public string? NodoPadreExternalId { get; set; }
    public required string LiderExternalId { get; set; }
    public int CantidadColaboradores { get; set; }
    public bool Activo { get; set; }
    public DateTimeOffset LastSyncedAt { get; set; }
}
