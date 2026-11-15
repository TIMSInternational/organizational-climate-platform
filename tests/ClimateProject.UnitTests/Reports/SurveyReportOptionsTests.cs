using ClimateProject.Application.Reports.SurveyReports;

namespace ClimateProject.UnitTests.Reports;

public class SurveyReportOptionsTests
{
    [Fact]
    public void An_empty_request_is_every_default_section_every_department_and_no_cross()
    {
        Assert.True(SurveyReportOptions.TryParse(null, null, null, null, out var options, out var error));
        Assert.Null(error);
        Assert.Equal(SurveyReportSections.Default.ToHashSet(), options.Sections.ToHashSet());
        Assert.DoesNotContain(SurveyReportSections.Comments, options.Sections);
        Assert.Null(options.DepartmentIds);
        Assert.Empty(options.Crosses);
        Assert.Null(options.CompareSurveyId);
    }

    [Fact]
    public void Crosses_read_as_one_variable_or_two()
    {
        Assert.True(SurveyReportOptions.TryParse("crosses", null, ["department*gender", "tenure"], null, out var options, out _));
        Assert.Equal(
            [new SurveyReportCrossRequest("department", "gender"), new SurveyReportCrossRequest("tenure", null)],
            options.Crosses);
    }

    [Theory]
    [InlineData("summary,nonsense", null, null, null, "Unknown report section")]
    [InlineData(null, "not-a-guid", null, null, "must be a department id")]
    [InlineData(null, null, "gender*gender", null, "crosses a variable with itself")]
    [InlineData(null, null, "a*b*c", null, "must read 'field' or 'field*field'")]
    [InlineData(null, null, null, "yesterday", "compare must be a survey id")]
    public void A_request_it_cannot_honour_is_refused_in_words(string? sections, string? department, string? cross, string? compare, string expected)
    {
        Assert.False(SurveyReportOptions.TryParse(
            sections,
            department is null ? null : [department],
            cross is null ? null : [cross],
            compare,
            out _,
            out var error));
        Assert.Contains(expected, error, StringComparison.Ordinal);
    }

    [Fact]
    public void The_same_cross_transposed_is_the_same_cross()
    {
        Assert.False(SurveyReportOptions.TryParse(null, null, ["department*gender", "gender*department"], null, out _, out var error));
        Assert.Contains("listed twice", error, StringComparison.Ordinal);
    }

    [Fact]
    public void A_report_carries_at_most_four_crosses()
    {
        Assert.False(SurveyReportOptions.TryParse(null, null, ["a", "b", "c", "d", "e"], null, out _, out var error));
        Assert.Contains($"at most {SurveyReportOptions.MaxCrosses}", error, StringComparison.Ordinal);
    }

    [Fact]
    public void A_department_named_twice_is_kept_once()
    {
        var id = Guid.NewGuid().ToString();
        Assert.True(SurveyReportOptions.TryParse(null, [id, id], null, null, out var options, out _));
        Assert.Single(options.DepartmentIds!);
    }
}
