namespace ClimateProject.Application.Scheduling;

/// <summary>
/// Turning a stored <c>UserPreferences.Timezone</c> string into a usable
/// <see cref="TimeZoneInfo"/>, and converting between a person's wall clock and UTC without
/// throwing on the two dates a year where wall-clock time is not a function.
///
/// This exists because "send the daily digest" is meaningless until someone decides *whose*
/// day it is. The answer this codebase gives is: the recipient's. A digest is a summary of
/// their day, it lands in their inbox, and a user in Costa Rica whose "Monday digest"
/// arrives at 18:00 Sunday local has been given the wrong artefact, not a slightly early
/// one. So every period boundary in <see cref="DigestSchedule"/> is computed in the
/// recipient's zone and only then converted back to UTC for storage and comparison.
///
/// The column is a free <c>varchar</c> with no validation behind it and a default of
/// <c>"UTC"</c>, so it can and will hold junk -- an abandoned Windows id, a legacy
/// abbreviation, an empty string from an import. <see cref="Resolve"/> therefore never
/// throws: an unrecognised zone falls back to UTC, which sends the digest at a defensible
/// time rather than skipping the user entirely. Silently dropping a recipient because their
/// profile has a typo is the worse failure of the two, and it is invisible.
/// </summary>
public static class SchedulingTimeZone
{
    /// <summary>
    /// The zone named by <paramref name="id"/>, or <see cref="TimeZoneInfo.Utc"/> when it is
    /// blank or unrecognised. Never throws.
    /// </summary>
    public static TimeZoneInfo Resolve(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            // The zone exists in the database but its rules are corrupt. Same remedy.
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>The wall-clock time in <paramref name="zone"/> at <paramref name="utc"/>.</summary>
    public static DateTime ToLocal(DateTimeOffset utc, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        return TimeZoneInfo.ConvertTime(utc, zone).DateTime;
    }

    /// <summary>
    /// The UTC instant at which <paramref name="local"/> occurs in <paramref name="zone"/>.
    ///
    /// The two awkward cases are handled rather than thrown, because both are reachable from
    /// ordinary period boundaries and neither is worth losing a digest over:
    ///
    /// <list type="bullet">
    /// <item><b>Invalid (skipped) local times.</b> On a spring-forward day the local hour the
    /// caller asked for may not exist -- Santiago and Havana both skip midnight, so
    /// "start of the local day" is a time that never happens there. We move forward by the
    /// gap, which lands on the first instant that *does* exist. Skipping the run instead
    /// would silently drop one digest a year in exactly those zones.</item>
    /// <item><b>Ambiguous (repeated) local times.</b> On a fall-back day the local hour
    /// happens twice. We take the <em>first</em> occurrence (the larger UTC offset, i.e.
    /// daylight time). Choosing consistently is what matters: both instants are inside the
    /// same local day, so the period key is the same either way, and picking the earlier one
    /// means the digest is never late.</item>
    /// </list>
    /// </summary>
    public static DateTimeOffset ToUtc(DateTime local, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);

        if (zone.IsInvalidTime(unspecified))
        {
            // The gap is the difference between the offsets either side of the transition.
            // One hour covers every real-world transition, but deriving it keeps the rare
            // 30-minute and 2-hour transitions (Lord Howe, historical Antarctic zones)
            // correct instead of merely nearly correct.
            var before = zone.GetUtcOffset(unspecified.AddDays(-1));
            var after = zone.GetUtcOffset(unspecified.AddDays(1));
            var gap = after - before;
            unspecified = unspecified.Add(gap <= TimeSpan.Zero ? TimeSpan.FromHours(1) : gap);
        }

        if (zone.IsAmbiguousTime(unspecified))
        {
            var offsets = zone.GetAmbiguousTimeOffsets(unspecified);
            var earliest = offsets[0];
            foreach (var offset in offsets)
            {
                if (offset > earliest)
                {
                    earliest = offset;
                }
            }

            return new DateTimeOffset(unspecified, earliest);
        }

        return new DateTimeOffset(unspecified, zone.GetUtcOffset(unspecified));
    }
}
