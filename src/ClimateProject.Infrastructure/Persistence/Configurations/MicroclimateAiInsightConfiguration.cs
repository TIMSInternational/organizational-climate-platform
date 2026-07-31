using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateAiInsightConfiguration : IEntityTypeConfiguration<MicroclimateAiInsight>
{
    public void Configure(EntityTypeBuilder<MicroclimateAiInsight> builder)
    {
        builder.ToTable("microclimate_ai_insights");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(i => i.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(i => i.Message).HasColumnName("message").HasMaxLength(1000).IsRequired();
        builder.Property(i => i.Confidence).HasColumnName("confidence").IsRequired();
        builder.Property(i => i.Timestamp).HasColumnName("timestamp").IsRequired();

        builder.HasIndex(i => i.MicroclimateId);

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(i => i.MicroclimateId);
    }
}
