using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class AnalyticsTimeSeriesConfiguration : IEntityTypeConfiguration<AnalyticsTimeSeries>
{
    public void Configure(EntityTypeBuilder<AnalyticsTimeSeries> builder)
    {
        builder.ToTable("analytics_time_series");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.InsightId).HasColumnName("insight_id").IsRequired();
        builder.Property(t => t.Date).HasColumnName("date").IsRequired();
        builder.Property(t => t.Value).HasColumnName("value").IsRequired();
        builder.Property(t => t.Count).HasColumnName("count").IsRequired();

        builder.HasIndex(t => t.InsightId);

        builder.HasOne<AnalyticsInsight>().WithMany().HasForeignKey(t => t.InsightId);
    }
}
