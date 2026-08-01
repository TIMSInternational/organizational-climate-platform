using ClimateTracking.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateTracking.Infrastructure.Persistence.Configurations;

public class NotificacionConfiguration : IEntityTypeConfiguration<Notificacion>
{
    public void Configure(EntityTypeBuilder<Notificacion> builder)
    {
        builder.ToTable("notificaciones");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.TipoDisparador).HasConversion<string>().HasMaxLength(30);
        builder.Property(n => n.Canal).HasConversion<string>().HasMaxLength(20);
        builder.Property(n => n.EstadoEnvio).HasConversion<string>().HasMaxLength(20);
        builder.Property(n => n.Contenido).HasMaxLength(2000).IsRequired();
        builder.Property(n => n.Destinatarios)
            .HasColumnType("text[]")
            .IsRequired();

        builder.HasIndex(n => n.PlanDeAccionId);
        builder.HasOne<PlanDeAccion>()
            .WithMany()
            .HasForeignKey(n => n.PlanDeAccionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
