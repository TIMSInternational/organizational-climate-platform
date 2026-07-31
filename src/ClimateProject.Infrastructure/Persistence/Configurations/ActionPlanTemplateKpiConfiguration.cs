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
        builder.Property(k => k.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(k => k.TargetValue).HasColumnName("target_value").IsRequired();
        builder.Property(k => k.Unit).HasColumnName("unit").HasMaxLength(50).IsRequired();
        builder.Property(k => k.MeasurementFrequency).HasColumnName("measurement_frequency").HasMaxLength(20).IsRequired();

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(k => k.TemplateId);
    }
}
