using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanKpiConfiguration : IEntityTypeConfiguration<ActionPlanKpi>
{
    public void Configure(EntityTypeBuilder<ActionPlanKpi> builder)
    {
        builder.ToTable("action_plan_kpis");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(k => k.NameEn).HasColumnName("name_en").HasMaxLength(200);
        builder.Property(k => k.NameEs).HasColumnName("name_es").HasMaxLength(200);
        builder.Property(k => k.TargetValue).HasColumnName("target_value").IsRequired();
        builder.Property(k => k.CurrentValue).HasColumnName("current_value").IsRequired().HasDefaultValue(0m);
        builder.Property(k => k.UnitEn).HasColumnName("unit_en").HasMaxLength(50);
        builder.Property(k => k.UnitEs).HasColumnName("unit_es").HasMaxLength(50);
        builder.Property(k => k.MeasurementFrequency).HasColumnName("measurement_frequency").HasMaxLength(20).IsRequired();

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(k => k.ActionPlanId);
    }
}
