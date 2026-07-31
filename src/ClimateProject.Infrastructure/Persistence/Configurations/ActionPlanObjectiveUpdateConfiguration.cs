using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanObjectiveUpdateConfiguration : IEntityTypeConfiguration<ActionPlanObjectiveUpdate>
{
    public void Configure(EntityTypeBuilder<ActionPlanObjectiveUpdate> builder)
    {
        builder.ToTable("action_plan_objective_updates");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.ProgressUpdateId).HasColumnName("progress_update_id").IsRequired();
        builder.Property(u => u.ObjectiveId).HasColumnName("objective_id").IsRequired();
        builder.Property(u => u.StatusUpdate).HasColumnName("status_update").HasColumnType("text").IsRequired();
        builder.Property(u => u.CompletionPercentage).HasColumnName("completion_percentage");
        builder.Property(u => u.Notes).HasColumnName("notes").HasColumnType("text");

        builder.HasOne<ActionPlanProgressUpdate>().WithMany().HasForeignKey(u => u.ProgressUpdateId);
        builder.HasOne<ActionPlanObjective>().WithMany().HasForeignKey(u => u.ObjectiveId).OnDelete(DeleteBehavior.Cascade);
    }
}
