using ClimateTracking.Domain.Entities;

namespace ClimateTracking.UnitTests.Entities;

public class BitacoraEntryTests
{
    [Fact]
    public void Records_previous_and_new_progress_with_user_and_date()
    {
        var planId = Guid.NewGuid();
        var entry = new BitacoraEntry
        {
            Id = Guid.NewGuid(),
            PlanDeAccionId = planId,
            Fecha = new DateOnly(2026, 7, 20),
            UsuarioExternalId = "PER-0231",
            AvanceAnterior = 0m,
            AvanceNuevo = 0.4m,
            Comentario = "Se diseno el formulario de nominacion",
        };

        Assert.Equal(planId, entry.PlanDeAccionId);
        Assert.Equal(0.4m, entry.AvanceNuevo);
        Assert.Equal("Se diseno el formulario de nominacion", entry.Comentario);
    }

    [Fact]
    public void Comentario_is_optional()
    {
        var entry = new BitacoraEntry
        {
            Id = Guid.NewGuid(),
            PlanDeAccionId = Guid.NewGuid(),
            Fecha = new DateOnly(2026, 7, 20),
            UsuarioExternalId = "PER-0231",
            AvanceAnterior = 0m,
            AvanceNuevo = 0.1m,
        };

        Assert.Null(entry.Comentario);
    }
}
