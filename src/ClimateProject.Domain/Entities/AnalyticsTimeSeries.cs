namespace ClimateProject.Domain.Entities;

public class AnalyticsTimeSeries
{
    public Guid Id { get; set; }
    public Guid InsightId { get; set; }
    public DateTimeOffset Date { get; set; }
    public double Value { get; set; }
    public int Count { get; set; }
}
