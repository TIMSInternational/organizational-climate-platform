using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanObjectiveConfiguration : IEntityTypeConfiguration<ActionPlanObjective>
{
    public void Configure(EntityTypeBuilder<ActionPlanObjective> builder)
    {
        builder.ToTable("action_plan_objectives");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(o => o.DescriptionEn).HasColumnName("description_en").HasColumnType("text");
        builder.Property(o => o.DescriptionEs).HasColumnName("description_es").HasColumnType("text");
        builder.Property(o => o.SuccessCriteriaEn).HasColumnName("success_criteria_en").HasColumnType("text");
        builder.Property(o => o.SuccessCriteriaEs).HasColumnName("success_criteria_es").HasColumnType("text");
        builder.Property(o => o.CurrentStatus).HasColumnName("current_status").HasColumnType("text").IsRequired().HasDefaultValue("");
        builder.Property(o => o.CompletionPercentage).HasColumnName("completion_percentage").IsRequired().HasDefaultValue(0);

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(o => o.ActionPlanId);
    }
}
