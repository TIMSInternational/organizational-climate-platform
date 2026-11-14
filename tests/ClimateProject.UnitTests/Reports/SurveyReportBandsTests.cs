using ClimateProject.Application.Reports.SurveyReports;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// Which of the company's areas a reading falls in. The report colours a cell by it and prints
/// the reading beside it, so the two must agree on the number as printed.
/// </summary>
public class SurveyReportBandsTests
{
    private static readonly SurveyReportBands Bands = new(3.00m, 4.00m, "Crítica", "Oportunidad", "Fortaleza");

    [Theory]
    [InlineData(1.00, SurveyReportBand.Critical)]
    [InlineData(2.99, SurveyReportBand.Critical)]
    [InlineData(3.00, SurveyReportBand.Opportunity)]
    [InlineData(3.99, SurveyReportBand.Opportunity)]
    [InlineData(4.00, SurveyReportBand.Strength)]
    [InlineData(5.00, SurveyReportBand.Strength)]
    public void A_reading_falls_in_the_area_its_boundaries_say(double mean, SurveyReportBand expected)
        => Assert.Equal(expected, Bands.Of(mean));

    [Fact]
    public void A_reading_printed_as_4_00_is_never_coloured_as_an_opportunity()
    {
        // 3.995 prints «4,00»; coloured on the unrounded value it would sit in the amber area
        // beside a number that says it reached the strength boundary.
        Assert.Equal(SurveyReportBand.Strength, Bands.Of(3.995));
        Assert.Equal(SurveyReportBand.Opportunity, Bands.Of(3.994));
    }

    [Fact]
    public void A_company_with_its_own_boundaries_and_names_gets_them()
    {
        var custom = new SurveyReportBands(3.50m, 4.20m, "Atención", "Mejora", "Logro");

        Assert.Equal(SurveyReportBand.Critical, custom.Of(3.49));
        Assert.Equal(SurveyReportBand.Opportunity, custom.Of(4.19));
        Assert.Equal("Logro", custom.NameOf(custom.Of(4.2)));
        Assert.Equal("Atención", custom.NameOf(SurveyReportBand.Critical));
    }
}
