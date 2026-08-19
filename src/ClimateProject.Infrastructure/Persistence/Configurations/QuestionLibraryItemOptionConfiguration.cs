using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// Stable-value option rows, mirroring question_options exactly (#195). Legacy stored these
// as index-aligned options_en/options_es arrays, which is the defect that table exists to fix.
public class QuestionLibraryItemOptionConfiguration : IEntityTypeConfiguration<QuestionLibraryItemOption>
{
    public void Configure(EntityTypeBuilder<QuestionLibraryItemOption> builder)
    {
        builder.ToTable("question_library_item_options");
        builder.HasKey(o => new { o.QuestionLibraryItemId, o.Order });
        builder.Property(o => o.QuestionLibraryItemId).HasColumnName("question_library_item_id");
        builder.Property(o => o.Order).HasColumnName("order");
        builder.Property(o => o.Value).HasColumnName("value").HasMaxLength(500).IsRequired();
        builder.Property(o => o.LabelEn).HasColumnName("label_en").HasMaxLength(500);
        builder.Property(o => o.LabelEs).HasColumnName("label_es").HasMaxLength(500);

        builder.HasIndex(o => new { o.QuestionLibraryItemId, o.Value }).IsUnique();
        builder.HasOne<QuestionLibraryItem>().WithMany().HasForeignKey(o => o.QuestionLibraryItemId).OnDelete(DeleteBehavior.Cascade);
    }
}
