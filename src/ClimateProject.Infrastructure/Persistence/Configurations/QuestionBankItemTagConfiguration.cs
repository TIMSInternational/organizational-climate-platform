using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// Tags as rows rather than a text[] so the bank's tag filter is an indexed join.
public class QuestionBankItemTagConfiguration : IEntityTypeConfiguration<QuestionBankItemTag>
{
    public void Configure(EntityTypeBuilder<QuestionBankItemTag> builder)
    {
        builder.ToTable("question_bank_item_tags");
        builder.HasKey(t => new { t.QuestionBankItemId, t.Tag });
        builder.Property(t => t.QuestionBankItemId).HasColumnName("question_bank_item_id");
        builder.Property(t => t.Tag).HasColumnName("tag").HasMaxLength(50);

        builder.HasIndex(t => t.Tag);
        builder.HasOne<QuestionBankItem>().WithMany().HasForeignKey(t => t.QuestionBankItemId).OnDelete(DeleteBehavior.Cascade);
    }
}
