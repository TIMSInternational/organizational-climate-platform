using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateKpiConfiguration : IEntityTypeConfiguration<ActionPlanTemplateKpi>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplateKpi> builder)
    {
        builder.ToTable("action_plan_template_kpis");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(k => k.NameEn).HasColumnName("name_en").HasMaxLength(200);
        builder.Property(k => k.NameEs).HasColumnName("name_es").HasMaxLength(200);
        builder.Property(k => k.TargetValue).HasColumnName("target_value").IsRequired();
        builder.Property(k => k.UnitEn).HasColumnName("unit_en").HasMaxLength(50);
        builder.Property(k => k.UnitEs).HasColumnName("unit_es").HasMaxLength(50);
        builder.Property(k => k.MeasurementFrequency).HasColumnName("measurement_frequency").HasMaxLength(20).IsRequired();

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(k => k.TemplateId);
    }
}
