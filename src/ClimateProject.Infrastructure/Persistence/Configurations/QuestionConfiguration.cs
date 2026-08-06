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
        // One DB default per language. The single "comment_prompt" column this replaces
        // carried an English string as its default, so a Spanish-only survey was served
        // an English prompt straight out of the DDL -- #195's one live defect. The
        // defaults live in the DDL rather than only in the CLR initialiser because a row
        // inserted outside EF (the #154 loader, a repair script) would otherwise backfill
        // with the raw CLR default; ContentI18nDefaultsTests proves it with a raw-SQL
        // insert, since an EF-insert-then-read passes even when the DB default is wrong.
        builder.Property(q => q.CommentPromptEn).HasColumnName("comment_prompt_en").HasMaxLength(500).IsRequired().HasDefaultValue("Please explain your answer:");
        builder.Property(q => q.CommentPromptEs).HasColumnName("comment_prompt_es").HasMaxLength(500).IsRequired().HasDefaultValue("Por favor explica tu respuesta:");
        builder.Property(q => q.BinaryCommentConfigEn).HasColumnName("binary_comment_config_en").HasColumnType("jsonb");
        builder.Property(q => q.BinaryCommentConfigEs).HasColumnName("binary_comment_config_es").HasColumnType("jsonb");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(q => q.Order).HasColumnName("order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<Survey>().WithMany().HasForeignKey(q => q.SurveyId);
    }
}
