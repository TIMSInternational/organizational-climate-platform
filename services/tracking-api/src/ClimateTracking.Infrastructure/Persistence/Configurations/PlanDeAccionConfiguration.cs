using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class PlanDeAccionConfiguration : IEntityTypeConfiguration<PlanDeAccion>
{
    public void Configure(EntityTypeBuilder<PlanDeAccion> builder)
    {
        builder.ToTable("planes_de_accion");
        builder.HasKey(p => p.Id);
        builder.HasIndex(p => p.PlanCode).IsUnique();

        builder.Property(p => p.PlanCode).HasMaxLength(32).IsRequired();
        builder.Property(p => p.NodoExternalId).HasMaxLength(64).IsRequired();
        builder.Property(p => p.LiderExternalId).HasMaxLength(64).IsRequired();
        builder.Property(p => p.HallazgoExternalId).HasMaxLength(64);
        builder.Property(p => p.DescripcionQue).HasMaxLength(2000).IsRequired();
        builder.Property(p => p.MetodologiaComo).HasMaxLength(2000).IsRequired();
        builder.Property(p => p.ResponsableEjecucionExternalId).HasMaxLength(64).IsRequired();
        builder.Property(p => p.PorcentajeAvance).HasColumnType("numeric(5,4)");
        builder.Property(p => p.EstadoSemaforo).HasConversion<string>().HasMaxLength(20);

        builder.Property<List<string>>("_involucradosExternalIds")
            .HasColumnName("involucrados_external_ids")
            .HasColumnType("text[]");
        builder.Ignore(p => p.InvolucradosExternalIds);
        builder.HasIndex("_involucradosExternalIds")
            .HasMethod("gin")
            .HasDatabaseName("ix_planes_de_accion_involucrados");

        builder.HasMany<BitacoraEntry>("_bitacora")
            .WithOne()
            .HasForeignKey(b => b.PlanDeAccionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation("_bitacora").HasField("_bitacora").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Ignore(p => p.Bitacora);
    }
}
