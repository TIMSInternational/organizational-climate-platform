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

        // 16, not the sibling's 10. varchar(n) counts CHARACTERS -- code points -- so the
        // relevant measurements are: a family ZWJ sequence is 7 code points, a tag-sequence
        // flag is 7, and a kiss sequence with skin tones is 10. Ten therefore holds today's
        // longest common glyph with exactly zero headroom, and a column that silently
        // cannot hold a glyph an author can type is a 500 waiting to happen. Sixteen leaves
        // room for the next sequence Unicode adds. MicroclimateEndpoints checks the same
        // number, counted the same way, so an over-long glyph is a 400 naming the limit
        // rather than a DbUpdateException.
        builder.Property(o => o.Emoji).HasColumnName("emoji").HasMaxLength(16).IsRequired();

        // The accessible name. Nullable per locale for the same reason every other
        // localized column here is: a session authored in one language fills one side,
        // and the publish gate -- not the column -- is what refuses to put a half
        // translated scale in front of a respondent. MicroclimateEndpoints checks this
        // length too: guarding the glyph next door and not the name left a 100-character
        // name -- a phrase, not an exotic input -- reaching this column as a
        // DbUpdateException the author read as an opaque 500.
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
