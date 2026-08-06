using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// The digest schedule, which is where "whose day is it" gets answered.
///
/// Every case here is a pure function of a clock passed in, so the whole of a year's worth of
/// behaviour -- DST both directions, ISO week rollover across New Year, month-length clamping,
/// half-hour offset zones -- is provable in milliseconds. That is the entire reason
/// <see cref="DigestSchedule"/> is not written inside the worker.
/// </summary>
public class DigestScheduleTests
{
    // IANA ids. .NET resolves these on Linux and macOS natively and maps them on Windows, so
    // the tests run everywhere CI does. Bogota is fixed at UTC-5 with no DST, which makes it
    // the clean case; Santiago and Kathmandu are the awkward ones on purpose.
    private static readonly TimeZoneInfo Bogota = TimeZoneInfo.FindSystemTimeZoneById("America/Bogota");
    private static readonly TimeZoneInfo Santiago = TimeZoneInfo.FindSystemTimeZoneById("America/Santiago");
    private static readonly TimeZoneInfo Kathmandu = TimeZoneInfo.FindSystemTimeZoneById("Asia/Kathmandu");

    private static DateTimeOffset Utc(int year, int month, int day, int hour = 0, int minute = 0)
        => new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    // -- "never" means never ------------------------------------------------------------

    [Fact]
    public void Never_is_never_due_at_any_instant_in_any_zone()
    {
        // Swept across a whole year at three-hour resolution rather than spot-checked: "never"
        // failing on one hour of one day a year is exactly the bug that would ship.
        for (var instant = Utc(2026, 1, 1); instant < Utc(2027, 1, 1); instant = instant.AddHours(3))
        {
            Assert.Null(DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestNever, instant, Bogota));
            Assert.Null(DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestNever, instant, Santiago));
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("hourly")]
    [InlineData("Daily")]
    [InlineData("weekly ")]
    public void Unrecognised_frequencies_fail_closed(string frequency)
        => Assert.Null(DigestSchedule.DueWindow(frequency, Utc(2026, 8, 6, 20), Bogota));

    [Fact]
    public void Null_frequency_fails_closed()
        => Assert.Null(DigestSchedule.DueWindow(null, Utc(2026, 8, 6, 20), Bogota));

    [Fact]
    public void Every_valid_frequency_except_never_is_schedulable()
    {
        foreach (var frequency in NotificationPreferenceValidation.ValidDigestFrequencies)
        {
            Assert.Equal(
                frequency != NotificationPreferenceValidation.DigestNever,
                DigestSchedule.IsSchedulable(frequency));
        }
    }

    // -- the timezone is the recipient's, not the server's -------------------------------

    [Fact]
    public void Daily_digest_is_not_due_before_the_send_hour_in_the_recipients_own_zone()
    {
        // 12:00 UTC on 6 August is 07:00 in Bogota -- before the 08:00 send hour. A server
        // reading its own clock would have called this due seven hours earlier.
        Assert.Null(DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 12), Bogota));

        // 13:00 UTC is 08:00 in Bogota. Now it is due.
        var window = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 13), Bogota);

        Assert.NotNull(window);
        Assert.Equal("2026-08-06", window.PeriodKey);
    }

    [Fact]
    public void Two_recipients_in_different_zones_get_different_period_keys_at_the_same_instant()
    {
        // 03:00 UTC on 7 August: still 22:00 on the 6th in Bogota, already 08:45 on the 7th in
        // Kathmandu. Same instant, two different local days, two different digests owed.
        var instant = Utc(2026, 8, 7, 3);

        var bogota = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, instant, Bogota);
        var kathmandu = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, instant, Kathmandu);

        Assert.NotNull(bogota);
        Assert.NotNull(kathmandu);
        Assert.Equal("2026-08-06", bogota.PeriodKey);
        Assert.Equal("2026-08-07", kathmandu.PeriodKey);
    }

    [Fact]
    public void An_unrecognised_timezone_resolves_to_utc_rather_than_dropping_the_recipient()
    {
        var resolved = SchedulingTimeZone.Resolve("Mars/Olympus_Mons");

        Assert.Equal(TimeZoneInfo.Utc, resolved);
        Assert.NotNull(DigestSchedule.DueWindow(
            NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 9), resolved));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void A_blank_timezone_resolves_to_utc(string? id)
        => Assert.Equal(TimeZoneInfo.Utc, SchedulingTimeZone.Resolve(id));

    // -- period identity ----------------------------------------------------------------

    [Fact]
    public void Every_instant_within_one_local_day_yields_the_same_daily_period_key()
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);

        // 13:00 UTC on the 6th (08:00 Bogota, the send hour) through 04:00 UTC on the 7th
        // (23:00 Bogota) -- the whole of the eligible part of one Bogota day.
        for (var instant = Utc(2026, 8, 6, 13); instant <= Utc(2026, 8, 7, 4); instant = instant.AddMinutes(30))
        {
            var window = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, instant, Bogota);
            Assert.NotNull(window);
            keys.Add(window.PeriodKey);
        }

        // One key across sixteen hours of ticks is what makes the deterministic id stable, and
        // therefore what makes a repeated send a primary key violation rather than a second email.
        Assert.Equal(["2026-08-06"], keys);
    }

    [Fact]
    public void Weekly_periods_start_on_monday_and_use_iso_week_numbering()
    {
        // Thursday 6 August 2026 is in ISO week 32; the period starts Monday the 3rd.
        var window = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestWeekly, Utc(2026, 8, 6, 13), Bogota);

        Assert.NotNull(window);
        Assert.Equal("2026-W32", window.PeriodKey);
        Assert.Equal(new DateTime(2026, 8, 3, 0, 0, 0), window.ContentToUtc.ToOffset(TimeSpan.FromHours(-5)).DateTime);
        Assert.Equal(new DateTime(2026, 7, 27, 0, 0, 0), window.ContentFromUtc.ToOffset(TimeSpan.FromHours(-5)).DateTime);
    }

    [Fact]
    public void Weekly_period_keys_roll_over_the_new_year_the_ISO_way_not_the_calendar_way()
    {
        // Monday 30 December 2024 belongs to ISO week 1 of *2025*, because the week containing
        // the first Thursday of January is week 1 and that Thursday is 2 January 2025. A key
        // built from `date.Year` plus the week number would file this under 2024-W01 -- which
        // is a different, real week in the same year -- and the deterministic notification id
        // would then treat one of the two digests as a duplicate of the other and drop it.
        var decemberInJanuarysWeek = DigestSchedule.PeriodKey(
            NotificationPreferenceValidation.DigestWeekly, new DateTime(2024, 12, 30));

        // And the reverse: 31 December 2029 is a Monday that starts ISO week 1 of 2030.
        var lastDayOfTheYear = DigestSchedule.PeriodKey(
            NotificationPreferenceValidation.DigestWeekly, new DateTime(2029, 12, 31));

        // A genuine week 53 is still reported as one, rather than being folded into the next
        // year -- 2026 has 53 ISO weeks and 28 December is the Monday of the last of them.
        var genuineWeek53 = DigestSchedule.PeriodKey(
            NotificationPreferenceValidation.DigestWeekly, new DateTime(2026, 12, 28));

        Assert.Equal("2025-W01", decemberInJanuarysWeek);
        Assert.Equal("2030-W01", lastDayOfTheYear);
        Assert.Equal("2026-W53", genuineWeek53);
    }

    [Fact]
    public void Monthly_periods_span_the_calendar_month_including_february()
    {
        var window = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestMonthly, Utc(2026, 3, 15, 13), Bogota);

        Assert.NotNull(window);
        Assert.Equal("2026-03", window.PeriodKey);

        // The content window is the *previous* month -- 1 February to 1 March -- so a monthly
        // digest summarises a completed month rather than however much of the current one has
        // elapsed. February's short length is handled by the calendar, not by day arithmetic.
        Assert.Equal(new DateTime(2026, 2, 1), window.ContentFromUtc.ToOffset(TimeSpan.FromHours(-5)).DateTime);
        Assert.Equal(new DateTime(2026, 3, 1), window.ContentToUtc.ToOffset(TimeSpan.FromHours(-5)).DateTime);
    }

    [Fact]
    public void The_content_window_is_the_previous_period_not_the_current_one()
    {
        var window = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 20), Bogota);

        Assert.NotNull(window);
        Assert.True(window.ContentFromUtc < window.ContentToUtc);
        Assert.True(window.ContentToUtc <= window.SendAtUtc);
        Assert.Equal(TimeSpan.FromDays(1), window.ContentToUtc - window.ContentFromUtc);
    }

    // -- daylight saving ----------------------------------------------------------------

    [Fact]
    public void A_local_midnight_that_does_not_exist_still_produces_a_usable_instant()
    {
        // Santiago springs forward at midnight, so 00:00 on the transition date is a local time
        // that never occurs. Naive conversion throws; the digest for that day would be lost.
        var transition = new DateTime(2026, 9, 6);
        Assert.True(Santiago.IsInvalidTime(transition));

        var utc = SchedulingTimeZone.ToUtc(transition, Santiago);

        // Moved forward into the first instant that does exist, still on the same local day.
        Assert.Equal(transition.AddHours(1), TimeZoneInfo.ConvertTime(utc, Santiago).DateTime);
    }

    [Fact]
    public void Digests_are_still_due_on_a_spring_forward_day()
    {
        // 13:00 UTC on 6 September 2026 is 10:00 in Santiago (UTC-3 after the transition),
        // comfortably past the 08:00 send hour.
        var window = DigestSchedule.DueWindow(
            NotificationPreferenceValidation.DigestDaily, Utc(2026, 9, 6, 13), Santiago);

        Assert.NotNull(window);
        Assert.Equal("2026-09-06", window.PeriodKey);
    }

    [Fact]
    public void An_ambiguous_local_time_resolves_consistently_rather_than_throwing()
    {
        // New York falls back on 1 November 2026, so 01:30 local happens twice. Both instants
        // are inside the same local day, so the period key is unaffected -- what matters is that
        // a value is produced at all, and the same one every time, because ScheduledFor has to
        // be identical whichever instance computes it.
        var newYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var ambiguous = new DateTime(2026, 11, 1, 1, 30, 0);
        Assert.True(newYork.IsAmbiguousTime(ambiguous));

        var first = SchedulingTimeZone.ToUtc(ambiguous, newYork);
        var second = SchedulingTimeZone.ToUtc(ambiguous, newYork);

        Assert.Equal(first, second);
        Assert.Equal(ambiguous, TimeZoneInfo.ConvertTime(first, newYork).DateTime);

        // The earlier of the two, i.e. still on daylight time: a digest is never late.
        Assert.Equal(TimeSpan.FromHours(-4), first.Offset);
    }

    [Fact]
    public void A_half_hour_offset_zone_is_handled_like_any_other()
    {
        // Kathmandu is UTC+05:45. 02:15 UTC is 08:00 local exactly -- the send hour to the
        // minute, which an hour-granularity implementation would get wrong.
        Assert.Null(DigestSchedule.DueWindow(
            NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 2, 14), Kathmandu));

        Assert.NotNull(DigestSchedule.DueWindow(
            NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 2, 15), Kathmandu));
    }

    // -- boundaries ---------------------------------------------------------------------

    [Fact]
    public void Just_after_a_period_boundary_but_before_the_send_hour_nothing_is_owed()
    {
        // 05:30 UTC on 7 August is 00:30 on the 7th in Bogota: the new day has started but its
        // digest is not due until 08:00, and the 6th's went out yesterday. The window must be
        // null rather than returning the 6th again -- doing so would be harmless only because
        // the deterministic id would reject it, which is not a reason to get it wrong.
        Assert.Null(DigestSchedule.DueWindow(
            NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 7, 5, 30), Bogota));
    }

    [Fact]
    public void SendAtUtc_is_the_same_value_regardless_of_when_within_the_period_it_is_computed()
    {
        // This is the property that makes ScheduledFor deterministic across instances: two
        // workers ticking minutes apart write the same value, so the row is byte-identical
        // whichever one wins the lease.
        var early = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 6, 13), Bogota);
        var late = DigestSchedule.DueWindow(NotificationPreferenceValidation.DigestDaily, Utc(2026, 8, 7, 4), Bogota);

        Assert.NotNull(early);
        Assert.NotNull(late);
        Assert.Equal(early.SendAtUtc, late.SendAtUtc);
        Assert.Equal(early.PeriodKey, late.PeriodKey);
    }
}
