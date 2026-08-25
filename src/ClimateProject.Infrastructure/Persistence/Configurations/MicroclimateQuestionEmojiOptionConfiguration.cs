using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

// The emoji scale of a microclimate question (#198). Shape and key mirror
// question_emoji_options, which is the survey-side table this one is the microclimate
// sibling of -- same fan-out pattern microclimate_question_options already follows
// beside question_options.
public class MicroclimateQuestionEmojiOptionConfiguration : IEntityTypeConfiguration<MicroclimateQuestionEmojiOption>
{
    public void Configure(EntityTypeBuilder<MicroclimateQuestionEmojiOption> builder)
    {
        builder.ToTable("microclimate_question_emoji_options");
        builder.HasKey(o => new { o.MicroclimateQuestionId, o.Order });
        builder.Property(o => o.MicroclimateQuestionId).HasColumnName("microclimate_question_id");
        builder.Property(o => o.Order).HasColumnName("order");

        // 16, not the sibling's 10. Ten UTF-16 units covers a code point plus a variation
        // selector and a skin-tone modifier, but not a ZWJ sequence -- and a column that
        // silently cannot hold a glyph an author can type is a 500 waiting to happen.
        // MicroclimateEndpoints checks the same number first so an over-long glyph is a
        // 400 naming the limit rather than a DbUpdateException.
        builder.Property(o => o.Emoji).HasColumnName("emoji").HasMaxLength(16).IsRequired();

        // The accessible name. Nullable per locale for the same reason every other
        // localized column here is: a session authored in one language fills one side,
        // and the publish gate -- not the column -- is what refuses to put a half
        // translated scale in front of a respondent.
        builder.Property(o => o.LabelEn).HasColumnName("label_en").HasMaxLength(100);
        builder.Property(o => o.LabelEs).HasColumnName("label_es").HasMaxLength(100);

        builder.Property(o => o.Value).HasColumnName("value").IsRequired();

        // Two points of one scale must not share a value: the value is what a submitted
        // answer is matched against, so a duplicate makes the stored answer ambiguous.
        // question_emoji_options has no such index and should; this one is written the
        // way microclimate_question_options was, which added it deliberately.
        builder.HasIndex(o => new { o.MicroclimateQuestionId, o.Value }).IsUnique();

        builder.HasOne<MicroclimateQuestion>().WithMany().HasForeignKey(o => o.MicroclimateQuestionId).OnDelete(DeleteBehavior.Cascade);
    }
}
