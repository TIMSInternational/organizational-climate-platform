using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class SemaforoThresholdConfigConfiguration : IEntityTypeConfiguration<SemaforoThresholdConfig>
{
    public void Configure(EntityTypeBuilder<SemaforoThresholdConfig> builder)
    {
        builder.ToTable("semaforo_threshold_config");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.TipoAvanceEsperado).HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.Hitos).HasColumnType("integer[]");
        builder.Property(c => c.FraccionMitadPlazo).HasColumnType("numeric(5,4)");

        builder.HasData(new SemaforoThresholdConfig
        {
            Id = SemaforoThresholdConfig.DefaultConfigId,
            DiasAmarilloSinActualizar = 30,
            DiasRojoSinActualizar = 60,
            DiasAntesVencimientoAmarillo = 30,
            TipoAvanceEsperado = TipoAvanceEsperado.Continuo,
            Hitos = null,
            FraccionMitadPlazo = 0.5m,
        });
    }
}
