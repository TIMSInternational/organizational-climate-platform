namespace ClimateProject.Domain.Entities;

public class AnalyticsInsight
{
    public Guid Id { get; set; }
    public Guid? SurveyId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? DepartmentId { get; set; }
    public required string AggregationType { get; set; }
    public required string MetricType { get; set; }
    public required string MetricName { get; set; }
    public string? MetricDescription { get; set; }
    public int TotalResponses { get; set; }
    public DateTimeOffset CalculationDate { get; set; }
    public bool IsCurrent { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
