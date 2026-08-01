using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using System.Reflection;

namespace ClimateTracking.UnitTests.Entities;

public class PlanDeAccionInvariantsTests
{
    [Fact]
    public void EstadoSemaforo_has_no_public_setter()
    {
        var property = typeof(PlanDeAccion).GetProperty(nameof(PlanDeAccion.EstadoSemaforo));

        Assert.NotNull(property);
        var setMethod = property!.GetSetMethod(nonPublic: false);
        Assert.Null(setMethod); // no PUBLIC setter — only private, reachable via domain methods
    }

    [Fact]
    public void RegistrarAvance_rejects_values_outside_0_to_1()
    {
        var plan = new PlanDeAccion
        {
            PlanCode = "PA-2026-00123",
            NodoExternalId = "ND-014",
            LiderExternalId = "PER-0231",
            DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
            MetodologiaComo = "Nominacion por formulario simple",
            ResponsableEjecucionExternalId = "PER-0231",
            FechaCreacion = new DateOnly(2026, 1, 1),
            FechaCompromiso = new DateOnly(2026, 12, 31),
        };
        var config = new SemaforoThresholdConfig();

        Assert.Throws<ArgumentOutOfRangeException>(() =>
            plan.RegistrarAvance(1.5m, "PER-0231", null, new DateOnly(2026, 1, 5), config));
    }

    [Fact]
    public void RegistrarAvance_appends_to_bitacora_and_updates_fecha_ultima_actualizacion()
    {
        var plan = new PlanDeAccion
        {
            PlanCode = "PA-2026-00123",
            NodoExternalId = "ND-014",
            LiderExternalId = "PER-0231",
            DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
            MetodologiaComo = "Nominacion por formulario simple",
            ResponsableEjecucionExternalId = "PER-0231",
            FechaCreacion = new DateOnly(2026, 1, 1),
            FechaCompromiso = new DateOnly(2026, 12, 31),
        };
        var config = new SemaforoThresholdConfig();

        plan.RegistrarAvance(0.4m, "PER-0231", "Se diseno el formulario", new DateOnly(2026, 7, 20), config);

        Assert.Single(plan.Bitacora);
        Assert.Equal(0m, plan.Bitacora[0].AvanceAnterior);
        Assert.Equal(0.4m, plan.Bitacora[0].AvanceNuevo);
        Assert.Equal(new DateOnly(2026, 7, 20), plan.FechaUltimaActualizacion);
        Assert.Equal(0.4m, plan.PorcentajeAvance);
    }

    [Fact]
    public void AgregarInvolucrado_does_not_duplicate_the_same_persona()
    {
        var plan = new PlanDeAccion
        {
            PlanCode = "PA-2026-00123",
            NodoExternalId = "ND-014",
            LiderExternalId = "PER-0231",
            DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
            MetodologiaComo = "Nominacion por formulario simple",
            ResponsableEjecucionExternalId = "PER-0231",
            FechaCreacion = new DateOnly(2026, 1, 1),
            FechaCompromiso = new DateOnly(2026, 12, 31),
        };

        plan.AgregarInvolucrado("PER-0245");
        plan.AgregarInvolucrado("PER-0245");

        Assert.Single(plan.InvolucradosExternalIds);
    }
}
