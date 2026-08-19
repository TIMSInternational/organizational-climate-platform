using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// Tags as rows rather than a text[] so the picker's tag filter is an indexed join.
public class QuestionLibraryItemTagConfiguration : IEntityTypeConfiguration<QuestionLibraryItemTag>
{
    public void Configure(EntityTypeBuilder<QuestionLibraryItemTag> builder)
    {
        builder.ToTable("question_library_item_tags");
        builder.HasKey(t => new { t.QuestionLibraryItemId, t.Tag });
        builder.Property(t => t.QuestionLibraryItemId).HasColumnName("question_library_item_id");
        builder.Property(t => t.Tag).HasColumnName("tag").HasMaxLength(50);

        builder.HasIndex(t => t.Tag);
        builder.HasOne<QuestionLibraryItem>().WithMany().HasForeignKey(t => t.QuestionLibraryItemId).OnDelete(DeleteBehavior.Cascade);
    }
}
