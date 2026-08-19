using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// The library's hierarchy (#58/#112). No level or path column: the parent pointer IS the
// hierarchy, exactly as departments do it. Both are derivable, and a stored copy drifts.
public class QuestionCategoryConfiguration : IEntityTypeConfiguration<QuestionCategory>
{
    public void Configure(EntityTypeBuilder<QuestionCategory> builder)
    {
        builder.ToTable("question_categories");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.CompanyId).HasColumnName("company_id");
        builder.Property(c => c.ParentCategoryId).HasColumnName("parent_category_id");
        builder.Property(c => c.NameEn).HasColumnName("name_en").HasMaxLength(100).IsRequired();
        builder.Property(c => c.NameEs).HasColumnName("name_es").HasMaxLength(100).IsRequired();
        builder.Property(c => c.DescriptionEn).HasColumnName("description_en").HasMaxLength(500);
        builder.Property(c => c.DescriptionEs).HasColumnName("description_es").HasMaxLength(500);
        builder.Property(c => c.Order).HasColumnName("order").IsRequired().HasDefaultValue(0);
        builder.Property(c => c.Icon).HasColumnName("icon").HasMaxLength(50);
        builder.Property(c => c.Color).HasColumnName("color").HasMaxLength(7);
        builder.Property(c => c.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(c => c.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(c => c.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(c => c.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(c => new { c.CompanyId, c.IsActive });
        builder.HasIndex(c => c.ParentCategoryId);

        // SetNull, not Cascade: a tenant purge must not silently delete the global tree a
        // company category happens to hang under. Matches every other nullable company_id.
        builder.HasOne<Company>().WithMany().HasForeignKey(c => c.CompanyId).OnDelete(DeleteBehavior.SetNull);
        // Restrict: deleting a parent that still has children is a mistake the caller should
        // see, not a silent subtree deletion.
        builder.HasOne<QuestionCategory>().WithMany().HasForeignKey(c => c.ParentCategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.CreatedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
