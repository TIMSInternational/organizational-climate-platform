using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.UnitTests.Entities;

public class SemaforoThresholdConfigTests
{
    [Fact]
    public void Defaults_match_the_spec_proposed_thresholds()
    {
        var config = new SemaforoThresholdConfig();

        Assert.Equal(30, config.DiasAmarilloSinActualizar);
        Assert.Equal(60, config.DiasRojoSinActualizar);
        Assert.Equal(30, config.DiasAntesVencimientoAmarillo);
        Assert.Equal(TipoAvanceEsperado.Continuo, config.TipoAvanceEsperado);
        Assert.Null(config.Hitos);
        Assert.Equal(0.5m, config.FraccionMitadPlazo);
    }

    [Fact]
    public void Thresholds_are_settable_per_client_per_the_spec_dynamic_requirement()
    {
        var config = new SemaforoThresholdConfig
        {
            DiasAmarilloSinActualizar = 15,
            DiasRojoSinActualizar = 45,
            TipoAvanceEsperado = TipoAvanceEsperado.PorHito,
            Hitos = [25, 50, 75, 100],
        };

        Assert.Equal(15, config.DiasAmarilloSinActualizar);
        Assert.Equal(TipoAvanceEsperado.PorHito, config.TipoAvanceEsperado);
        Assert.Equal([25, 50, 75, 100], config.Hitos);
    }
}
