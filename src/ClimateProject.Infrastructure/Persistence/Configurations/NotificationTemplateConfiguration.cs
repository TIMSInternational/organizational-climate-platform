using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class NotificationTemplateConfiguration : IEntityTypeConfiguration<NotificationTemplate>
{
    public void Configure(EntityTypeBuilder<NotificationTemplate> builder)
    {
        builder.ToTable("notification_templates");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(t => t.Type).HasColumnName("type").HasMaxLength(32).IsRequired();
        builder.Property(t => t.Channel).HasColumnName("channel").HasMaxLength(20).IsRequired();
        builder.Property(t => t.SubjectEn).HasColumnName("subject_en").HasMaxLength(500);
        builder.Property(t => t.SubjectEs).HasColumnName("subject_es").HasMaxLength(500);
        builder.Property(t => t.TitleEn).HasColumnName("title_en").HasMaxLength(500);
        builder.Property(t => t.TitleEs).HasColumnName("title_es").HasMaxLength(500);
        builder.Property(t => t.ContentEn).HasColumnName("content_en").HasColumnType("text");
        builder.Property(t => t.ContentEs).HasColumnName("content_es").HasColumnType("text");
        builder.Property(t => t.HtmlContentEn).HasColumnName("html_content_en").HasColumnType("text");
        builder.Property(t => t.HtmlContentEs).HasColumnName("html_content_es").HasColumnType("text");
        builder.Property(t => t.CompanyId).HasColumnName("company_id");
        builder.Property(t => t.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(t => t.IsDefault).HasColumnName("is_default").IsRequired().HasDefaultValue(false);
        builder.Property(t => t.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(t => t.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(t => new { t.Type, t.Channel });
        builder.HasIndex(t => new { t.CompanyId, t.IsActive });
        builder.HasIndex(t => new { t.IsDefault, t.IsActive });

        builder.HasOne<Company>().WithMany().HasForeignKey(t => t.CompanyId).OnDelete(DeleteBehavior.SetNull);
        // #168. This was the ONE actor column in the schema with no explicit `OnDelete`, and the
        // EF default for a required foreign key is CASCADE -- so deleting a user would have taken
        // every notification template they authored with them. Templates are company-wide
        // configuration, not the author's personal data, and every other `CreatedBy`/`UpdatedBy`
        // into `users` is RESTRICT (see ActionPlanConfiguration, BenchmarkConfiguration and the
        // rest). Nothing hard-deletes a user today -- GDPR erasure pseudonymises the row and there
        // is no delete endpoint -- so this changes no behaviour now. It closes the trap that would
        // open the moment a hard delete is ever added.
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
