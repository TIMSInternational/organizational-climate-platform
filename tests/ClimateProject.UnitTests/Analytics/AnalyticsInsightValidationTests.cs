using ClimateProject.Application.Analytics;

namespace ClimateProject.UnitTests.Analytics;

/// <summary>
/// Guards the write-shape rules for /admin/analytics-insights. Each max-length here is the
/// matching column's length in AnalyticsInsightConfiguration / AnalyticsMetricDataConfiguration;
/// if one of those ever changes without this file changing, the endpoint starts answering
/// over-long input with a Postgres 22001 (a 500) instead of a 400.
/// </summary>
public class AnalyticsInsightValidationTests
{
    private static readonly Guid CompanyId = Guid.NewGuid();

    private static CreateAnalyticsInsightRequest CreateRequest(
        string aggregationType = "company_wide",
        string metricType = "engagement",
        string metricName = "Overall Engagement",
        string? metricDescription = null,
        int totalResponses = 0) => new(
            SurveyId: null,
            CompanyId: CompanyId,
            DepartmentId: null,
            AggregationType: aggregationType,
            MetricType: metricType,
            MetricName: metricName,
            MetricDescription: metricDescription,
            TotalResponses: totalResponses);

    [Fact]
    public void A_valid_create_request_returns_trimmed_fields_and_no_error()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            aggregationType: "  company_wide  ",
            metricType: " engagement ",
            metricName: "  Overall Engagement  ",
            metricDescription: "  Mean of all engagement items.  ",
            totalResponses: 120));

        Assert.Null(result.Error);
        Assert.Equal("company_wide", result.Fields!.AggregationType);
        Assert.Equal("engagement", result.Fields.MetricType);
        Assert.Equal("Overall Engagement", result.Fields.MetricName);
        Assert.Equal("Mean of all engagement items.", result.Fields.MetricDescription);
    }

    [Theory]
    [InlineData("", "engagement", "Name", "AggregationType is required")]
    [InlineData("   ", "engagement", "Name", "AggregationType is required")]
    [InlineData("company_wide", "", "Name", "MetricType is required")]
    [InlineData("company_wide", "  ", "Name", "MetricType is required")]
    [InlineData("company_wide", "engagement", "", "MetricName is required")]
    [InlineData("company_wide", "engagement", "   ", "MetricName is required")]
    public void Blank_required_fields_are_rejected(string aggregationType, string metricType, string metricName, string expected)
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(aggregationType, metricType, metricName));

        Assert.Equal(expected, result.Error);
        Assert.Null(result.Fields);
    }

    [Fact]
    public void A_null_required_field_is_rejected_rather_than_throwing()
    {
        // A JSON body that simply omits the property binds null despite the record declaring
        // the parameter non-nullable -- nullable reference types are not a runtime guarantee.
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(metricName: null!));

        Assert.Equal("MetricName is required", result.Error);
    }

    [Fact]
    public void Fields_at_exactly_the_column_length_are_accepted()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            aggregationType: new string('a', AnalyticsInsightValidation.MaxAggregationTypeLength),
            metricType: new string('m', AnalyticsInsightValidation.MaxMetricTypeLength),
            metricName: new string('n', AnalyticsInsightValidation.MaxMetricNameLength),
            metricDescription: new string('d', AnalyticsInsightValidation.MaxMetricDescriptionLength)));

        Assert.Null(result.Error);
    }

    [Fact]
    public void An_over_long_aggregation_type_is_rejected()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            aggregationType: new string('a', AnalyticsInsightValidation.MaxAggregationTypeLength + 1)));

        Assert.Equal($"AggregationType exceeds {AnalyticsInsightValidation.MaxAggregationTypeLength} characters", result.Error);
    }

    [Fact]
    public void An_over_long_metric_type_is_rejected()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            metricType: new string('m', AnalyticsInsightValidation.MaxMetricTypeLength + 1)));

        Assert.Equal($"MetricType exceeds {AnalyticsInsightValidation.MaxMetricTypeLength} characters", result.Error);
    }

    [Fact]
    public void An_over_long_metric_name_is_rejected()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            metricName: new string('n', AnalyticsInsightValidation.MaxMetricNameLength + 1)));

        Assert.Equal($"MetricName exceeds {AnalyticsInsightValidation.MaxMetricNameLength} characters", result.Error);
    }

    [Fact]
    public void An_over_long_metric_description_is_rejected()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(
            metricDescription: new string('d', AnalyticsInsightValidation.MaxMetricDescriptionLength + 1)));

        Assert.Equal($"MetricDescription exceeds {AnalyticsInsightValidation.MaxMetricDescriptionLength} characters", result.Error);
    }

    [Fact]
    public void A_whitespace_only_description_is_normalized_to_null()
    {
        // The description is optional, so "   " must not be stored as a description that the
        // dashboard would then render as an empty caption block.
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(metricDescription: "   "));

        Assert.Null(result.Error);
        Assert.Null(result.Fields!.MetricDescription);
    }

    [Fact]
    public void A_negative_total_responses_is_rejected()
    {
        var result = AnalyticsInsightValidation.ValidateCreate(CreateRequest(totalResponses: -1));

        Assert.Equal("TotalResponses may not be negative", result.Error);
    }

    [Fact]
    public void Zero_total_responses_is_allowed()
    {
        // An insight computed before anyone answered is legitimate -- it is the empty state,
        // not an error.
        Assert.Null(AnalyticsInsightValidation.ValidateCreate(CreateRequest(totalResponses: 0)).Error);
    }

    [Fact]
    public void Metric_data_returns_the_trimmed_label()
    {
        var label = AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest("  Satisfied  ", 42.5, 120, 60.0), out var error);

        Assert.Null(error);
        Assert.Equal("Satisfied", label);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Metric_data_rejects_a_blank_label(string label)
    {
        AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest(label, 1.0, null, null), out var error);

        Assert.Equal("Label is required", error);
    }

    [Fact]
    public void Metric_data_rejects_an_over_long_label()
    {
        var label = new string('x', AnalyticsInsightValidation.MaxLabelLength + 1);

        AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest(label, 1.0, null, null), out var error);

        Assert.Equal($"Label exceeds {AnalyticsInsightValidation.MaxLabelLength} characters", error);
    }

    [Fact]
    public void Metric_data_rejects_a_negative_count_but_allows_a_null_one()
    {
        AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest("Satisfied", 1.0, -1, null), out var negative);
        Assert.Equal("Count may not be negative", negative);

        // Count is nullable on the column: "we know the value but not how many rows produced
        // it" is a real state, so null must not trip the relational pattern.
        var label = AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest("Satisfied", 1.0, null, null), out var missing);
        Assert.Null(missing);
        Assert.Equal("Satisfied", label);
    }

    [Fact]
    public void Metric_data_allows_a_negative_value()
    {
        // Value is not a count -- a period-over-period delta is legitimately negative.
        var label = AnalyticsInsightValidation.ValidateMetricData(new AddMetricDataRequest("Change", -12.5, 0, null), out var error);

        Assert.Null(error);
        Assert.Equal("Change", label);
    }

    [Fact]
    public void A_time_series_point_rejects_a_negative_count()
    {
        var error = AnalyticsInsightValidation.ValidateTimeSeriesPoint(
            new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, 1.0, -1));

        Assert.Equal("Count may not be negative", error);
    }

    [Fact]
    public void A_time_series_point_with_a_zero_count_and_a_negative_value_is_accepted()
    {
        var error = AnalyticsInsightValidation.ValidateTimeSeriesPoint(
            new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, -3.25, 0));

        Assert.Null(error);
    }
}
