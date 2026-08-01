namespace ClimateTracking.Domain.Entities;

public class PersonaCache
{
    public Guid Id { get; set; }
    public required string ExternalId { get; set; }
    public required string NombreCompleto { get; set; }
    public required string Correo { get; set; }
    public required string NodoExternalId { get; set; }
    public DateTimeOffset LastSyncedAt { get; set; }
}
