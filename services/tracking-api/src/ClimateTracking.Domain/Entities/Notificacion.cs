using ClimateTracking.Domain.Enums;

namespace ClimateTracking.Domain.Entities;

public class Notificacion
{
    public Guid Id { get; set; }
    public Guid PlanDeAccionId { get; set; }
    public TipoDisparadorNotificacion TipoDisparador { get; set; }
    public required IReadOnlyList<string> Destinatarios { get; set; }
    public CanalNotificacion Canal { get; set; }
    public DateTimeOffset FechaEnvio { get; set; }
    public required string Contenido { get; set; }
    public EstadoEnvioNotificacion EstadoEnvio { get; set; }
}
