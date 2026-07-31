using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanProgressUpdateConfiguration : IEntityTypeConfiguration<ActionPlanProgressUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanProgressUpdate> builder)
    {
        builder.ToTable("action_plan_progress_updates");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.ActionPlanId).HasColumnName("action_plan_id").IsRequired();
        builder.Property(p => p.UpdateDate).HasColumnName("update_date").IsRequired();
        builder.Property(p => p.OverallNotes).HasColumnName("overall_notes").HasColumnType("text").IsRequired().HasDefaultValue("");
        builder.Property(p => p.UpdatedBy).HasColumnName("updated_by").IsRequired();

        builder.HasOne<ActionPlan>().WithMany().HasForeignKey(p => p.ActionPlanId);
        builder.HasOne<User>().WithMany().HasForeignKey(p => p.UpdatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
