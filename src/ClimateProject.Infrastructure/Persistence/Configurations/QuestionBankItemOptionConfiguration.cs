using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// Stable-value option rows. Legacy QuestionBank stored a bare string[]; that is the same
// defect question_options exists to fix, so the bank gets the same treatment.
public class QuestionBankItemOptionConfiguration : IEntityTypeConfiguration<QuestionBankItemOption>
{
    public void Configure(EntityTypeBuilder<QuestionBankItemOption> builder)
    {
        builder.ToTable("question_bank_item_options");
        builder.HasKey(o => new { o.QuestionBankItemId, o.Order });
        builder.Property(o => o.QuestionBankItemId).HasColumnName("question_bank_item_id");
        builder.Property(o => o.Order).HasColumnName("order");
        builder.Property(o => o.Value).HasColumnName("value").HasMaxLength(500).IsRequired();
        builder.Property(o => o.LabelEn).HasColumnName("label_en").HasMaxLength(500);
        builder.Property(o => o.LabelEs).HasColumnName("label_es").HasMaxLength(500);

        builder.HasIndex(o => new { o.QuestionBankItemId, o.Value }).IsUnique();
        builder.HasOne<QuestionBankItem>().WithMany().HasForeignKey(o => o.QuestionBankItemId).OnDelete(DeleteBehavior.Cascade);
    }
}
