using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyTemplateConfiguration : IEntityTypeConfiguration<SurveyTemplate>
{
    public void Configure(EntityTypeBuilder<SurveyTemplate> builder)
    {
        builder.ToTable("survey_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(t => t.Category).HasColumnName("category").HasMaxLength(20).IsRequired();
        builder.Property(t => t.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(t => t.CompanySize).HasColumnName("company_size").HasMaxLength(20);
        builder.Property(t => t.IsPublic).HasColumnName("is_public").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.CreatedBy).HasColumnName("created_by");
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(t => t.Rating).HasColumnName("rating").IsRequired().HasDefaultValue(0d);
        builder.Property(t => t.Tags).HasColumnName("tags").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(t => t.SourceSurveyId).HasColumnName("source_survey_id");
        builder.Property(t => t.LastUsed).HasColumnName("last_used");
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Survey>().WithMany().HasForeignKey(t => t.SourceSurveyId).OnDelete(DeleteBehavior.SetNull);
    }
}
