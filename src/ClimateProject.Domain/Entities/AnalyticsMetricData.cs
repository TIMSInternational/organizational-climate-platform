namespace ClimateProject.Domain.Entities;

public class AnalyticsMetricData
{
    public Guid Id { get; set; }
    public Guid InsightId { get; set; }
    public required string Label { get; set; }
    public double Value { get; set; }
    public int? Count { get; set; }
    public double? Percentage { get; set; }
}
