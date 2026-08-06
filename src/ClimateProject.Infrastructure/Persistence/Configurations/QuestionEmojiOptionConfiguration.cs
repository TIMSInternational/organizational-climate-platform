using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionEmojiOptionConfiguration : IEntityTypeConfiguration<QuestionEmojiOption>
{
    public void Configure(EntityTypeBuilder<QuestionEmojiOption> builder)
    {
        builder.ToTable("question_emoji_options");
        builder.HasKey(e => new { e.QuestionId, e.Order });
        builder.Property(e => e.QuestionId).HasColumnName("question_id");
        builder.Property(e => e.Order).HasColumnName("order");
        builder.Property(e => e.Emoji).HasColumnName("emoji").HasMaxLength(10).IsRequired();
        builder.Property(e => e.LabelEn).HasColumnName("label_en").HasMaxLength(100);
        builder.Property(e => e.LabelEs).HasColumnName("label_es").HasMaxLength(100);
        builder.Property(e => e.Value).HasColumnName("value").IsRequired();

        builder.HasOne<Question>().WithMany().HasForeignKey(e => e.QuestionId);
    }
}
