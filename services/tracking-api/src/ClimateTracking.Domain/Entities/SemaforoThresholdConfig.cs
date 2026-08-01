using ClimateTracking.Domain.Enums;

namespace ClimateTracking.Domain.Entities;

public class SemaforoThresholdConfig
{
    /// <summary>
    /// Well-known id of the single seeded default configuration row.
    /// </summary>
    public static readonly Guid DefaultConfigId = new("00000000-0000-0000-0000-000000000001");

    public Guid Id { get; set; }
    public int DiasAmarilloSinActualizar { get; set; } = 30;
    public int DiasRojoSinActualizar { get; set; } = 60;
    public int DiasAntesVencimientoAmarillo { get; set; } = 30;
    public TipoAvanceEsperado TipoAvanceEsperado { get; set; } = TipoAvanceEsperado.Continuo;
    public int[]? Hitos { get; set; }
    public decimal FraccionMitadPlazo { get; set; } = 0.5m;
}
