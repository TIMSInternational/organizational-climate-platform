using System.Globalization;
using ClimateProject.Application.OrgStructure;

namespace ClimateProject.Application.Scheduling;

/// <summary>
/// The digest period a given recipient is currently owed, if any.
///
/// <para><b>PeriodKey</b> is the identity of the digest. It is a string derived only from the
/// frequency and the recipient's local calendar -- <c>2026-08-06</c>, <c>2026-W32</c>,
/// <c>2026-08</c> -- and it is what makes the whole job idempotent: the notification id for a
/// digest is a deterministic UUID over (recipient, period key), so a second tick, a second
/// worker instance, or a replay after a crash all compute the same primary key and the second
/// insert cannot land. See <see cref="DeterministicNotificationId"/>.</para>
///
/// <para><b>SendAtUtc</b> is when that digest becomes due, in UTC, resolved through the
/// recipient's own zone. <see cref="SendAtLocalHour"/> is deliberately not midnight: a
/// "Monday digest" generated at 00:00 local summarises a week that ended a moment earlier and
/// arrives while nobody is reading, and worse, midnight is the local time that does not exist
/// on spring-forward days in several zones this product serves. 08:00 is a working hour in
/// every zone by construction.</para>
/// </summary>
public static class DigestSchedule
{
    /// <summary>
    /// The local hour at which a period's digest becomes due. See the type remarks for why
    /// this is not zero.
    /// </summary>
    public const int SendAtLocalHour = 8;

    /// <summary>
    /// <para>The digest window that is due for this recipient at <paramref name="nowUtc"/>, or
    /// <see langword="null"/> when none is.</para>
    ///
    /// <para><b>No backfill, deliberately.</b> This only ever returns the period the recipient
    /// is in right now. A worker that was down for three weeks resumes by sending this week's
    /// digest and forgetting the two it missed: mailing someone three stale summaries at once
    /// is noise, and every notification they describe is still sitting in the inbox
    /// unchanged. The alternative -- looping back to the last successful send -- also makes
    /// the volume of mail a function of how long an outage lasted, which is precisely the
    /// behaviour that turns a recovery into a second incident.</para>
    ///
    /// Returns null when:
    /// <list type="bullet">
    /// <item>the frequency is <c>never</c> -- and this is the only place that word is honoured,
    /// so it must mean never, not "rarely". There is no override, no "important digest"
    /// bypass, and no code path that constructs a digest without asking here first.</item>
    /// <item>the frequency is unrecognised. Failing closed rather than defaulting to weekly:
    /// a junk value is not consent to be mailed, and the validation on the write path
    /// (<see cref="NotificationPreferenceValidation"/>) means the only way to hold one is a
    /// legacy import, where the safe reading is "we do not know what they wanted".</item>
    /// <item>the current period's send time has not yet arrived in the recipient's zone.</item>
    /// </list>
    /// </summary>
    public static DigestWindow? DueWindow(string? frequency, DateTimeOffset nowUtc, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        if (!IsSchedulable(frequency))
        {
            return null;
        }

        var local = SchedulingTimeZone.ToLocal(nowUtc, zone);
        var periodStartLocal = PeriodStartLocal(frequency!, local);
        var sendAtLocal = periodStartLocal.AddHours(SendAtLocalHour);

        if (local < sendAtLocal)
        {
            // Early in the period: the boundary has passed but the send hour has not. The
            // previous period's digest was already delivered at its own send hour, so there
            // is nothing owed right now.
            return null;
        }

        var previousStartLocal = PreviousPeriodStartLocal(frequency!, periodStartLocal);

        return new DigestWindow(
            PeriodKey(frequency!, periodStartLocal),
            SchedulingTimeZone.ToUtc(previousStartLocal, zone),
            SchedulingTimeZone.ToUtc(periodStartLocal, zone),
            SchedulingTimeZone.ToUtc(sendAtLocal, zone));
    }

    /// <summary>
    /// Whether this frequency ever produces a digest. <c>never</c> and anything unrecognised
    /// do not.
    /// </summary>
    public static bool IsSchedulable(string? frequency)
        => NotificationPreferenceValidation.IsValidDigestFrequency(frequency)
           && !string.Equals(frequency, NotificationPreferenceValidation.DigestNever, StringComparison.Ordinal);

    /// <summary>
    /// The identity of the period containing <paramref name="periodStartLocal"/>. Stable,
    /// locale-independent and sortable; never parsed back.
    /// </summary>
    public static string PeriodKey(string frequency, DateTime periodStartLocal) => frequency switch
    {
        NotificationPreferenceValidation.DigestDaily =>
            periodStartLocal.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),

        // ISO 8601 week, not "week of the month" and not .NET's default calendar week: ISO is
        // the only definition on which the week containing 1 January is unambiguous, and
        // ISOWeek.GetYear is what keeps 2026-12-28 filed under 2027-W01 rather than 2026-W53.
        NotificationPreferenceValidation.DigestWeekly =>
            string.Create(
                CultureInfo.InvariantCulture,
                $"{ISOWeek.GetYear(periodStartLocal):D4}-W{ISOWeek.GetWeekOfYear(periodStartLocal):D2}"),

        NotificationPreferenceValidation.DigestMonthly =>
            periodStartLocal.ToString("yyyy-MM", CultureInfo.InvariantCulture),

        _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, "Not a schedulable digest frequency."),
    };

    /// <summary>Midnight local on the first day of the period containing <paramref name="local"/>.</summary>
    public static DateTime PeriodStartLocal(string frequency, DateTime local) => frequency switch
    {
        NotificationPreferenceValidation.DigestDaily => local.Date,

        // ISO weeks start on Monday. DayOfWeek puts Sunday at 0, so the shift is (day + 6) % 7.
        NotificationPreferenceValidation.DigestWeekly =>
            local.Date.AddDays(-(((int)local.DayOfWeek + 6) % 7)),

        NotificationPreferenceValidation.DigestMonthly => new DateTime(local.Year, local.Month, 1, 0, 0, 0, local.Kind),

        _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, "Not a schedulable digest frequency."),
    };

    private static DateTime PreviousPeriodStartLocal(string frequency, DateTime periodStartLocal) => frequency switch
    {
        NotificationPreferenceValidation.DigestDaily => periodStartLocal.AddDays(-1),
        NotificationPreferenceValidation.DigestWeekly => periodStartLocal.AddDays(-7),
        NotificationPreferenceValidation.DigestMonthly => periodStartLocal.AddMonths(-1),
        _ => throw new ArgumentOutOfRangeException(nameof(frequency), frequency, "Not a schedulable digest frequency."),
    };
}

/// <summary>
/// One digest occurrence.
/// </summary>
/// <param name="PeriodKey">
/// The period's identity in the recipient's local calendar. Half of the deterministic
/// notification id, and therefore the thing that makes a repeat send impossible rather than
/// merely unlikely.
/// </param>
/// <param name="ContentFromUtc">
/// Start of the window the digest summarises: the *previous* period's start. A Monday digest
/// covers the week that just ended, not the four minutes of the week that just began.
/// </param>
/// <param name="ContentToUtc">End of that window -- this period's start.</param>
/// <param name="SendAtUtc">
/// When the digest became due. Written to <c>Notification.ScheduledFor</c> rather than "now",
/// so a late tick still records the time the digest was owed and two instances agree on the
/// value regardless of which one got there first.
/// </param>
public sealed record DigestWindow(
    string PeriodKey,
    DateTimeOffset ContentFromUtc,
    DateTimeOffset ContentToUtc,
    DateTimeOffset SendAtUtc);
