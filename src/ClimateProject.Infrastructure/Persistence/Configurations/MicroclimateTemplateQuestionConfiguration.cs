using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateTemplateQuestionConfiguration : IEntityTypeConfiguration<MicroclimateTemplateQuestion>
{
    public void Configure(EntityTypeBuilder<MicroclimateTemplateQuestion> builder)
    {
        builder.ToTable("microclimate_template_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.TemplateId).HasColumnName("template_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(300).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.Order).HasColumnName("question_order").IsRequired();
        builder.Property(q => q.Category).HasColumnName("category").HasMaxLength(100);

        builder.HasOne<MicroclimateTemplate>().WithMany().HasForeignKey(q => q.TemplateId);
    }
}
