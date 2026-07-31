namespace ClimateProject.Domain.Entities;

public class BenchmarkMetric
{
    public Guid Id { get; set; }
    public Guid BenchmarkId { get; set; }
    public required string MetricName { get; set; }
    public double Value { get; set; }
    public required string Unit { get; set; }
    public double? Percentile { get; set; }
    public int? SampleSize { get; set; }
    public double? ConfidenceIntervalLower { get; set; }
    public double? ConfidenceIntervalUpper { get; set; }
}
