using ClimateProject.Application.Gdpr;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Storage-limitation sweep (GDPR Art. 5(1)(e)): deletes personal data the platform no longer
/// has a reason to hold. Replaces the legacy <c>api/gdpr/retention-cleanup</c> route (#144).
///
/// <para><b>This deletes production data, so read the predicates before changing them.</b>
/// Each category below deletes strictly by its own expiry expression and never by a harvested
/// id alone. That is not a stylistic rule: #272's draft sweep had to be fixed in Wave 1
/// precisely because deleting a set of ids selected a moment earlier reclaims a row that was
/// rescued in between. Every statement here restates its predicate at the point of deletion,
/// and <c>RetentionCleanupJobTests</c> asserts for each category that a row one day outside
/// the window survives a sweep that takes the row inside it.</para>
///
/// <para><b>What is deliberately NOT swept.</b> <c>audit_logs</c> and <c>survey_audit_logs</c>
/// have no expiry here. They are the platform's account of what was done to whose data, and a
/// timer that quietly removes them would defeat both #143 and the erasure position in
/// <c>docs/compliance/gdpr-subject-rights.md</c>. Deleting them is a decision for a retention
/// policy the controller has actually adopted, not a default. Neither are <c>responses</c>:
/// they are anonymised on erasure and are the basis of every published aggregate.</para>
///
/// <para><b>Three categories, each with a reason to expire.</b></para>
/// <list type="bullet">
/// <item><description><b>Expired survey drafts</b> — delegated whole to
/// <see cref="SurveyDraftRetentionJob.PurgeAsync"/> rather than reimplemented, so that the
/// sweep, the hourly draft worker and <c>DELETE /surveys/drafts/expired</c> cannot come to
/// three different views of what "expired" means.</description></item>
/// <item><description><b>Terminal notifications</b> older than the notification window. A
/// notification carries a rendered message body and, once opened, the recipient's IP address,
/// user agent and mail client. Nothing aggregates over them and nothing audits from them, so
/// past the window there is no purpose left to justify holding them. Only terminal rows are
/// taken — anything still pending or retrying is work in flight.</description></item>
/// <item><description><b>Unaccepted invitations</b> long past their own <c>expires_at</c>. An
/// expired invitation is an email address plus a bearer token that can no longer be redeemed.
/// Accepted invitations are kept: they are the record of how an account came to exist.
/// </description></item>
/// </list>
/// </summary>
public static class RetentionCleanupJob
{
    /// <summary>Rows deleted per category per run. See <c>SurveyDraftRetentionJob.DefaultBatchSize</c> for the shape of this cap.</summary>
    public const int DefaultBatchSize = 1000;

    /// <summary>
    /// How long a terminal notification is kept, counted from <c>created_at</c>.
    ///
    /// <para>One year. Long enough that "did we ever tell them about that survey?" can still be
    /// answered across an annual cycle — this product's natural unit — and short enough that the
    /// message bodies and open-tracking metadata do not accumulate for the life of the tenant.</para>
    /// </summary>
    public static readonly TimeSpan DefaultNotificationRetention = TimeSpan.FromDays(365);

    /// <summary>
    /// How long an unaccepted invitation is kept past its own <c>expires_at</c>.
    ///
    /// <para>Ninety days, not zero. An invitation expires within days, and deleting it the
    /// moment it lapses would remove the evidence for "we invited you and you never
    /// responded" while a survey round is still being chased.</para>
    /// </summary>
    public static readonly TimeSpan DefaultInvitationGrace = TimeSpan.FromDays(90);

    /// <summary>Category name reported for the survey-draft sweep.</summary>
    public const string SurveyDraftsCategory = "survey_drafts";

    /// <summary>Category name reported for the notification sweep.</summary>
    public const string NotificationsCategory = "notifications";

    /// <summary>Category name reported for the invitation sweep.</summary>
    public const string InvitationsCategory = "user_invitations";

    /// <summary>
    /// The statuses a notification can be in and never leave. Anything not in this set is
    /// still in flight — pending, or retrying after a failure — and is never swept, however
    /// old the row is.
    /// </summary>
    public static readonly IReadOnlySet<string> TerminalNotificationStatuses =
        new HashSet<string>(StringComparer.Ordinal)
        {
            NotificationStatuses.Sent,
            NotificationStatuses.Delivered,
            NotificationStatuses.Opened,
            NotificationStatuses.Failed,
        };

    private const string LogCategory = "ClimateProject.Workers.RetentionCleanup";

