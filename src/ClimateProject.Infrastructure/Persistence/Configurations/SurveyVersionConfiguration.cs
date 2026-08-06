using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyVersionConfiguration : IEntityTypeConfiguration<SurveyVersion>
{
    public void Configure(EntityTypeBuilder<SurveyVersion> builder)
    {
        builder.ToTable("survey_versions");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(v => v.VersionNumber).HasColumnName("version_number").IsRequired();
        builder.Property(v => v.TitleEn).HasColumnName("title_en").HasMaxLength(200);
        builder.Property(v => v.TitleEs).HasColumnName("title_es").HasMaxLength(200);
        builder.Property(v => v.DescriptionEn).HasColumnName("description_en").HasMaxLength(1000);
        builder.Property(v => v.DescriptionEs).HasColumnName("description_es").HasMaxLength(1000);
        builder.Property(v => v.Changes).HasColumnName("changes").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(v => v.Reason).HasColumnName("reason").HasMaxLength(500).IsRequired();
        builder.Property(v => v.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(v => v.QuestionsSnapshot).HasColumnName("questions_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.DemographicsSnapshot).HasColumnName("demographics_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.SettingsSnapshot).HasColumnName("settings_snapshot").HasColumnType("jsonb");
        builder.Property(v => v.CreatedAt).HasColumnName("created_at").IsRequired();

        builder.HasIndex(v => new { v.SurveyId, v.VersionNumber }).IsUnique();

        builder.HasOne<Survey>().WithMany().HasForeignKey(v => v.SurveyId);
        builder.HasOne<User>().WithMany().HasForeignKey(v => v.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
