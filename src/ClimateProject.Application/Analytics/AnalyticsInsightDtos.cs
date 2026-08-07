namespace ClimateProject.Application.Analytics;

/// <summary>One categorical bar/slice of an insight -- "Satisfied: 42.5 (120 responses, 60%)".</summary>
public sealed record MetricDataPointDto(Guid Id, string Label, double Value, int? Count, double? Percentage);

/// <summary>One point on an insight's trend line.</summary>
public sealed record TimeSeriesPointDto(Guid Id, DateTimeOffset Date, double Value, int Count);

public sealed record AnalyticsInsightListItem(
    Guid Id, Guid CompanyId, string MetricType, string MetricName, bool IsCurrent, DateTimeOffset CalculationDate);

/// <remarks>
/// <para>
/// <c>MetricName</c> / <c>MetricDescription</c> carry no <c>En</c>/<c>Es</c> shape, and that is
/// correct rather than an oversight of #195: an analytics insight is a computed aggregate, not
/// Tier 1 authored content, and <c>analytics_insights</c> has no paired locale columns. Should
/// these ever need translating, the fix is a migration plus
/// <c>ClimateProject.Application.Localization</c>, never an <c>*_en</c>/<c>*_es</c> pair on this
/// read DTO -- which is exactly what the #195 constraint forbids.
/// </para>
/// <para>
/// <c>MetricData</c> is ordered by label then id and <c>TimeSeries</c> by date then id, so a
/// chart drawn from this payload is stable across refetches even when two rows collide on the
/// sort key. See <c>AnalyticsInsightEndpoints.LoadDetailAsync</c>.
/// </para>
/// </remarks>
public sealed record AnalyticsInsightDetail(
    Guid Id, Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string AggregationType,
    string MetricType, string MetricName, string? MetricDescription, int TotalResponses,
    DateTimeOffset CalculationDate, bool IsCurrent,
    IReadOnlyList<MetricDataPointDto> MetricData, IReadOnlyList<TimeSeriesPointDto> TimeSeries);

/// <remarks>
/// <c>CalculationDate</c> and <c>IsCurrent</c> are deliberately absent: the server stamps the
/// calculation time and every new insight starts current, so accepting them would let a caller
/// backdate an aggregate it did not compute.
/// </remarks>
public sealed record CreateAnalyticsInsightRequest(
    Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string AggregationType,
    string MetricType, string MetricName, string? MetricDescription, int TotalResponses);

public sealed record AddMetricDataRequest(string Label, double Value, int? Count, double? Percentage);

public sealed record AddTimeSeriesPointRequest(DateTimeOffset Date, double Value, int Count);
