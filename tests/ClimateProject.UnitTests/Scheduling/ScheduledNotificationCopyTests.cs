using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// The copy the scheduler writes itself. These are the only notifications with no human author,
/// and a Spanish-speaking employee receiving an English reminder is the same defect #78 and
/// #195 exist to prevent -- it is not made acceptable by the sender being a machine.
/// </summary>
public class ScheduledNotificationCopyTests
{
    private static readonly DateTimeOffset Closes = new(2026, 8, 20, 23, 59, 0, TimeSpan.Zero);

    [Fact]
    public void Reminder_copy_is_spanish_for_a_spanish_speaking_recipient()
    {
        var title = ScheduledNotificationCopy.ReminderTitleFor("es");
        var body = ScheduledNotificationCopy.ReminderBodyFor("es", "Clima Organizacional Q3", Closes);

        Assert.Equal("Recordatorio: tu respuesta sigue pendiente", title);
        Assert.Contains("Aun no has completado", body);
        Assert.Contains("Clima Organizacional Q3", body);
    }

    [Fact]
    public void Reminder_copy_is_english_for_an_english_speaking_recipient()
    {
        Assert.Contains("You have not yet completed",
            ScheduledNotificationCopy.ReminderBodyFor("en", "Q3 Climate Survey", Closes));
    }

    [Theory]
    [InlineData("ES")]
    [InlineData("es-CO")]
    [InlineData("es-MX")]
    public void A_bcp47_tag_resolves_to_its_base_locale(string locale)
        => Assert.Equal(
            "Recordatorio: tu respuesta sigue pendiente",
            ScheduledNotificationCopy.ReminderTitleFor(locale));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("fr")]
    [InlineData("klingon")]
    public void An_unknown_locale_falls_back_to_english_rather_than_producing_nothing(string? locale)
    {
        // UserPreferences.Language is a free varchar. Falling back matches web/src/i18n's
        // FALLBACK_LOCALE; producing an empty string would render a blank email.
        Assert.Equal("Reminder: your response is still pending", ScheduledNotificationCopy.ReminderTitleFor(locale));
        Assert.NotEmpty(ScheduledNotificationCopy.ReminderBodyFor(locale, "Survey", Closes));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_missing_content_title_uses_the_phrasing_that_does_not_name_it(string? title)
    {
        // Interpolating an absent title would render: You have not yet completed "".
        var body = ScheduledNotificationCopy.ReminderBodyFor("en", title, Closes);

        Assert.DoesNotContain("\"\"", body);
        Assert.Contains("You have a pending response", body);
    }

    [Fact]
    public void Digest_copy_uses_a_singular_phrasing_for_one_notification()
    {
        // "1 notificaciones" is the sort of thing that makes a product look machine-translated,
        // which is why singular and plural are separate phrases rather than one with an "(s)".
        var one = ScheduledNotificationCopy.DigestBodyFor("es", 1, Closes);
        var many = ScheduledNotificationCopy.DigestBodyFor("es", 4, Closes);

        Assert.Contains("1 notificacion nueva", one);
        Assert.Contains("4 notificaciones nuevas", many);
    }

    [Fact]
    public void Digest_copy_carries_the_period_start_so_the_recipient_knows_what_it_covers()
    {
        Assert.Contains("2026-08-20", ScheduledNotificationCopy.DigestBodyFor("en", 3, Closes));
    }

    [Fact]
    public void Report_copy_is_bilingual_and_carries_the_title_and_the_occurrence_date()
    {
        var english = ScheduledNotificationCopy.ReportReadyBodyFor("en", "Monthly climate report", Closes);
        var spanish = ScheduledNotificationCopy.ReportReadyBodyFor("es", "Informe mensual de clima", Closes);

        Assert.Equal("Your scheduled report is ready", ScheduledNotificationCopy.ReportReadyTitleFor("en"));
        Assert.Equal("Tu informe programado esta listo", ScheduledNotificationCopy.ReportReadyTitleFor("es"));
        Assert.Contains("Monthly climate report", english);
        Assert.Contains("2026-08-20", english);
        Assert.Contains("Informe mensual de clima", spanish);
        Assert.Contains("se ha generado", spanish);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_report_title_uses_the_phrasing_that_does_not_name_it(string? title)
    {
        // Same rule as the reminder: interpolating a blank renders an empty pair of quotes.
        var body = ScheduledNotificationCopy.ReportReadyBodyFor("en", title, Closes);

        Assert.DoesNotContain("\"\"", body);
        Assert.Contains("Your scheduled report for 2026-08-20", body);
    }

    [Fact]
    public void Every_generated_string_fits_the_notifications_title_column()
    {
        // notifications.title is varchar(500). A title that overflowed would fail the whole
        // batch's SaveChanges, taking every other reminder in the sweep down with it.
        Assert.All(
            new[]
            {
                ScheduledNotificationCopy.ReminderTitleFor("en"),
                ScheduledNotificationCopy.ReminderTitleFor("es"),
                ScheduledNotificationCopy.DigestTitleFor("en"),
                ScheduledNotificationCopy.DigestTitleFor("es"),
                ScheduledNotificationCopy.ReportReadyTitleFor("en"),
                ScheduledNotificationCopy.ReportReadyTitleFor("es"),
            },
            title => Assert.InRange(title.Length, 1, 500));
    }
}
