using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.UnitTests.Entities;

public class PlanDeAccionSemaforoTests
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

    private static readonly SemaforoThresholdConfig DefaultConfig = new();

    [Fact]
    public void Cumplido_is_always_verde_regardless_of_other_conditions()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 10));
        plan.RegistrarAvance(0.4m, "PER-0231", null, new DateOnly(2026, 1, 3), DefaultConfig);

        plan.MarcarCumplido(new DateOnly(2026, 2, 1), "PER-0231"); // long after fecha_compromiso

        Assert.Equal(EstadoSemaforo.Verde, plan.EstadoSemaforo);
        Assert.Equal(1m, plan.PorcentajeAvance);
        Assert.Equal(2, plan.Bitacora.Count);
        var cumplidoEntry = plan.Bitacora[^1];
        Assert.Equal(0.4m, cumplidoEntry.AvanceAnterior);
        Assert.Equal(1m, cumplidoEntry.AvanceNuevo);
        Assert.Equal("Plan marcado como cumplido", cumplidoEntry.Comentario);
        Assert.Equal("PER-0231", cumplidoEntry.UsuarioExternalId);
        Assert.Equal(new DateOnly(2026, 2, 1), cumplidoEntry.Fecha);
    }

    [Fact]
    public void Vencido_sin_cumplir_is_rojo()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 10));

        plan.RecalcularSemaforo(new DateOnly(2026, 1, 11), DefaultConfig); // 1 day past due, not cumplido

        Assert.Equal(EstadoSemaforo.Rojo, plan.EstadoSemaforo);
    }

    [Fact]
    public void Sin_avance_a_mitad_de_plazo_is_rojo()
    {
        // 100-day plan, we're at day 60 (60% elapsed, avanceEsperado=0.6 >= 0.5), 0% avance
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 4, 11));

        plan.RecalcularSemaforo(new DateOnly(2026, 3, 2), DefaultConfig);

        Assert.Equal(EstadoSemaforo.Rojo, plan.EstadoSemaforo);
    }

    [Fact]
    public void Abandonado_mas_de_60_dias_sin_actualizar_is_rojo()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));
        plan.RegistrarAvance(0.3m, "PER-0231", null, new DateOnly(2026, 1, 10), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 3, 15), DefaultConfig); // 64 days since last update

        Assert.Equal(EstadoSemaforo.Rojo, plan.EstadoSemaforo);
    }

    [Fact]
    public void Proximo_a_vencer_y_atrasado_is_amarillo()
    {
        // 100-day plan, 20 days remaining (avanceEsperado=0.8), avance=0.5 < esperado
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 4, 11));
        plan.RegistrarAvance(0.5m, "PER-0231", null, new DateOnly(2026, 3, 20), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 3, 22), DefaultConfig); // 20 days remaining, updated 2 days ago

        Assert.Equal(EstadoSemaforo.Amarillo, plan.EstadoSemaforo);
    }

    [Fact]
    public void Sin_actualizar_mas_de_30_dias_is_amarillo()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));
        plan.RegistrarAvance(0.5m, "PER-0231", null, new DateOnly(2026, 1, 10), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 2, 15), DefaultConfig); // 36 days since last update, plenty of time left

        Assert.Equal(EstadoSemaforo.Amarillo, plan.EstadoSemaforo);
    }

    [Fact]
    public void On_track_with_recent_update_and_time_left_is_verde()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));
        plan.RegistrarAvance(0.5m, "PER-0231", null, new DateOnly(2026, 6, 1), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 6, 5), DefaultConfig);

        Assert.Equal(EstadoSemaforo.Verde, plan.EstadoSemaforo);
    }

    [Fact]
    public void RecalcularSemaforo_keeps_cumplido_plans_verde_even_when_recalculated_long_after_vencimiento()
    {
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 10));
        plan.MarcarCumplido(new DateOnly(2026, 1, 5), "PER-0231");

        plan.RecalcularSemaforo(new DateOnly(2026, 6, 1), DefaultConfig); // long past fecha_compromiso and long past any staleness threshold

        Assert.Equal(EstadoSemaforo.Verde, plan.EstadoSemaforo);
    }

    [Fact]
    public void Vencido_beats_sin_actualizar_mas_de_30_dias_when_both_conditions_hold()
    {
        // 9-day plan; avance registered once (0.3) on fecha_creacion so PorcentajeAvance != 0
        // (this keeps "sin avance a mitad de plazo" out of play so the test isolates vencido vs.
        // sin-actualizar-mas-de-30-dias specifically), then recalculated well past fecha_compromiso:
        // diasRestantes = -36 (vencido) AND diasSinActualizar = 45 (>30 but <=60, so NOT abandonado)
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 10));
        plan.RegistrarAvance(0.3m, "PER-0231", null, new DateOnly(2026, 1, 1), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 2, 15), DefaultConfig);

        Assert.Equal(EstadoSemaforo.Rojo, plan.EstadoSemaforo);
    }

    [Fact]
    public void Abandonado_beats_proximo_a_vencer_atrasado_when_both_conditions_hold()
    {
        // 100-day plan, updated once early (day 4), checked at day 89:
        // diasSinActualizar = 85 (>60, abandonado) AND diasRestantes = 11 (<=30) with avance(0.3) < esperado(0.89)
        var plan = CreatePlan(new DateOnly(2026, 1, 1), new DateOnly(2026, 4, 11));
        plan.RegistrarAvance(0.3m, "PER-0231", null, new DateOnly(2026, 1, 5), DefaultConfig);

        plan.RecalcularSemaforo(new DateOnly(2026, 3, 31), DefaultConfig);

        Assert.Equal(EstadoSemaforo.Rojo, plan.EstadoSemaforo);
    }
}
