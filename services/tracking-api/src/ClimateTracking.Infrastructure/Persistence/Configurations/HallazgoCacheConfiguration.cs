using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class HallazgoCacheConfiguration : IEntityTypeConfiguration<HallazgoCache>
{
    public void Configure(EntityTypeBuilder<HallazgoCache> builder)
    {
        builder.ToTable("hallazgos_cache");
        builder.HasKey(h => h.Id);
        builder.HasIndex(h => h.ExternalId).IsUnique();
        builder.Property(h => h.ExternalId).HasMaxLength(64).IsRequired();
        builder.Property(h => h.CicloExternalId).HasMaxLength(64).IsRequired();
        builder.Property(h => h.NodoExternalId).HasMaxLength(64).IsRequired();
        builder.Property(h => h.Categoria).HasMaxLength(200).IsRequired();
        builder.Property(h => h.ResultadoPct).HasColumnType("numeric(5,4)");
        builder.Property(h => h.BenchmarkSectorPct).HasColumnType("numeric(5,4)");
        builder.Property(h => h.ResultadoAnioAnteriorPct).HasColumnType("numeric(5,4)");
    }
}
