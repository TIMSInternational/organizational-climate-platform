using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Builds the periodic digest each user asked for.
///
/// <para><c>NotificationPreferences.DigestFrequency</c> has been stored, defaulted, validated
/// and exposed on the self-service preferences API since #192/#97 -- and until this job, it
/// did nothing at all. That is the failure mode the repository's own notes call out by name:
/// "a preference the product silently ignores is worse than an absent one". A user who set
/// their digest to monthly has been getting daily individual mail and no digest; a user who set
/// it to <c>never</c> has been getting the same, which happens to look like compliance but is
/// not.</para>
///
/// <para><b><c>never</c> means never.</b> <see cref="DigestSchedule.DueWindow"/> is the only
/// gate, it is consulted before anything is constructed, and there is no branch that bypasses
/// it. An unrecognised value fails closed the same way.</para>
///
/// <para><b>Whose day.</b> The recipient's, via <c>UserPreferences.Timezone</c>. See
/// <see cref="SchedulingTimeZone"/> for why that question has to be answered before "daily
/// digest" means anything, and for what happens when the stored zone is junk.</para>
/// </summary>
public static class DigestJob
{
    /// <summary>Users loaded per page. Keyset pagination; a run walks as many pages as it needs.</summary>
    public const int DefaultPageSize = 500;

    /// <summary>
    /// Ceiling on users examined in one run, so one sweep is one bounded transaction even on a
    /// tenant with six figures of employees. Reaching it is logged as a warning rather than
    /// passed over: the next tick resumes from the start, so the users beyond the cap would be
    /// examined an hour later, and if the cap were hit every single time they would never be
    /// examined at all -- which is the kind of silent partial outage this whole issue is about.
    /// </summary>
    public const int DefaultMaxUsersPerRun = 20_000;

    private const string LogCategory = "ClimateProject.Workers.Digests";

    public static async Task<DigestSweepResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int pageSize,
        int maxUsersPerRun,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(pageSize, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxUsersPerRun, 1);

        var logger = loggerFactory.CreateLogger(LogCategory);

        var examined = 0;
        var raised = 0;

        while (examined < maxUsersPerRun)
        {
            // `never` is excluded in SQL as well as in DigestSchedule, so the overwhelmingly
            // common opt-out costs nothing to honour. CompanyId != null excludes global-scope
            // super admins (#191): notifications.company_id is a non-nullable FK, so there is
            // no row shape that could hold their digest.
            //
            // Offset paging rather than keyset. Keyset would be the better choice on a hot
            // table, but it needs `id > @after`, and Guid has no ordering operator that EF's
            // Npgsql provider is guaranteed to translate -- a query that compiles and then
            // throws at runtime inside a background thread is the worst possible place to find
            // that out. The whole sweep runs inside one transaction against a table that is
            // only written by user administration, so the ordering is stable while it walks,
            // and the ceiling keeps the number of pages at forty.
            var page = await db.Users
                .Where(user => user.IsActive
                               && user.CompanyId != null
                               && user.Notifications.DigestFrequency != NotificationPreferenceValidation.DigestNever)
                .OrderBy(user => user.Id)
                .Skip(examined)
                .Take(Math.Min(pageSize, maxUsersPerRun - examined))
                .ToListAsync(cancellationToken);

            if (page.Count == 0)
            {
                break;
            }

            examined += page.Count;

            raised += await RaisePageAsync(db, page, nowUtc, cancellationToken);
        }

        if (examined >= maxUsersPerRun)
        {
            logger.LogWarning(
                "Digest sweep stopped at the per-run ceiling of {MaxUsersPerRun} users. Users after that point were " +
                "not examined this run. If this recurs on every run, raise the ceiling or shorten the interval -- " +
                "the tail of the user list is not receiving digests.",
                maxUsersPerRun);
        }

        await db.SaveChangesAsync(cancellationToken);

