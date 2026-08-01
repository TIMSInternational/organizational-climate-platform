using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class BitacoraEntryConfiguration : IEntityTypeConfiguration<BitacoraEntry>
{
    public void Configure(EntityTypeBuilder<BitacoraEntry> builder)
    {
        builder.ToTable("bitacora_entries");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.UsuarioExternalId).HasMaxLength(64).IsRequired();
        builder.Property(b => b.AvanceAnterior).HasColumnType("numeric(5,4)");
        builder.Property(b => b.AvanceNuevo).HasColumnType("numeric(5,4)");
        builder.Property(b => b.Comentario).HasMaxLength(2000);
    }
}
