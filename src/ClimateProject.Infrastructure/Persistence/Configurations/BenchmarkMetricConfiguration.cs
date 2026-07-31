using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkMetricConfiguration : IEntityTypeConfiguration<BenchmarkMetric>
{
    public void Configure(EntityTypeBuilder<BenchmarkMetric> builder)
    {
        builder.ToTable("benchmark_metrics");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.BenchmarkId).HasColumnName("benchmark_id").IsRequired();
        builder.Property(m => m.MetricName).HasColumnName("metric_name").HasMaxLength(200).IsRequired();
        builder.Property(m => m.Value).HasColumnName("value").IsRequired();
        builder.Property(m => m.Unit).HasColumnName("unit").HasMaxLength(50).IsRequired();
        builder.Property(m => m.Percentile).HasColumnName("percentile");
        builder.Property(m => m.SampleSize).HasColumnName("sample_size");
        builder.Property(m => m.ConfidenceIntervalLower).HasColumnName("confidence_interval_lower");
        builder.Property(m => m.ConfidenceIntervalUpper).HasColumnName("confidence_interval_upper");

        builder.HasIndex(m => m.BenchmarkId);

        builder.HasOne<Benchmark>().WithMany().HasForeignKey(m => m.BenchmarkId);
    }
}
