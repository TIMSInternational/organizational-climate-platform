using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The person-independent half of a per-survey credentials email: which day it says the
/// survey closes.
///
/// <para>
/// <c>Survey.EndDate</c> is an instant, stored in UTC, and the server stops taking answers at
/// <c>EndDate &lt;= now</c>. Its UTC DATE is a different day from Costa Rica's for every close
/// at or after 18:00 there -- the defect the respondent screens carried until #615 (audit
/// 2026-10-22, R2). The email must print the company's day, not reintroduce that one.
/// </para>
/// </summary>
public class SurveyCredentialIssuanceTests
{
    private static Survey SurveyClosingAt(DateTimeOffset endDate) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        Type = "periodic",
        TitleEs = "Clima Organizacional ESPH 2026",
        Language = "es",
        StartDate = endDate.AddDays(-7),
        EndDate = endDate,
    };

    private static SurveyCredentialCompany Company(string? timezone) =>
        new("ESPH", "es", null, null, timezone);

    /// <summary>
    /// 27 Oct 2026 at 21:00 in Costa Rica (UTC-6) is 28 Oct 03:00 UTC. The mail says the 27th,
    /// which is the day the survey actually stops taking answers on the reader's clock.
    /// </summary>
    [Fact]
    public void An_evening_close_is_printed_on_the_companys_day_not_the_utc_day()
    {
        var survey = SurveyClosingAt(new DateTimeOffset(2026, 10, 28, 3, 0, 0, TimeSpan.Zero));

        var mail = SurveyCredentialIssuance.MailFor(survey, Company("America/Costa_Rica"));

        Assert.Equal(new DateOnly(2026, 10, 27), mail.SurveyClosesOn);
    }

    /// <summary>
    /// A company with no usable zone falls back to UTC, as every scheduler here does
    /// (<c>SchedulingTimeZone.Resolve</c>) -- the same instant then reads as the 28th.
    /// </summary>
    [Theory]
    [InlineData("UTC")]
    [InlineData(null)]
    [InlineData("Not/AZone")]
    public void A_company_with_no_usable_zone_reads_the_close_in_utc(string? timezone)
    {
        var survey = SurveyClosingAt(new DateTimeOffset(2026, 10, 28, 3, 0, 0, TimeSpan.Zero));

        var mail = SurveyCredentialIssuance.MailFor(survey, Company(timezone));

        Assert.Equal(new DateOnly(2026, 10, 28), mail.SurveyClosesOn);
    }

    /// <summary>And the title the mail names is the survey's, in the company's language.</summary>
    [Fact]
    public void The_mail_names_the_survey_in_the_companys_language()
    {
        var survey = SurveyClosingAt(new DateTimeOffset(2026, 10, 28, 3, 0, 0, TimeSpan.Zero));

        var mail = SurveyCredentialIssuance.MailFor(survey, Company("America/Costa_Rica"));

        Assert.Equal("Clima Organizacional ESPH 2026", mail.SurveyTitle);
    }
}
