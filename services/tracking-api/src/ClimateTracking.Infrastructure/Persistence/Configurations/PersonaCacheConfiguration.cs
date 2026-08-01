using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class PersonaCacheConfiguration : IEntityTypeConfiguration<PersonaCache>
{
    public void Configure(EntityTypeBuilder<PersonaCache> builder)
    {
        builder.ToTable("personas_cache");
        builder.HasKey(p => p.Id);
        builder.HasIndex(p => p.ExternalId).IsUnique();
        builder.Property(p => p.ExternalId).HasMaxLength(64).IsRequired();
        builder.Property(p => p.NombreCompleto).HasMaxLength(200).IsRequired();
        builder.Property(p => p.Correo).HasMaxLength(200).IsRequired();
        builder.Property(p => p.NodoExternalId).HasMaxLength(64).IsRequired();
    }
}
