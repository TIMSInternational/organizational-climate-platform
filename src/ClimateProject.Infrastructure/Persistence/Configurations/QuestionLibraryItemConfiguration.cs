using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// The authoring repository (#58/#112). Bilingual natively, so language is always "both".
public class QuestionLibraryItemConfiguration : IEntityTypeConfiguration<QuestionLibraryItem>
{
    public void Configure(EntityTypeBuilder<QuestionLibraryItem> builder)
    {
        builder.ToTable("question_library_items");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.CompanyId).HasColumnName("company_id");
        builder.Property(i => i.QuestionCategoryId).HasColumnName("question_category_id").IsRequired();
        builder.Property(i => i.TextEn).HasColumnName("text_en").HasMaxLength(500).IsRequired();
        builder.Property(i => i.TextEs).HasColumnName("text_es").HasMaxLength(500).IsRequired();
        builder.Property(i => i.Language).HasColumnName("language").HasMaxLength(10).IsRequired().HasDefaultValue("both");
        builder.Property(i => i.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
        builder.Property(i => i.ScaleMin).HasColumnName("scale_min");
        builder.Property(i => i.ScaleMax).HasColumnName("scale_max");
        builder.Property(i => i.ScaleLabelMinEn).HasColumnName("scale_label_min_en").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMinEs).HasColumnName("scale_label_min_es").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMaxEn).HasColumnName("scale_label_max_en").HasMaxLength(200);
        builder.Property(i => i.ScaleLabelMaxEs).HasColumnName("scale_label_max_es").HasMaxLength(200);
        builder.Property(i => i.Dimension).HasColumnName("dimension").HasMaxLength(100);
        builder.Property(i => i.UsageCount).HasColumnName("usage_count").IsRequired().HasDefaultValue(0);
        builder.Property(i => i.LastUsedAt).HasColumnName("last_used_at");
        builder.Property(i => i.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(i => i.Version).HasColumnName("version").IsRequired().HasDefaultValue(1);
        builder.Property(i => i.PreviousVersionId).HasColumnName("previous_version_id");
        builder.Property(i => i.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(i => i.LastModifiedBy).HasColumnName("last_modified_by");
        builder.Property(i => i.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(i => i.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(i => new { i.CompanyId, i.IsActive });
        builder.HasIndex(i => i.QuestionCategoryId);
        builder.HasIndex(i => i.Dimension);

        builder.HasOne<Company>().WithMany().HasForeignKey(i => i.CompanyId).OnDelete(DeleteBehavior.SetNull);
        // Restrict: an item without a category has nowhere to be filed, and the column is
        // non-nullable, so deleting a category that still holds items must fail loudly.
        builder.HasOne<QuestionCategory>().WithMany().HasForeignKey(i => i.QuestionCategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<QuestionLibraryItem>().WithMany().HasForeignKey(i => i.PreviousVersionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(i => i.LastModifiedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
