using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// The scheduled jobs against a real Postgres.
///
/// The pure scheduling rules are unit-tested without Docker; what needs a database is
/// everything that is only true because of the database: that a duplicate insert is actually
/// refused by <c>notifications_pkey</c>, that the advisory lock actually excludes a second
/// connection, that the queries translate at all, and that a second sweep over the same rows
/// really does nothing.
/// </summary>
[Collection("Postgres")]
public class SchedulingJobTests(PostgresContainerFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 6, 15, 0, 0, TimeSpan.Zero);

    private ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);

    /// <summary>
    /// A migrated context over an <b>empty</b> database.
    ///
    /// <para>These three sweeps are deployment-wide by design -- they take no company id,
    /// because a scheduler that only swept one tenant would be the wrong thing. So every
    /// assertion on a sweep's own counters (<c>Examined</c>, <c>Raised</c>,
    /// <c>UsersExamined</c>, <c>Fired</c>) is a statement about the whole database, and any
    /// row left behind by an earlier test is inside the measurement. These tests shared one
    /// Postgres container not only with the other classes in this assembly but with each
    /// other, so eleven of them read another test's data -- <c>Assert.Equal(0, Examined)</c>
    /// against 547 leftover rows.</para>
    ///
    /// <para><c>TRUNCATE companies CASCADE</c> rather than a hand-ordered delete list: every
    /// application table chains a foreign key back to <c>companies</c>, so one statement
    /// clears them all in the right order and cannot drift out of date as tables are added.
    /// <c>__EFMigrationsHistory</c> has no such key and is deliberately left alone -- the
    /// schema stays migrated, only the data goes.</para>
    /// </summary>
    private async Task<ClimateProjectDbContext> FreshAsync()
    {
        var db = await MigratedAsync(CreateContext());
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");
        return db;
    }

    private static async Task<ClimateProjectDbContext> MigratedAsync(ClimateProjectDbContext db)
    {
        await db.Database.MigrateAsync();
        return db;
    }

    // -- seeding ------------------------------------------------------------------------

    private static Company NewCompany(string timezone = "UTC") => new()
    {
        Id = Guid.NewGuid(),
        Name = $"Acme-{Guid.NewGuid():N}",
        Settings = new CompanySettings { Timezone = timezone },
        CreatedAt = Now,
    };

    private static User NewUser(
        Guid companyId,
        string digestFrequency = NotificationPreferenceValidation.DigestWeekly,
        string timezone = "UTC",
        string language = "en") => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Email = $"user-{Guid.NewGuid():N}@acme.test",
            Name = "Employee",
            Role = "employee",
            Preferences = new UserPreferences { Timezone = timezone, Language = language },
            Notifications = new NotificationPreferences { DigestFrequency = digestFrequency },
            CreatedAt = Now,
            UpdatedAt = Now,
        };

    private static Survey NewActiveSurvey(Guid companyId, Guid createdBy, int reminderFrequencyDays = 3) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        CreatedBy = createdBy,
        TitleEn = "Q3 Climate Survey",
        TitleEs = "Encuesta de Clima Q3",
        Language = "both",
        Type = "custom",
        Status = SurveyStatuses.Active,
        StartDate = Now.AddDays(-30),
        EndDate = Now.AddDays(30),
        Settings = new SurveySettings
        {
            NotificationSendReminders = true,
            NotificationReminderFrequencyDays = reminderFrequencyDays,
        },
        CreatedAt = Now.AddDays(-30),
        UpdatedAt = Now.AddDays(-30),
    };

    private static SurveyInvitation NewInvitation(Survey survey, User user, DateTimeOffset sentAt) => new()
    {
        Id = Guid.NewGuid(),
        SurveyId = survey.Id,
        UserId = user.Id,
        CompanyId = survey.CompanyId,
        Email = user.Email,
        InvitationToken = $"tok-{Guid.NewGuid():N}",
        Status = ReminderSchedule.InvitationOutstanding,
        SentAt = sentAt,
        ExpiresAt = survey.EndDate,
        CreatedAt = sentAt,
        UpdatedAt = sentAt,
    };

    // -- reminders ----------------------------------------------------------------------

    [Fact]
    public async Task An_outstanding_invitation_gets_exactly_one_reminder_however_many_times_the_sweep_runs()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var invitation = NewInvitation(survey, user, Now.AddDays(-7));
        db.SurveyInvitations.Add(invitation);
        await db.SaveChangesAsync();

        var first = await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        Assert.Equal(1, first.Raised);

        // The acceptance criterion in so many words: "a second tick sends nothing extra". Run it
        // three more times on a fresh context so nothing is served from the change tracker.
        await using var second = await MigratedAsync(CreateContext());
        for (var i = 0; i < 3; i++)
        {
            var repeat = await InvitationReminderJob.RunAsync(
                second, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);
            Assert.Equal(0, repeat.Raised);
        }

        await using var read = CreateContext();
        var notifications = await read.Notifications.Where(n => n.UserId == user.Id).ToListAsync();

        Assert.Single(notifications);
        Assert.Equal(NotificationTypes.SurveyReminder, notifications[0].Type);
        Assert.Equal(NotificationStatuses.Pending, notifications[0].Status);

        var reloaded = await read.SurveyInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal(1, reloaded.ReminderCount);
        Assert.NotNull(reloaded.LastReminderSent);
    }

    [Fact]
    public async Task The_reminder_notification_id_is_the_deterministic_one()
    {
        // Not cosmetic: it is what makes a duplicate insert a primary key violation. If the job
        // ever generated a random id, every other guarantee here would still pass while the
        // actual protection was gone.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var invitation = NewInvitation(survey, user, Now.AddDays(-7));
        db.SurveyInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        await using var read = CreateContext();
        var notification = await read.Notifications.SingleAsync(n => n.UserId == user.Id);

        Assert.Equal(DeterministicNotificationId.ForReminder(invitation.Id, 1), notification.Id);
    }

    [Fact]
    public async Task A_duplicate_reminder_row_is_refused_by_the_primary_key()
    {
        // The proof behind "double-send under multiple instances proven impossible". Two
        // instances that both somehow got past the lease would each build this row; the second
        // INSERT cannot land, because the id is a function of what the notification is.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var id = DeterministicNotificationId.ForReminder(Guid.NewGuid(), 1);

        Notification Row() => new()
        {
            Id = id,
            UserId = user.Id,
            CompanyId = company.Id,
            Type = NotificationTypes.SurveyReminder,
            Channel = NotificationChannels.Email,
            Title = "Reminder",
            Message = "Body",
            ScheduledFor = Now,
            CreatedAt = Now,
            UpdatedAt = Now,
        };

        db.Notifications.Add(Row());
        await db.SaveChangesAsync();

        await using var other = CreateContext();
        other.Notifications.Add(Row());

        await Assert.ThrowsAsync<DbUpdateException>(() => other.SaveChangesAsync());
    }

    [Fact]
    public async Task A_completed_invitation_is_not_reminded()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var invitation = NewInvitation(survey, user, Now.AddDays(-7));
        invitation.CompletedAt = Now.AddDays(-1);
        db.SurveyInvitations.Add(invitation);
        await db.SaveChangesAsync();

        var result = await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        Assert.Equal(0, result.Raised);
        Assert.False(await db.Notifications.AnyAsync(n => n.UserId == user.Id));
    }

    [Fact]
    public async Task A_closed_survey_produces_no_reminders()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        survey.Status = SurveyStatuses.Closed;
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        db.SurveyInvitations.Add(NewInvitation(survey, user, Now.AddDays(-7)));
        await db.SaveChangesAsync();

        var result = await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        Assert.Equal(0, result.Examined);
        Assert.Equal(0, result.Raised);
    }

    [Fact]
    public async Task Reminders_switched_off_on_the_survey_are_honoured_in_the_query()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        survey.Settings.NotificationSendReminders = false;
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        db.SurveyInvitations.Add(NewInvitation(survey, user, Now.AddDays(-7)));
        await db.SaveChangesAsync();

        var result = await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        Assert.Equal(0, result.Raised);
    }

    [Fact]
    public async Task Reminder_copy_is_written_in_the_recipients_language()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var spanish = NewUser(company.Id, language: "es");
        var english = NewUser(company.Id, language: "en");
        db.Companies.Add(company);
        db.Users.AddRange(spanish, english);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, spanish.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        db.SurveyInvitations.AddRange(
            NewInvitation(survey, spanish, Now.AddDays(-7)),
            NewInvitation(survey, english, Now.AddDays(-7)));
        await db.SaveChangesAsync();

        await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        await using var read = CreateContext();
        var es = await read.Notifications.SingleAsync(n => n.UserId == spanish.Id);
        var en = await read.Notifications.SingleAsync(n => n.UserId == english.Id);

        Assert.Contains("Recordatorio", es.Title);
        Assert.Contains("Encuesta de Clima Q3", es.Message);
        Assert.Contains("Reminder", en.Title);
        Assert.Contains("Q3 Climate Survey", en.Message);
    }

    [Fact]
    public async Task A_reminder_is_delivered_by_the_same_dispatch_path_as_a_manual_one()
    {
        // The reminder job raises `pending`; NotificationDelivery is what sends. This asserts
        // the handoff, which is the reason the reminder job does not talk to a sender itself.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        db.SurveyInvitations.Add(NewInvitation(survey, user, Now.AddDays(-7)));
        await db.SaveChangesAsync();

        await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        var sender = new LoggingNotificationSender(NullLogger<LoggingNotificationSender>.Instance);
        var dispatched = await NotificationDelivery.ProcessDueAsync(
            db, sender, NullLoggerFactory.Instance, companyId: null, Now.AddMinutes(1),
            NotificationDelivery.DefaultBatchSize, default);

        Assert.Equal(1, dispatched.Attempted);
        Assert.Equal(1, dispatched.Sent);

        // And a second dispatch sweep finds nothing: `sent` is not retryable.
        var again = await NotificationDelivery.ProcessDueAsync(
            db, sender, NullLoggerFactory.Instance, companyId: null, Now.AddMinutes(2),
            NotificationDelivery.DefaultBatchSize, default);

        Assert.Equal(0, again.Attempted);
    }

    [Fact]
    public async Task A_reminder_to_a_recipient_who_opted_out_is_cancelled_not_sent()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        user.Notifications.EmailSurveys = false;
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = NewActiveSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        db.SurveyInvitations.Add(NewInvitation(survey, user, Now.AddDays(-7)));
        await db.SaveChangesAsync();

        await InvitationReminderJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, InvitationReminderJob.DefaultBatchSize, default);

        await NotificationDelivery.ProcessDueAsync(
            db, new LoggingNotificationSender(NullLogger<LoggingNotificationSender>.Instance),
            NullLoggerFactory.Instance, companyId: null, Now.AddMinutes(1),
            NotificationDelivery.DefaultBatchSize, default);

        await using var read = CreateContext();
        var notification = await read.Notifications.SingleAsync(n => n.UserId == user.Id);

        Assert.Equal(NotificationStatuses.Cancelled, notification.Status);
        Assert.Null(notification.SentAt);
    }

    // -- digests ------------------------------------------------------------------------

    [Fact]
    public async Task A_user_set_to_never_gets_no_digest_however_much_activity_they_have()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id, digestFrequency: NotificationPreferenceValidation.DigestNever);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        SeedActivity(db, company.Id, user.Id, count: 5, at: Now.AddDays(-2));
        await db.SaveChangesAsync();

        var result = await DigestJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);

        Assert.Equal(0, result.UsersExamined);
        Assert.Equal(0, result.DigestsRaised);
    }

    [Fact]
    public async Task A_daily_digest_is_raised_once_per_local_day_no_matter_how_often_the_sweep_runs()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id, NotificationPreferenceValidation.DigestDaily, timezone: "America/Bogota");
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        // Yesterday in Bogota, which is the window a digest raised today covers.
        SeedActivity(db, company.Id, user.Id, count: 3, at: Now.AddDays(-1));
        await db.SaveChangesAsync();

        // 15:00 UTC is 10:00 in Bogota -- past the 08:00 send hour.
        for (var tick = Now; tick < Now.AddHours(8); tick = tick.AddMinutes(15))
        {
            await DigestJob.RunAsync(
                db, NullLoggerFactory.Instance, tick, DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);
        }

        await using var read = CreateContext();
        var digests = await read.Notifications
            .Where(n => n.UserId == user.Id && n.Type == NotificationTypes.SystemNotification)
            .ToListAsync();

        Assert.Single(digests);

        // The period key is the day the digest is *for* -- 6 August in Bogota -- and it
        // summarises the day before it. Thirty-two sweeps over eight hours produce exactly one
        // row, because all thirty-two compute this same id.
        Assert.Equal(
            DeterministicNotificationId.ForDigest(user.Id, "2026-08-06"),
            digests[0].Id);
    }

    [Fact]
    public async Task A_period_with_no_activity_produces_no_digest()
    {
        // "You have 0 new notifications" is a mail that trains the recipient to ignore the next
        // one.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id, NotificationPreferenceValidation.DigestDaily);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var result = await DigestJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);

        Assert.Equal(1, result.UsersExamined);
        Assert.Equal(0, result.DigestsRaised);
    }

    [Fact]
    public async Task A_digest_does_not_count_previous_digests_or_suppressed_notifications()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id, NotificationPreferenceValidation.DigestDaily);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        SeedActivity(db, company.Id, user.Id, count: 2, at: Now.AddDays(-1));

        // A previous digest, and a notification the recipient's own opt-out suppressed. Counting
        // either would make the digest a summary of the platform's housekeeping rather than of
        // anything the recipient might act on -- and re-surfacing a suppressed notification would
        // make the opt-out cosmetic.
        db.Notifications.Add(NewNotification(
            company.Id, user.Id, NotificationTypes.SystemNotification, NotificationStatuses.Sent, Now.AddDays(-1)));
        db.Notifications.Add(NewNotification(
            company.Id, user.Id, NotificationTypes.SurveyReminder, NotificationStatuses.Cancelled, Now.AddDays(-1)));
        await db.SaveChangesAsync();

        await DigestJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);

        await using var read = CreateContext();
        var digest = await read.Notifications.SingleAsync(n =>
            n.Id == DeterministicNotificationId.ForDigest(user.Id, "2026-08-06"));

        Assert.Contains("2 new notifications", digest.Message);
    }

    [Fact]
    public async Task Two_users_in_different_timezones_get_digests_for_their_own_day()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var bogota = NewUser(company.Id, NotificationPreferenceValidation.DigestDaily, "America/Bogota");
        var kathmandu = NewUser(company.Id, NotificationPreferenceValidation.DigestDaily, "Asia/Kathmandu");
        db.Companies.Add(company);
        db.Users.AddRange(bogota, kathmandu);
        await db.SaveChangesAsync();

        // Midnight UTC on 6 August falls inside both recipients' content windows -- Bogota's
        // runs 5 Aug 05:00 to 6 Aug 05:00 UTC, Kathmandu's 5 Aug 18:15 to 6 Aug 18:15 UTC. The
        // fact that those two windows for "the previous day" barely overlap is the point.
        var activityAt = new DateTimeOffset(2026, 8, 6, 0, 0, 0, TimeSpan.Zero);
        SeedActivity(db, company.Id, bogota.Id, count: 1, at: activityAt);
        SeedActivity(db, company.Id, kathmandu.Id, count: 1, at: activityAt);
        await db.SaveChangesAsync();

        // 03:00 UTC on 7 August: 22:00 on the 6th in Bogota, 08:45 on the 7th in Kathmandu.
        await DigestJob.RunAsync(
            db, NullLoggerFactory.Instance, new DateTimeOffset(2026, 8, 7, 3, 0, 0, TimeSpan.Zero),
            DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);

        await using var read = CreateContext();

        Assert.True(await read.Notifications.AnyAsync(n =>
            n.Id == DeterministicNotificationId.ForDigest(bogota.Id, "2026-08-06")));
        Assert.True(await read.Notifications.AnyAsync(n =>
            n.Id == DeterministicNotificationId.ForDigest(kathmandu.Id, "2026-08-07")));
    }

    [Fact]
    public async Task A_super_admin_with_no_company_is_never_selected_for_a_digest()
    {
        // notifications.company_id is a non-nullable FK, so a global-scope user (#191) has no
        // row shape that could hold their digest. Selecting them would throw on save and take
        // the whole sweep down.
        await using var db = await FreshAsync();

        var superAdmin = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = null,
            Email = $"root-{Guid.NewGuid():N}@platform.test",
            Name = "Root",
            Role = "super_admin",
            Notifications = new NotificationPreferences
            {
                DigestFrequency = NotificationPreferenceValidation.DigestDaily,
            },
            CreatedAt = Now,
            UpdatedAt = Now,
        };
        db.Users.Add(superAdmin);
        await db.SaveChangesAsync();

        var result = await DigestJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, DigestJob.DefaultPageSize, DigestJob.DefaultMaxUsersPerRun, default);

        Assert.Equal(0, result.UsersExamined);
    }

    // -- scheduled reports --------------------------------------------------------------

    [Fact]
    public async Task A_due_recurring_report_fires_once_and_advances_its_schedule()
    {
        await using var db = await FreshAsync();

        var company = NewCompany("America/Bogota");
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var report = NewRecurringReport(company.Id, user.Id, RecurrenceSchedule.Daily, Now.AddHours(-1));
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        var runner = new RecordingReportRunner();
        var first = await ScheduledReportJob.RunAsync(
            db, runner, NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        Assert.Equal(1, first.Fired);
        Assert.Single(runner.Occurrences);
        Assert.Equal(report.Id, runner.Occurrences[0].ReportId);

        // The occurrence handed to the runner is the schedule's own instant, not the wall clock
        // -- that is what makes it usable as an idempotency key by whatever #91 puts here.
        Assert.Equal(Now.AddHours(-1), runner.Occurrences[0].OccurrenceUtc);

        var second = await ScheduledReportJob.RunAsync(
            db, runner, NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        Assert.Equal(0, second.Fired);
        Assert.Single(runner.Occurrences);

        await using var read = CreateContext();
        var reloaded = await read.Reports.SingleAsync(r => r.Id == report.Id);
        Assert.NotNull(reloaded.NextGeneration);
        Assert.True(reloaded.NextGeneration > Now);
    }

    [Fact]
    public async Task A_long_dormant_schedule_fires_once_rather_than_backfilling()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        db.Reports.Add(NewRecurringReport(company.Id, user.Id, RecurrenceSchedule.Daily, Now.AddMonths(-4)));
        await db.SaveChangesAsync();

        var runner = new RecordingReportRunner();
        var result = await ScheduledReportJob.RunAsync(
            db, runner, NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        Assert.Equal(1, result.Fired);
        Assert.Single(runner.Occurrences);
        Assert.True(result.OccurrencesSkipped > 100);
    }

    [Fact]
    public async Task An_invalid_recurrence_pattern_stops_re_firing_without_discarding_the_admins_intent()
    {
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var report = NewRecurringReport(company.Id, user.Id, "every other tuesday", Now.AddHours(-1));
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        var runner = new RecordingReportRunner();
        var result = await ScheduledReportJob.RunAsync(
            db, runner, NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        Assert.Equal(0, result.Fired);
        Assert.Equal(1, result.SchedulesCleared);
        Assert.Empty(runner.Occurrences);

        await using var read = CreateContext();
        var reloaded = await read.Reports.SingleAsync(r => r.Id == report.Id);

        Assert.Null(reloaded.NextGeneration);
        Assert.True(reloaded.IsRecurring);
        Assert.Contains("Unrecognised recurrence pattern", reloaded.GenerationError);

        // And it no longer matches the due query, so the log does not fill with the same
        // complaint every fifteen minutes forever.
        var again = await ScheduledReportJob.RunAsync(
            read, runner, NullLoggerFactory.Instance, Now.AddDays(1), ScheduledReportJob.DefaultBatchSize, default);
        Assert.Equal(0, again.SchedulesCleared);
    }

    [Fact]
    public async Task A_runner_that_throws_rolls_the_schedule_back_so_the_occurrence_is_retried()
    {
        // The reason the advance is not committed first as an optimistic claim: doing so would
        // turn every transient generation failure into a silently skipped report.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var occurrence = Now.AddHours(-1);
        var report = NewRecurringReport(company.Id, user.Id, RecurrenceSchedule.Daily, occurrence);
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        await using (var attempt = CreateContext())
        {
            await using var transaction = await attempt.Database.BeginTransactionAsync();

            await Assert.ThrowsAsync<InvalidOperationException>(() => ScheduledReportJob.RunAsync(
                attempt, new ThrowingReportRunner(), NullLoggerFactory.Instance, Now,
                ScheduledReportJob.DefaultBatchSize, default));

            await transaction.RollbackAsync();
        }

        await using var read = CreateContext();
        var reloaded = await read.Reports.SingleAsync(r => r.Id == report.Id);

        Assert.Equal(occurrence, reloaded.NextGeneration);
    }

    // -- the lease ----------------------------------------------------------------------

    [Fact]
    public async Task Only_one_connection_can_hold_a_jobs_lease_at_a_time()
    {
        // The multi-instance guarantee, exercised the only way it can be: two real connections
        // to a real Postgres contending for the same advisory lock key.
        await using var first = await MigratedAsync(CreateContext());
        await using var second = CreateContext();

        var key = DeterministicNotificationId.LockKey(WorkerJobs.Digests);
        var secondRan = true;
        var secondEntered = false;

        var held = await new PostgresAdvisoryJobLease(first).TryRunExclusivelyAsync(
            key,
            async _ =>
            {
                secondRan = await new PostgresAdvisoryJobLease(second).TryRunExclusivelyAsync(
                    key,
                    _ =>
                    {
                        secondEntered = true;
                        return Task.CompletedTask;
                    },
                    default);
            },
            default);

        Assert.True(held);
        Assert.False(secondRan);
        Assert.False(secondEntered);
    }

    [Fact]
    public async Task The_lease_is_released_when_the_transaction_ends_and_is_reacquirable()
    {
        // Advisory locks taken with the xact variant are released by commit, by rollback and by
        // the connection dropping -- which is the whole reason there is no expiry to tune and no
        // stale-lease cleanup to forget.
        await using var db = await FreshAsync();
        var lease = new PostgresAdvisoryJobLease(db);
        var key = DeterministicNotificationId.LockKey(WorkerJobs.ScheduledReports);

        Assert.True(await lease.TryRunExclusivelyAsync(key, _ => Task.CompletedTask, default));
        Assert.True(await lease.TryRunExclusivelyAsync(key, _ => Task.CompletedTask, default));
    }

    [Fact]
    public async Task Two_different_jobs_do_not_block_each_other()
    {
        await using var first = await MigratedAsync(CreateContext());
        await using var second = CreateContext();

        var secondRan = false;

        await new PostgresAdvisoryJobLease(first).TryRunExclusivelyAsync(
            DeterministicNotificationId.LockKey(WorkerJobs.Digests),
            async _ =>
            {
                secondRan = await new PostgresAdvisoryJobLease(second).TryRunExclusivelyAsync(
                    DeterministicNotificationId.LockKey(WorkerJobs.InvitationReminders),
                    _ => Task.CompletedTask,
                    default);
            },
            default);

        Assert.True(secondRan);
    }

    [Fact]
    public async Task Work_committed_under_a_lease_is_visible_to_the_next_holder()
    {
        // "Took the lease" and "the work landed" have to be the same event; if they were not,
        // the next holder could re-do work the previous one had already done but not committed.
        await using var db = await FreshAsync();

        var company = NewCompany();
        var user = NewUser(company.Id);
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var id = DeterministicNotificationId.ForDigest(user.Id, "2026-08-05");

        await new PostgresAdvisoryJobLease(db).TryRunExclusivelyAsync(
            DeterministicNotificationId.LockKey(WorkerJobs.Digests),
            async token =>
            {
                db.Notifications.Add(new Notification
                {
                    Id = id,
                    UserId = user.Id,
                    CompanyId = company.Id,
                    Type = NotificationTypes.SystemNotification,
                    Channel = NotificationChannels.Email,
                    Title = "Digest",
                    Message = "Body",
                    ScheduledFor = Now,
                    CreatedAt = Now,
                    UpdatedAt = Now,
                });
                await db.SaveChangesAsync(token);
            },
            default);

        await using var read = CreateContext();
        Assert.True(await read.Notifications.AnyAsync(n => n.Id == id));
    }

    // -- helpers ------------------------------------------------------------------------

    private static void SeedActivity(ClimateProjectDbContext db, Guid companyId, Guid userId, int count, DateTimeOffset at)
    {
        for (var i = 0; i < count; i++)
        {
            db.Notifications.Add(NewNotification(
                companyId, userId, NotificationTypes.SurveyInvitation, NotificationStatuses.Sent, at));
        }
    }

    private static Notification NewNotification(
        Guid companyId, Guid userId, string type, string status, DateTimeOffset at) => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            Type = type,
            Channel = NotificationChannels.Email,
            Status = status,
            Title = "Activity",
            Message = "Body",
            ScheduledFor = at,
            CreatedAt = at,
            UpdatedAt = at,
        };

    private static Report NewRecurringReport(
        Guid companyId, Guid createdBy, string? pattern, DateTimeOffset nextGeneration) => new()
        {
            Id = Guid.NewGuid(),
            Title = "Monthly climate report",
            Type = "climate",
            CompanyId = companyId,
            CreatedBy = createdBy,
            Status = "completed",
            Format = "pdf",
            IsRecurring = true,
            RecurrencePattern = pattern,
            NextGeneration = nextGeneration,
            CreatedAt = Now.AddMonths(-6),
            UpdatedAt = Now.AddMonths(-6),
        };

    private sealed class RecordingReportRunner : IScheduledReportRunner
    {
        public List<ScheduledReportOccurrence> Occurrences { get; } = [];

        public Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken)
        {
            Occurrences.Add(occurrence);
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingReportRunner : IScheduledReportRunner
    {
        public Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Report generation failed.");
    }
}
