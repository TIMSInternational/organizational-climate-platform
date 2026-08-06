namespace ClimateProject.Application.Scheduling;

/// <summary>
/// <c>Report.RecurrencePattern</c>'s vocabulary and the arithmetic behind
/// <c>Report.NextGeneration</c>.
///
/// A validated string set rather than a cron expression. Cron was considered and rejected:
/// the legacy surface being replaced (<c>reports/[id]/schedule</c>) only ever offered a fixed
/// list of intervals, a cron field in the UI is a field nobody in the target audience can
/// fill in correctly, and "every 5 minutes" is expressible in cron and is not a thing a
/// climate report should ever be. If a genuine cron requirement appears, it belongs here as a
/// second pattern kind, not as a replacement for this one.
/// </summary>
public static class RecurrenceSchedule
{
    public const string Daily = "daily";
    public const string Weekly = "weekly";
    public const string Biweekly = "biweekly";
    public const string Monthly = "monthly";
    public const string Quarterly = "quarterly";
    public const string Yearly = "yearly";

    public static readonly string[] All = [Daily, Weekly, Biweekly, Monthly, Quarterly, Yearly];

    /// <summary>
    /// Ceiling on how many periods <see cref="AdvancePast"/> will skip in one call. Reached
    /// only when a schedule has been dormant for years (a daily report untouched for a
    /// decade is ~3650 steps), and present so that a corrupt <c>NextGeneration</c> -- say
    /// <c>DateTimeOffset.MinValue</c> from a bad import -- cannot spin a worker thread
    /// forever. Hitting it is reported, not swallowed.
    /// </summary>
    public const int MaxAdvanceIterations = 10_000;

    public static bool IsValid(string? pattern)
        => pattern is not null && Array.IndexOf(All, pattern) >= 0;

    /// <summary>
    /// The occurrence immediately after <paramref name="current"/>, or <see langword="null"/>
    /// when the pattern is unrecognised.
    ///
    /// <para>The arithmetic is done on the local wall clock and converted back, not on the
    /// UTC instant. A daily report scheduled for 07:00 in Bogota must stay at 07:00 across a
    /// DST boundary somewhere else in the tenant's world; adding 24 hours to an instant
    /// instead would drift it by an hour twice a year and, for a monthly report, by up to
    /// three days a year.</para>
    ///
    /// <para>Month-based patterns clamp the day rather than overflowing it:
    /// 31 January + 1 month is 28 February, not 3 March. <see cref="DateTime.AddMonths"/>
    /// already does this, and it is called out because the clamp is *lossy* -- a report first
    /// scheduled on the 31st and stepped through February is thereafter a 28th-of-the-month
    /// report. That is the standard behaviour every calendar application has settled on, and
    /// the alternative (remembering the original day of month) needs a column this schema does
    /// not have.</para>
    /// </summary>
    public static DateTimeOffset? Next(string? pattern, DateTimeOffset current, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        if (!IsValid(pattern))
        {
            return null;
        }

        var local = SchedulingTimeZone.ToLocal(current, zone);
        var next = pattern switch
        {
            Daily => local.AddDays(1),
            Weekly => local.AddDays(7),
            Biweekly => local.AddDays(14),
            Monthly => local.AddMonths(1),
            Quarterly => local.AddMonths(3),
            Yearly => local.AddYears(1),
            _ => local,
        };

        return SchedulingTimeZone.ToUtc(next, zone);
    }

    /// <summary>
    /// The first occurrence strictly after <paramref name="nowUtc"/>, stepping from
    /// <paramref name="current"/>.
    ///
    /// <para><b>This is the catch-up rule, and it is why a scheduler that was down does not
    /// come back and generate a hundred reports.</b> A worker offline for four months with a
    /// daily recurring report has ~120 missed occurrences. Generating them all would produce
    /// 120 identical-looking reports over a dataset that has since moved on, and would mail
    /// 120 notifications; generating none would leave the schedule permanently in the past,
    /// firing on every tick forever. Skipping forward to the next future occurrence and
    /// generating exactly one is the only option that is both bounded and self-healing.</para>
    ///
    /// <para>Returns null on an unrecognised pattern, which the caller must treat as "stop
    /// recurring" rather than "try again next tick" -- otherwise a report with a typo'd
    /// pattern is re-examined every 15 minutes for the life of the platform.</para>
    /// </summary>
    public static RecurrenceAdvance? AdvancePast(
        string? pattern,
        DateTimeOffset current,
        DateTimeOffset nowUtc,
        TimeZoneInfo zone)
    {
        if (!IsValid(pattern))
        {
            return null;
        }

        var next = current;
        var skipped = 0;

        while (next <= nowUtc)
        {
            var candidate = Next(pattern, next, zone);
            if (candidate is null || candidate.Value <= next)
            {
                // Cannot happen for the six patterns above -- every one of them strictly
                // increases -- but a non-advancing step is the shape of an infinite loop, so
                // it is refused rather than trusted.
                return null;
            }

            next = candidate.Value;
            skipped++;

            if (skipped >= MaxAdvanceIterations)
            {
                return null;
            }
        }

        // skipped - 1 occurrences were passed over; the last step landed on the one to keep.
        return new RecurrenceAdvance(next, Math.Max(0, skipped - 1));
    }
}

/// <summary>
/// Where a recurring schedule lands after catching up.
/// </summary>
/// <param name="NextOccurrenceUtc">The next occurrence strictly in the future.</param>
/// <param name="SkippedOccurrences">
/// How many occurrences were passed over to get there. Zero in normal operation; anything
/// else is the size of an outage, which is worth a log line rather than silence.
/// </param>
public sealed record RecurrenceAdvance(DateTimeOffset NextOccurrenceUtc, int SkippedOccurrences);
