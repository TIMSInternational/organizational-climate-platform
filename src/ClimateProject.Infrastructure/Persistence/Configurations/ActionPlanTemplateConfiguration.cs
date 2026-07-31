using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ActionPlanTemplateConfiguration : IEntityTypeConfiguration<ActionPlanTemplate>
{
    public void Configure(EntityTypeBuilder<ActionPlanTemplate> builder)
    {
        builder.ToTable("action_plan_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasColumnType("text").IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(t => t.AiRecommendationTemplates).HasColumnName("ai_recommendation_templates").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.Tags).HasColumnName("tags").IsRequired().HasDefaultValue(Array.Empty<string>());
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.CompanyId, t.Category });
        builder.HasIndex(t => t.IsActive);
        builder.HasIndex(t => t.UsageCount);

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
