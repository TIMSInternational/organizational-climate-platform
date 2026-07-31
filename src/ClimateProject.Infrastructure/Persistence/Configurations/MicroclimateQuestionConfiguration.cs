using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateQuestionConfiguration : IEntityTypeConfiguration<MicroclimateQuestion>
{
    public void Configure(EntityTypeBuilder<MicroclimateQuestion> builder)
    {
        builder.ToTable("microclimate_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(q => q.Text).HasColumnName("text").HasMaxLength(300).IsRequired();
        builder.Property(q => q.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(q => q.Options).HasColumnName("options");
        builder.Property(q => q.Required).HasColumnName("required").IsRequired().HasDefaultValue(true);
        builder.Property(q => q.Order).HasColumnName("question_order").IsRequired();

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(q => q.MicroclimateId);
    }
}
