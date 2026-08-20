namespace ClimateProject.Application.Scheduling;

/// <summary>
/// The names of the scheduled jobs, in one place.
///
/// A job's name is not decoration: it is hashed into its advisory lock key
/// (<see cref="DeterministicNotificationId.LockKey"/>), so it is part of the cluster-wide
/// contract between instances. Renaming one is a breaking change during a rolling deploy --
/// old and new instances would compute different keys, hold different locks, and run the same
/// job concurrently, which is precisely the thing the lock exists to prevent. Add names; do
/// not rename them.
/// </summary>
public static class WorkerJobs
{
    /// <summary>
    /// Drains due <c>notifications</c> rows through the shared dispatch path. Replaces the
    /// legacy <c>api/cron/process-reminders</c> half of the Vercel cron.
    /// </summary>
    public const string NotificationDispatch = "notification-dispatch";

    /// <summary>
    /// Nudges outstanding survey and microclimate invitations. Replaces legacy
    /// <c>api/cron/send-reminders</c>, which <c>vercel.json</c> runs every 15 minutes today
    /// and which has no equivalent in the new stack -- the regression #101 exists to prevent.
    /// </summary>
    public const string InvitationReminders = "invitation-reminders";

    /// <summary>
    /// Builds per-user digests according to <c>NotificationPreferences.DigestFrequency</c>, in
    /// each recipient's own timezone. The first thing to ever honour that preference.
    /// </summary>
    public const string Digests = "digests";

    /// <summary>
    /// Advances recurring <c>reports</c> schedules. Replaces legacy
    /// <c>api/cron/scheduled-reports</c>, and is the "one scheduler, not two" that #91 is
    /// asked to build its delivery on top of rather than beside.
    /// </summary>
    public const string ScheduledReports = "scheduled-reports";

    /// <summary>
    /// Reclaims expired <c>survey_drafts</c> rows. The only maintenance job here rather than a
    /// notification one: it exists because <c>DELETE /surveys/drafts/expired</c> had no caller
    /// and the table has grown unattended since the wizard started autosaving (#272).
    /// </summary>
    public const string SurveyDraftRetention = "survey-draft-retention";

    /// <summary>
    /// The GDPR storage-limitation sweep: expired drafts, terminal notifications past their
    /// window and long-expired unaccepted invitations. Replaces legacy
    /// <c>api/gdpr/retention-cleanup</c>, which #144 requires to run from here rather than from
    /// a scheduler of its own.
    /// </summary>
    public const string RetentionCleanup = "retention-cleanup";

    /// <summary>
    /// Advances a survey by its own <c>start_date</c> and <c>end_date</c>. The only job here
    /// that changes a status on live customer data, and the only one that replaces no legacy
    /// cron: nothing anywhere ever did this, so a survey scheduled to open never opened and one
    /// past its end date accepted responses forever. See <c>SurveyLifecycleJob</c>.
    /// </summary>
    public const string SurveyLifecycle = "survey-lifecycle";

    public static readonly string[] All =
    [
        NotificationDispatch,
        InvitationReminders,
        Digests,
        ScheduledReports,
        SurveyDraftRetention,
        RetentionCleanup,
        SurveyLifecycle,
    ];
}
