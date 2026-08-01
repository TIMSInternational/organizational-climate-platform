namespace ClimateProject.Application.Reports;

public sealed record BenchmarkMetricDto(Guid Id, string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);

public sealed record BenchmarkListItem(Guid Id, string Name, string Type, string Category, Guid? CompanyId, bool IsActive, double QualityScore);

public sealed record BenchmarkDetail(
    Guid Id, string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, bool IsActive,
    string ValidationStatus, double QualityScore, Guid? PriorPeriodBenchmarkId,
    IReadOnlyList<BenchmarkMetricDto> Metrics);

public sealed record CreateBenchmarkRequest(
    string Name, string Description, string Type, string Category, string Source,
    string? Industry, string? CompanySize, string? Region, Guid? CompanyId, Guid? PriorPeriodBenchmarkId);

public sealed record AddBenchmarkMetricRequest(string MetricName, double Value, string Unit, double? Percentile, int? SampleSize);
