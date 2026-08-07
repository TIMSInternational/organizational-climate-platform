using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// Recurring report arithmetic, and the catch-up rule that stops a scheduler which was down
/// coming back and generating a hundred reports at once.
/// </summary>
public class RecurrenceScheduleTests
{
    private static readonly TimeZoneInfo Bogota = TimeZoneInfo.FindSystemTimeZoneById("America/Bogota");
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static DateTimeOffset Utc(int year, int month, int day, int hour = 12)
        => new(year, month, day, hour, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(RecurrenceSchedule.Daily, 1)]
    [InlineData(RecurrenceSchedule.Weekly, 7)]
    [InlineData(RecurrenceSchedule.Biweekly, 14)]
    public void Day_based_patterns_advance_by_their_period(string pattern, int days)
    {
        var next = RecurrenceSchedule.Next(pattern, Utc(2026, 8, 6), Bogota);

        Assert.Equal(Utc(2026, 8, 6).AddDays(days), next);
    }

    [Theory]
    [InlineData(RecurrenceSchedule.Monthly, 2026, 9, 6)]
    [InlineData(RecurrenceSchedule.Quarterly, 2026, 11, 6)]
    [InlineData(RecurrenceSchedule.Yearly, 2027, 8, 6)]
    public void Month_based_patterns_advance_by_calendar(string pattern, int year, int month, int day)
    {
        var next = RecurrenceSchedule.Next(pattern, Utc(2026, 8, 6), Bogota);

        Assert.Equal(Utc(year, month, day), next);
    }

    [Fact]
    public void A_monthly_schedule_on_the_31st_clamps_into_february_rather_than_overflowing()
    {
        // 31 January + 1 month is 28 February, not 3 March. Overflowing would move a "monthly"
        // report onto a different day of the month every time it passed a short one.
        var next = RecurrenceSchedule.Next(RecurrenceSchedule.Monthly, Utc(2026, 1, 31), Bogota);

        Assert.Equal(Utc(2026, 2, 28), next);
    }

    [Fact]
    public void A_daily_schedule_keeps_its_local_hour_across_a_dst_transition()
    {
        // 07:00 New York on 7 March 2026 is 12:00 UTC; the clocks go forward overnight, so
        // 07:00 local on the 8th is 11:00 UTC. Adding 24 hours to the *instant* would land at
        // 08:00 local and stay an hour out for the rest of the year.
        var beforeTransition = new DateTimeOffset(2026, 3, 7, 12, 0, 0, TimeSpan.Zero);

        var next = RecurrenceSchedule.Next(RecurrenceSchedule.Daily, beforeTransition, NewYork);

        Assert.NotNull(next);
        Assert.Equal(new TimeSpan(7, 0, 0), TimeZoneInfo.ConvertTime(next.Value, NewYork).TimeOfDay);
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 11, 0, 0, TimeSpan.Zero), next);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("hourly")]
    [InlineData("0 0 * * *")]
    [InlineData("Daily")]
    public void An_unrecognised_pattern_yields_null_rather_than_a_guess(string? pattern)
    {
        Assert.Null(RecurrenceSchedule.Next(pattern, Utc(2026, 8, 6), Bogota));
        Assert.Null(RecurrenceSchedule.AdvancePast(pattern, Utc(2026, 8, 6), Utc(2026, 8, 7), Bogota));
        Assert.False(RecurrenceSchedule.IsValid(pattern));
    }

    // -- catch-up -----------------------------------------------------------------------

    [Fact]
    public void A_schedule_already_in_the_future_is_left_alone()
    {
        var advance = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Daily, Utc(2026, 8, 10), Utc(2026, 8, 6), Bogota);

        Assert.NotNull(advance);
        Assert.Equal(Utc(2026, 8, 10), advance.NextOccurrenceUtc);
        Assert.Equal(0, advance.SkippedOccurrences);
    }

    [Fact]
    public void One_missed_occurrence_advances_by_exactly_one_period_and_skips_nothing()
    {
        var advance = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Daily, Utc(2026, 8, 6), Utc(2026, 8, 6, 13), Bogota);

        Assert.NotNull(advance);
        Assert.Equal(Utc(2026, 8, 7), advance.NextOccurrenceUtc);
        Assert.Equal(0, advance.SkippedOccurrences);
    }

    [Fact]
    public void A_four_month_outage_produces_one_report_not_a_hundred_and_twenty()
    {
        // The single most important behaviour here. Generating every missed occurrence would
        // mail a hundred and twenty reports over a dataset that has long since moved on;
        // generating none would leave the schedule permanently in the past, firing on every
        // tick forever.
        var advance = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Daily, Utc(2026, 4, 1), Utc(2026, 8, 6), Bogota);

        Assert.NotNull(advance);
        Assert.True(advance.NextOccurrenceUtc > Utc(2026, 8, 6));
        Assert.Equal(Utc(2026, 8, 7), advance.NextOccurrenceUtc);

        // 1 April to 7 August is 128 daily occurrences; one is fired and the other 127 are
        // passed over. The number is reported rather than swallowed because it is the size of
        // the outage, which is what someone asking "where are my reports" needs to see.
        Assert.Equal(127, advance.SkippedOccurrences);
    }

    [Fact]
    public void The_result_is_always_strictly_in_the_future()
    {
        // If it were not, the report would match the due query again on the very next tick and
        // fire in a loop -- the same row, over and over, at the tick interval.
        var now = Utc(2026, 8, 6, 12);

        foreach (var pattern in RecurrenceSchedule.All)
        {
            var advance = RecurrenceSchedule.AdvancePast(pattern, Utc(2020, 1, 1), now, Bogota);

            Assert.NotNull(advance);
            Assert.True(advance.NextOccurrenceUtc > now, $"{pattern} did not advance past now.");
        }
    }

    [Fact]
    public void A_pathologically_stale_schedule_is_refused_rather_than_looping_forever()
    {
        // A corrupt next_generation -- MinValue from a bad import, say -- would otherwise spin a
        // daily pattern through two million iterations on a worker thread. Refusing routes it
        // into the same "clear the schedule and log" path as an invalid pattern.
        var advance = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Daily, DateTimeOffset.MinValue, Utc(2026, 8, 6), Bogota);

        Assert.Null(advance);
    }

    [Fact]
    public void Advancing_is_idempotent_once_the_result_has_been_stored()
    {
        // The job writes NextOccurrenceUtc back to next_generation. Feeding that value in again
        // -- which is what the next tick does -- must be a no-op, or every tick would advance
        // the schedule another period and the report would drift into the far future.
        var first = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Weekly, Utc(2026, 7, 1), Utc(2026, 8, 6), Bogota);

        Assert.NotNull(first);

        var second = RecurrenceSchedule.AdvancePast(
            RecurrenceSchedule.Weekly, first.NextOccurrenceUtc, Utc(2026, 8, 6), Bogota);

        Assert.NotNull(second);
        Assert.Equal(first.NextOccurrenceUtc, second.NextOccurrenceUtc);
        Assert.Equal(0, second.SkippedOccurrences);
    }
}
