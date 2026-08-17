using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class QuestionConfiguration : IEntityTypeConfiguration<Question>
{
    public void Configure(EntityTypeBuilder<Question> builder)
    {
        builder.ToTable("questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(q => q.TextEn).HasColumnName("text_en").HasMaxLength(500);
        builder.Property(q => q.TextEs).HasColumnName("text_es").HasMaxLength(500);
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.ScaleMin).HasColumnName("scale_min");
        builder.Property(q => q.ScaleMax).HasColumnName("scale_max");
        builder.Property(q => q.ScaleLabelMinEn).HasColumnName("scale_label_min_en").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMinEs).HasColumnName("scale_label_min_es").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMaxEn).HasColumnName("scale_label_max_en").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMaxEs).HasColumnName("scale_label_max_es").HasMaxLength(200);
        builder.Property(q => q.CommentRequired).HasColumnName("comment_required").IsRequired().HasDefaultValue(true);
        // Nullable with NO default in either the DDL or the CLR: a prompt exists only
        // when an author wrote one, and the respond UI renders a comment box only for
        // a present prompt. The per-language DDL defaults this replaces made the box
        // universal on every question ever authored.
        builder.Property(q => q.CommentPromptEn).HasColumnName("comment_prompt_en").HasMaxLength(500);
        builder.Property(q => q.CommentPromptEs).HasColumnName("comment_prompt_es").HasMaxLength(500);
        builder.Property(q => q.BinaryCommentConfigEn).HasColumnName("binary_comment_config_en").HasColumnType("jsonb");
        builder.Property(q => q.BinaryCommentConfigEs).HasColumnName("binary_comment_config_es").HasColumnType("jsonb");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(q => q.Order).HasColumnName("order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<Survey>().WithMany().HasForeignKey(q => q.SurveyId);
    }
}
