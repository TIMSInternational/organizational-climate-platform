using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class TemplateQuestionConfiguration : IEntityTypeConfiguration<TemplateQuestion>
{
    public void Configure(EntityTypeBuilder<TemplateQuestion> builder)
    {
        builder.ToTable("template_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(500).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options").HasColumnType("text[]");
        builder.Property(q => q.ScaleMin).HasColumnName("scale_min");
        builder.Property(q => q.ScaleMax).HasColumnName("scale_max");
        builder.Property(q => q.ScaleLabelMin).HasColumnName("scale_label_min").HasMaxLength(200);
        builder.Property(q => q.ScaleLabelMax).HasColumnName("scale_label_max").HasMaxLength(200);
        builder.Property(q => q.CommentRequired).HasColumnName("comment_required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.CommentPrompt).HasColumnName("comment_prompt").HasMaxLength(500).IsRequired().HasDefaultValue("Please explain your answer:");
        builder.Property(q => q.BinaryCommentConfig).HasColumnName("binary_comment_config").HasColumnType("jsonb");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(q => q.Order).HasColumnName("order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<SurveyTemplate>().WithMany().HasForeignKey(q => q.TemplateId);
    }
}
