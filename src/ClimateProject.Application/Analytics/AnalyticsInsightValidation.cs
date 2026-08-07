namespace ClimateProject.Application.Analytics;

/// <summary>The create request's string fields after trimming, once they are known to be valid.</summary>
public sealed record NormalizedInsightFields(
    string AggregationType,
    string MetricType,
    string MetricName,
    string? MetricDescription);

/// <summary>Either an error message for the caller, or the normalized fields -- never both.</summary>
public sealed record InsightValidationResult(string? Error, NormalizedInsightFields? Fields)
{
    public static InsightValidationResult Invalid(string error) => new(error, null);

    public static InsightValidationResult Valid(NormalizedInsightFields fields) => new(null, fields);
}

/// <summary>
/// Shape checks for the analytics-insight write endpoints, as pure functions.
/// </summary>
/// <remarks>
/// <para>
/// These are not belt-and-braces. The lengths below are the ones
/// <c>AnalyticsInsightConfiguration</c> / <c>AnalyticsMetricDataConfiguration</c> put on the
/// columns, and Postgres answers an over-long value with a <c>22001</c> that surfaces as an
/// unhandled 500 rather than a 400 -- an admin pasting a long metric description would get
/// "something went wrong" instead of "that field is too long". The negative-count checks are
/// the same story in reverse: <c>total_responses</c> and <c>count</c> are plain <c>integer</c>
/// columns with no CHECK, so a negative response count would be stored happily and then divide
/// its way into a nonsense chart.
/// </para>
/// <para>
/// Lives in Application rather than beside the endpoint so it is unit-testable without a
/// database or a WebApplicationFactory -- the same reason <c>ContentPublishValidation</c> and
/// <c>CompanyScope</c> live here.
/// </para>
/// </remarks>
public static class AnalyticsInsightValidation
{
    public const int MaxAggregationTypeLength = 20;
    public const int MaxMetricTypeLength = 20;
    public const int MaxMetricNameLength = 200;
    public const int MaxMetricDescriptionLength = 1000;
    public const int MaxLabelLength = 200;

    public static InsightValidationResult ValidateCreate(CreateAnalyticsInsightRequest request)
    {
        // The record declares these non-nullable, but the value arrives from JSON: a body that
        // simply omits "aggregationType" binds null, so `?.` is load-bearing, not defensive noise.
        var aggregationType = request.AggregationType?.Trim();
        var metricType = request.MetricType?.Trim();
        var metricName = request.MetricName?.Trim();
        var metricDescription = request.MetricDescription?.Trim();

        var required = RequiredError("AggregationType", aggregationType, MaxAggregationTypeLength)
            ?? RequiredError("MetricType", metricType, MaxMetricTypeLength)
            ?? RequiredError("MetricName", metricName, MaxMetricNameLength);
        if (required is not null) return InsightValidationResult.Invalid(required);

        if (metricDescription is { Length: > MaxMetricDescriptionLength })
        {
            return InsightValidationResult.Invalid($"MetricDescription exceeds {MaxMetricDescriptionLength} characters");
        }

        if (request.TotalResponses < 0)
        {
            return InsightValidationResult.Invalid("TotalResponses may not be negative");
        }

        return InsightValidationResult.Valid(new NormalizedInsightFields(
            aggregationType!,
            metricType!,
            metricName!,
            // An all-whitespace description is not a description; store nothing rather than " ".
            string.IsNullOrWhiteSpace(metricDescription) ? null : metricDescription));
    }

    /// <summary>Returns the trimmed label, or an error message via <paramref name="error"/>.</summary>
    public static string? ValidateMetricData(AddMetricDataRequest request, out string? error)
    {
        var label = request.Label?.Trim();

        error = RequiredError("Label", label, MaxLabelLength);
        if (error is not null) return null;

        if (request.Count is < 0)
        {
            error = "Count may not be negative";
            return null;
        }

        return label;
    }

    /// <summary>Null when the point is acceptable, otherwise the caller-facing error message.</summary>
    public static string? ValidateTimeSeriesPoint(AddTimeSeriesPointRequest request)
        => request.Count < 0 ? "Count may not be negative" : null;

    private static string? RequiredError(string field, string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return $"{field} is required";
        return value.Length > maxLength ? $"{field} exceeds {maxLength} characters" : null;
    }
}
