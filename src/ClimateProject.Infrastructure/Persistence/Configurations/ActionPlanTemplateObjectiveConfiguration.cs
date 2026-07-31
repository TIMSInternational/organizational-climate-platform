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
        builder.Property(o => o.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(o => o.SuccessCriteria).HasColumnName("success_criteria").HasColumnType("text").IsRequired();

        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(o => o.TemplateId);
    }
}
