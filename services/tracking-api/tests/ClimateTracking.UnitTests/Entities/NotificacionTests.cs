using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.UnitTests.Entities;

public class NotificacionTests
{
    [Fact]
    public void Holds_trigger_type_recipients_and_send_state()
    {
        var planId = Guid.NewGuid();
        var notificacion = new Notificacion
        {
            Id = Guid.NewGuid(),
            PlanDeAccionId = planId,
            TipoDisparador = TipoDisparadorNotificacion.Alerta15Dias,
            Destinatarios = ["PER-0231", "PER-0245", "PER-0198"],
            Canal = CanalNotificacion.Correo,
            FechaEnvio = new DateTimeOffset(2026, 8, 31, 0, 0, 0, TimeSpan.Zero),
            Contenido = "El plan PA-2026-00123 vence en 15 dias. Avance actual: 40%.",
            EstadoEnvio = EstadoEnvioNotificacion.Enviado,
        };

        Assert.Equal(planId, notificacion.PlanDeAccionId);
        Assert.Equal(3, notificacion.Destinatarios.Count);
        Assert.Equal(EstadoEnvioNotificacion.Enviado, notificacion.EstadoEnvio);
    }
}