        return new DigestSweepResult(examined, raised);
    }

    private static async Task<int> RaisePageAsync(
        ClimateProjectDbContext db,
        List<User> page,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var due = new List<(User User, DigestWindow Window, Guid NotificationId)>();

        foreach (var user in page)
        {
            var window = DigestSchedule.DueWindow(
                user.Notifications.DigestFrequency,
                nowUtc,
                SchedulingTimeZone.Resolve(user.Preferences.Timezone));

            if (window is null)
            {
                continue;
            }

            due.Add((user, window, DeterministicNotificationId.ForDigest(user.Id, window.PeriodKey)));
        }

        if (due.Count == 0)
        {
            return 0;
        }

        // One digest per recipient per period, enforced by the primary key. This query only
        // avoids the exception; the key is what makes the guarantee.
        var ids = due.Select(entry => entry.NotificationId).ToList();
        var alreadyRaised = (await db.Notifications
                .Where(notification => ids.Contains(notification.Id))
                .Select(notification => notification.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var outstanding = due.Where(entry => !alreadyRaised.Contains(entry.NotificationId)).ToList();
        if (outstanding.Count == 0)
        {
            return 0;
        }

        var counts = await CountDigestibleAsync(db, outstanding, cancellationToken);

        var raised = 0;
        foreach (var (user, window, notificationId) in outstanding)
        {
            var count = counts.GetValueOrDefault(user.Id);
            if (count == 0)
            {
                // "You have 0 new notifications" is not a digest, it is a mail that trains the
                // recipient to ignore the next one. An empty period produces nothing, and
                // because the id is derived from the period rather than from a counter, the
                // period is simply never used -- no gap to reconcile, nothing to catch up.
                continue;
            }

            db.Notifications.Add(new Notification
            {
                Id = notificationId,
                UserId = user.Id,
                CompanyId = user.CompanyId!.Value,

                // There is no `digest` member of NotificationTypes and there must not be: the
                // nine values are the legacy Mongoose enum verbatim and a unit test pins them.
                // `system_notification` is the ungoverned operational type, which is right here
                // for a second reason -- the digest's consent gate is DigestFrequency itself,
                // already applied above, and layering an email opt-out on top would mean a user
                // who explicitly chose "weekly digest" could still be silently denied it.
                Type = NotificationTypes.SystemNotification,
                Channel = NotificationChannels.Email,
                Priority = NotificationPriorities.Low,
                Status = NotificationStatuses.Pending,
                Title = ScheduledNotificationCopy.DigestTitleFor(user.Preferences.Language),
                Message = ScheduledNotificationCopy.DigestBodyFor(
                    user.Preferences.Language, count, window.ContentFromUtc),

                // The period's own send time, so every instance computes the same value and the
                // stored row says when the digest was owed rather than when a tick fired.
                ScheduledFor = window.SendAtUtc,
                RetryCount = 0,
                MaxRetries = 3,
                CreatedAt = nowUtc,
                UpdatedAt = nowUtc,
            });

            raised++;
        }

        return raised;
    }

    /// <summary>
    /// How many digestible notifications each recipient accumulated in their own window.
    ///
    /// <para>Every recipient in the page has a different window -- different frequency,
    /// different timezone -- so this pulls the union of those windows in one query and counts
    /// per recipient in memory rather than issuing a query each. Only the recipient id and the
    /// timestamp are projected, so the row width is fixed regardless of how much text the
    /// notifications carry.</para>
    ///
    /// <para><c>system_notification</c> is excluded, which is what stops a digest counting
    /// previous digests -- and, more generally, keeps the digest a summary of things the
    /// recipient might act on rather than of the platform's own housekeeping. <c>cancelled</c>
    /// is excluded too: a notification suppressed by the recipient's own opt-out must not
    /// reappear in a digest, or the opt-out would be cosmetic.</para>
    /// </summary>
    private static async Task<Dictionary<Guid, int>> CountDigestibleAsync(
        ClimateProjectDbContext db,
        List<(User User, DigestWindow Window, Guid NotificationId)> outstanding,
        CancellationToken cancellationToken)
    {
        var userIds = outstanding.Select(entry => entry.User.Id).ToList();
        var from = outstanding.Min(entry => entry.Window.ContentFromUtc);
        var to = outstanding.Max(entry => entry.Window.ContentToUtc);

        var rows = await db.Notifications
            .Where(notification => userIds.Contains(notification.UserId)
                                   && notification.CreatedAt >= from
                                   && notification.CreatedAt < to
                                   && notification.Type != NotificationTypes.SystemNotification
                                   && notification.Status != NotificationStatuses.Cancelled)
            .Select(notification => new { notification.UserId, notification.CreatedAt })
            .ToListAsync(cancellationToken);

        var windows = outstanding.ToDictionary(entry => entry.User.Id, entry => entry.Window);
        var counts = new Dictionary<Guid, int>();

        foreach (var row in rows)
        {
            if (!windows.TryGetValue(row.UserId, out var window))
            {
                continue;
            }

            if (row.CreatedAt < window.ContentFromUtc || row.CreatedAt >= window.ContentToUtc)
            {
                continue;
            }

            counts[row.UserId] = counts.GetValueOrDefault(row.UserId) + 1;
        }

        return counts;
    }
}

/// <summary>What one digest sweep did.</summary>
/// <param name="UsersExamined">Users with a digest preference other than <c>never</c> that were considered.</param>
/// <param name="DigestsRaised">Digest notifications actually created.</param>
public sealed record DigestSweepResult(int UsersExamined, int DigestsRaised);
