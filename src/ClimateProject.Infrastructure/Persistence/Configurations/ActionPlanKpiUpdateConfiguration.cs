using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanKpiUpdateConfiguration : IEntityTypeConfiguration<ActionPlanKpiUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanKpiUpdate> builder)
    {
        builder.ToTable("action_plan_kpi_updates");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.ProgressUpdateId).HasColumnName("progress_update_id").IsRequired();
        builder.Property(u => u.KpiId).HasColumnName("kpi_id").IsRequired();
        builder.Property(u => u.NewValue).HasColumnName("new_value").IsRequired();
        builder.Property(u => u.Notes).HasColumnName("notes").HasColumnType("text");

        builder.HasOne<ActionPlanProgressUpdate>().WithMany().HasForeignKey(u => u.ProgressUpdateId);
        builder.HasOne<ActionPlanKpi>().WithMany().HasForeignKey(u => u.KpiId).OnDelete(DeleteBehavior.Cascade);
    }
}
