using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AIInsightConfiguration : IEntityTypeConfiguration<AIInsight>
{
    public void Configure(EntityTypeBuilder<AIInsight> builder)
    {
        builder.ToTable("ai_insights");
        builder.HasKey(a => a.Id);
        // survey_id is a plain column, not an EF FK -- see AnalyticsInsightConfiguration's comment.
        builder.Property(a => a.SurveyId).HasColumnName("survey_id");
        builder.Property(a => a.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(a => a.DepartmentId).HasColumnName("department_id");
        builder.Property(a => a.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(a => a.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(a => a.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(a => a.ConfidenceScore).HasColumnName("confidence_score").IsRequired();
        builder.Property(a => a.Priority).HasColumnName("priority").HasMaxLength(20).IsRequired();
        builder.Property(a => a.AffectedSegments).HasColumnName("affected_segments").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(a => a.RecommendedActions).HasColumnName("recommended_actions").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(a => a.SupportingData).HasColumnName("supporting_data").HasColumnType("jsonb");
        builder.Property(a => a.IsAcknowledged).HasColumnName("is_acknowledged").IsRequired().HasDefaultValue(false);
        builder.Property(a => a.AcknowledgedBy).HasColumnName("acknowledged_by");
        builder.Property(a => a.AcknowledgedAt).HasColumnName("acknowledged_at");
        builder.Property(a => a.ExpiresAt).HasColumnName("expires_at");
        builder.Property(a => a.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(a => a.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(a => new { a.CompanyId, a.IsAcknowledged });
        builder.HasIndex(a => a.SurveyId);
        builder.HasIndex(a => a.DepartmentId);
        builder.HasIndex(a => new { a.Type, a.Priority });
        builder.HasIndex(a => a.ExpiresAt);
        builder.HasIndex(a => a.CreatedAt);

        builder.HasOne<Company>().WithMany().HasForeignKey(a => a.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(a => a.DepartmentId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<User>().WithMany().HasForeignKey(a => a.AcknowledgedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
