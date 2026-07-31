using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsMetricDataConfiguration : IEntityTypeConfiguration<AnalyticsMetricData>
{
    public void Configure(EntityTypeBuilder<AnalyticsMetricData> builder)
    {
        builder.ToTable("analytics_metric_data");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.InsightId).HasColumnName("insight_id").IsRequired();
        builder.Property(m => m.Label).HasColumnName("label").HasMaxLength(200).IsRequired();
        builder.Property(m => m.Value).HasColumnName("value").IsRequired();
        builder.Property(m => m.Count).HasColumnName("count");
        builder.Property(m => m.Percentage).HasColumnName("percentage");

        builder.HasIndex(m => m.InsightId);

        builder.HasOne<AnalyticsInsight>().WithMany().HasForeignKey(m => m.InsightId);
    }
}
