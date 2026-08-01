using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.UnitTests.Entities;

public class PlanDeAccionAvanceEsperadoTests
{
    private static PlanDeAccion CreatePlan(DateOnly creacion, DateOnly compromiso) => new()
    {
        PlanCode = "PA-2026-00123",
        NodoExternalId = "ND-014",
        LiderExternalId = "PER-0231",
        DescripcionQue = "Implementar un programa mensual de reconocimiento entre pares",
        MetodologiaComo = "Nominacion por formulario simple",
        ResponsableEjecucionExternalId = "PER-0231",
        FechaCreacion = creacion,
        FechaCompromiso = compromiso,
    };

    [Fact]
    public void Continuo_mode_is_linear_by_elapsed_days()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 11)); // 10-day plan
        var config = new SemaforoThresholdConfig { TipoAvanceEsperado = TipoAvanceEsperado.Continuo };

        var esperado = plan.CalcularAvanceEsperado(new DateOnly(2026, 1, 6), config); // day 5 of 10

        Assert.Equal(0.5m, esperado);
    }

    [Fact]
    public void Continuo_mode_clamps_to_1_when_past_fecha_compromiso()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 11));
        var config = new SemaforoThresholdConfig { TipoAvanceEsperado = TipoAvanceEsperado.Continuo };

        var esperado = plan.CalcularAvanceEsperado(new DateOnly(2026, 2, 1), config);

        Assert.Equal(1m, esperado);
    }

    [Fact]
    public void PorHito_mode_rounds_down_to_the_nearest_configured_milestone()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 11)); // 10-day plan
        var config = new SemaforoThresholdConfig
        {
            TipoAvanceEsperado = TipoAvanceEsperado.PorHito,
            Hitos = [25, 50, 75, 100],
        };

        // day 6 of 10 = 60% elapsed -> nearest hito <= 60% is 50%
        var esperado = plan.CalcularAvanceEsperado(new DateOnly(2026, 1, 7), config);

        Assert.Equal(0.5m, esperado);
    }

    [Fact]
    public void PorHito_mode_with_no_milestone_reached_yet_is_zero()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 11));
        var config = new SemaforoThresholdConfig
        {
            TipoAvanceEsperado = TipoAvanceEsperado.PorHito,
            Hitos = [25, 50, 75, 100],
        };

        // day 2 of 10 = 20% elapsed -> below the first hito (25%)
        var esperado = plan.CalcularAvanceEsperado(new DateOnly(2026, 1, 3), config);

        Assert.Equal(0m, esperado);
    }
}
