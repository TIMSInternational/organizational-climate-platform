using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateObjectiveConfiguration : IEntityTypeConfiguration<ActionPlanTemplateObjective>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplateObjective> builder)
    {
        builder.ToTable("action_plan_template_objectives");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(o => o.DescriptionEn).HasColumnName("description_en").HasColumnType("text");
        builder.Property(o => o.DescriptionEs).HasColumnName("description_es").HasColumnType("text");
        builder.Property(o => o.SuccessCriteriaEn).HasColumnName("success_criteria_en").HasColumnType("text");
        builder.Property(o => o.SuccessCriteriaEs).HasColumnName("success_criteria_es").HasColumnType("text");

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(o => o.TemplateId);
    }
}