    /// <summary>
    /// Runs every category and logs what was reclaimed.
    /// </summary>
    /// <param name="maxRowsPerCategory">
    /// At most this many rows per category; <c>null</c> for no cap. The scheduled worker passes
    /// a cap so a first sweep over a backlog is not one enormous transaction;
    /// <c>POST /gdpr/retention-cleanup</c> passes null, because a human asking for the sweep by
    /// hand is asking it to finish.
    /// </param>
    public static async Task<RetentionCleanupResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int? maxRowsPerCategory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);

        var result = await SweepAsync(
            db, nowUtc, maxRowsPerCategory, DefaultNotificationRetention, DefaultInvitationGrace, cancellationToken);

        if (result.TotalDeleted > 0)
        {
            loggerFactory.CreateLogger(LogCategory).LogInformation(
                "Retention cleanup as of {NowUtc:O} deleted {TotalDeleted} rows: {Breakdown}.",
                nowUtc,
                result.TotalDeleted,
                string.Join(", ", result.Categories.Select(c => $"{c.Category}={c.Deleted}")));
        }

        return result;
    }

    /// <summary>
    /// The sweep itself, with every window supplied by the caller so that a test can move the
    /// boundary instead of moving the clock.
    /// </summary>
    public static async Task<RetentionCleanupResult> SweepAsync(
        ClimateProjectDbContext db,
        DateTimeOffset nowUtc,
        int? maxRowsPerCategory,
        TimeSpan notificationRetention,
        TimeSpan invitationGrace,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (maxRowsPerCategory is int requested)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(requested, 1);
        }
        ArgumentOutOfRangeException.ThrowIfLessThan(notificationRetention, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfLessThan(invitationGrace, TimeSpan.Zero);

        var drafts = await SurveyDraftRetentionJob.PurgeAsync(db, nowUtc, maxRowsPerCategory, cancellationToken);

        var notificationCutoff = nowUtc - notificationRetention;
        var terminal = TerminalNotificationStatuses.ToArray();
        var notifications = await PurgeAsync(
            db.Notifications.Where(n => n.CreatedAt <= notificationCutoff && terminal.Contains(n.Status)),
            n => n.Id,
            (query, ids) => query.Where(n => ids.Contains(n.Id)),
            maxRowsPerCategory,
            cancellationToken);

        var invitationCutoff = nowUtc - invitationGrace;
        var invitations = await PurgeAsync(
            db.UserInvitations.Where(i =>
                i.ExpiresAt <= invitationCutoff
                && i.AcceptedAt == null
                && i.Status != InvitationValidation.StatusAccepted),
            i => i.Id,
            (query, ids) => query.Where(i => ids.Contains(i.Id)),
            maxRowsPerCategory,
            cancellationToken);

        var categories = new List<RetentionCleanupCategory>
        {
            new(SurveyDraftsCategory, "expires_at <= now", drafts.Deleted, drafts.MoreRemaining),
            new(NotificationsCategory,
                $"created_at <= now - {notificationRetention.TotalDays:0.##}d AND status IN (terminal)",
                notifications.Deleted, notifications.MoreRemaining),
            new(InvitationsCategory,
                $"expires_at <= now - {invitationGrace.TotalDays:0.##}d AND accepted_at IS NULL AND status <> 'accepted'",
                invitations.Deleted, invitations.MoreRemaining),
        };

        return new RetentionCleanupResult(nowUtc, categories.Sum(c => c.Deleted), categories);
    }

    /// <summary>
    /// Deletes the rows matching <paramref name="expired"/>, at most
    /// <paramref name="maxRows"/> of them, and reports whether more were waiting.
    /// </summary>
    /// <param name="expired">
    /// The expiry predicate. Applied to both statements below, never replaced by an id list.
    /// </param>
    /// <param name="key">Projects the primary key, for the capped path.</param>
    /// <param name="restrict">Re-applies the harvested ids on top of <paramref name="expired"/>.</param>
    /// <param name="maxRows">Row cap, or <c>null</c> for no cap.</param>
    /// <remarks>
    /// <para><b>Uncapped is one statement</b> — a single <c>DELETE … WHERE &lt;predicate&gt;</c>,
    /// which has no window for a row to be rescued in, because there is nothing between the
    /// read and the write.</para>
    ///
    /// <para><b>Capped is two, and the predicate is restated in the second.</b> That is the
    /// whole safety argument. Between harvesting ids and deleting them a notification can be
    /// re-queued for retry and an invitation can be accepted — and acceptance is exactly the
    /// event that must save the row. Deleting by id alone would take both. With the predicate
    /// restated, a row rescued in that window simply stops matching and survives, and the
    /// returned count is what was actually deleted rather than what was selected. This is the
    /// same defect, and the same fix, as the survey-draft sweep carries.</para>
    ///
    /// <para>One id more than the cap is fetched, purely so "is there a backlog behind this?"
    /// is answered exactly: <c>count == cap</c> would claim one whenever the number of expired
    /// rows happened to land on the cap, which is the one case where there is none. Unordered,
    /// because nothing can observe which expired row goes first, and progress is monotone
    /// regardless — the rows a run takes are deleted, so the next run cannot be handed the
    /// same ones.</para>
    /// </remarks>
    private static async Task<PurgeResult> PurgeAsync<T>(
        IQueryable<T> expired,
        System.Linq.Expressions.Expression<Func<T, Guid>> key,
        Func<IQueryable<T>, IReadOnlyList<Guid>, IQueryable<T>> restrict,
        int? maxRows,
        CancellationToken cancellationToken)
        where T : class
    {
        if (maxRows is not int cap)
        {
            return new PurgeResult(await expired.ExecuteDeleteAsync(cancellationToken), false);
        }

        var ids = await expired.Select(key).Take(cap + 1).ToListAsync(cancellationToken);
        if (ids.Count == 0)
        {
            return new PurgeResult(0, false);
        }

        var moreRemaining = ids.Count > cap;
        if (moreRemaining)
        {
            ids.RemoveAt(ids.Count - 1);
        }

        var deleted = await restrict(expired, ids).ExecuteDeleteAsync(cancellationToken);
        return new PurgeResult(deleted, moreRemaining);
    }

    private sealed record PurgeResult(int Deleted, bool MoreRemaining);
}
