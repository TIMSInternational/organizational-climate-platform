namespace ClimateTracking.Domain.Entities;

public class BitacoraEntry
{
    public Guid Id { get; set; }
    public Guid PlanDeAccionId { get; set; }
    public DateOnly Fecha { get; set; }
    public required string UsuarioExternalId { get; set; }
    public decimal AvanceAnterior { get; set; }
    public decimal AvanceNuevo { get; set; }
    public string? Comentario { get; set; }
}
