using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class CicloEncuestaCacheConfiguration : IEntityTypeConfiguration<CicloEncuestaCache>
{
    public void Configure(EntityTypeBuilder<CicloEncuestaCache> builder)
    {
        builder.ToTable("ciclos_encuesta_cache");
        builder.HasKey(c => c.Id);
        builder.HasIndex(c => c.ExternalId).IsUnique();
        builder.Property(c => c.ExternalId).HasMaxLength(64).IsRequired();
        builder.Property(c => c.Estado).HasConversion<string>().HasMaxLength(20);
    }
}
