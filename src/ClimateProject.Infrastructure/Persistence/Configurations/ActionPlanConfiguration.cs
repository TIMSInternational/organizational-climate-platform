using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanConfiguration : IEntityTypeConfiguration<ActionPlan>
{
    public void Configure(EntityTypeBuilder<ActionPlan> builder)
    {
        builder.ToTable("action_plans");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(300).IsRequired();
        builder.Property(a => a.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(a => a.DueDate).HasColumnName("due_date").IsRequired();
        builder.Property(a => a.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("not_started");
        builder.Property(a => a.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired().HasDefaultValue("medium");
        builder.Property(a => a.AiRecommendations).HasColumnName("ai_recommendations").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(a => a.TemplateId).HasColumnName("template_id");
        builder.Property(a => a.SourceSurveyId).HasColumnName("source_survey_id");
        builder.Property(a => a.SourceInsightId).HasColumnName("source_insight_id");
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.Status });
        builder.HasIndex(a => a.DueDate);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ActionPlanTemplate>().WithMany().HasForeignKey(a => a.TemplateId).OnDelete(DeleteBehavior.SetNull);
    }
}
