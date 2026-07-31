using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class ReportConfiguration : IEntityTypeConfiguration<Report>
{
    public void Configure(EntityTypeBuilder<Report> builder)
    {
        builder.ToTable("reports");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(r => r.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(r => r.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(r => r.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(r => r.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(r => r.TemplateId).HasColumnName("template_id").HasMaxLength(100);
        builder.Property(r => r.Filters).HasColumnName("filters").HasColumnType("jsonb");
        builder.Property(r => r.Config).HasColumnName("config").HasColumnType("jsonb");
        builder.Property(r => r.Status).HasColumnName("status").HasMaxLength(20).IsRequired().HasDefaultValue("generating");
        builder.Property(r => r.Format).HasColumnName("format").HasMaxLength(10).IsRequired();
        builder.Property(r => r.FilePath).HasColumnName("file_path").HasMaxLength(500);
        builder.Property(r => r.FileSize).HasColumnName("file_size");
        builder.Property(r => r.GenerationStartedAt).HasColumnName("generation_started_at");
        builder.Property(r => r.GenerationCompletedAt).HasColumnName("generation_completed_at");
        builder.Property(r => r.GenerationError).HasColumnName("generation_error").HasColumnType("text");
        builder.Property(r => r.ScheduledFor).HasColumnName("scheduled_for");
        builder.Property(r => r.IsRecurring).HasColumnName("is_recurring").IsRequired().HasDefaultValue(false);
        builder.Property(r => r.RecurrencePattern).HasColumnName("recurrence_pattern").HasMaxLength(100);
        builder.Property(r => r.NextGeneration).HasColumnName("next_generation");
        builder.Property(r => r.SharedWith).HasColumnName("shared_with").HasColumnType("text[]").IsRequired().HasDefaultValueSql("ARRAY[]::text[]");
        builder.Property(r => r.DownloadCount).HasColumnName("download_count").IsRequired().HasDefaultValue(0);
        builder.Property(r => r.ExpiresAt).HasColumnName("expires_at");
        builder.Property(r => r.ReportOutput).HasColumnName("report_output").HasColumnType("jsonb");
        builder.Property(r => r.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(r => r.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(r => new { r.CompanyId, r.Status });
        builder.HasIndex(r => r.CreatedBy);
        builder.HasIndex(r => r.Type);
        builder.HasIndex(r => r.ScheduledFor);
        builder.HasIndex(r => r.ExpiresAt);

        builder.HasOne<Company>().WithMany().HasForeignKey(r => r.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(r => r.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
