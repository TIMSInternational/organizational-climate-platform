using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class NodoCacheConfiguration : IEntityTypeConfiguration<NodoCache>
{
    public void Configure(EntityTypeBuilder<NodoCache> builder)
    {
        builder.ToTable("nodos_cache");
        builder.HasKey(n => n.Id);
        builder.HasIndex(n => n.ExternalId).IsUnique();
        builder.Property(n => n.ExternalId).HasMaxLength(64).IsRequired();
        builder.Property(n => n.Nombre).HasMaxLength(200).IsRequired();
        builder.Property(n => n.LiderExternalId).HasMaxLength(64).IsRequired();
    }
}
