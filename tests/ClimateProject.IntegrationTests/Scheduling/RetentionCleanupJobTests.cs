using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// The GDPR storage-limitation sweep (#144) against a real Postgres.
///
/// <para>The thing worth testing about a job that deletes production data is not that it
/// deletes — that is the easy half — but that it deletes <b>only</b> what its predicate names.
/// So every test here seeds a matched pair: one row inside the window and one just outside it,
/// differing by a day, and asserts that the second survives. A sweep with a broken predicate
/// passes a "did it delete the expired row?" test perfectly.</para>
///
/// <para>Row counts are read from the tables directly, not through an API. Nothing in the
/// product surfaces a swept row either way, so an assertion made through an endpoint would
/// pass identically whether the sweep worked or did nothing — the same reason
/// <see cref="SurveyDraftRetentionJobTests"/> counts rows.</para>
///
/// <para><c>TRUNCATE companies CASCADE</c> before each test, matching the other
/// deployment-wide sweeps in this assembly: the job takes no company id, so a row another
/// test left behind would be inside the measurement.</para>
/// </summary>
[Collection("Postgres")]
public class RetentionCleanupJobTests(PostgresContainerFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan NotificationWindow = TimeSpan.FromDays(365);
    private static readonly TimeSpan InvitationGrace = TimeSpan.FromDays(90);

    private async Task<ClimateProjectDbContext> FreshAsync()
    {
        var db = new ClimateProjectDbContext(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");
        return db;
    }

    private static async Task<(Company Company, User User)> SeedTenantAsync(ClimateProjectDbContext db)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"Retention-{Guid.NewGuid():N}",
            EmailDomain = $"retention-{Guid.NewGuid():N}.test",
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = Now,
        };
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"subject-{Guid.NewGuid():N}@{company.EmailDomain}",
            Name = "Subject",
            Role = "employee",
            CreatedAt = Now,
            UpdatedAt = Now,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    private static Notification Notification(Guid companyId, Guid userId, DateTimeOffset createdAt, string status)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            Type = "survey_invitation",
            Channel = NotificationChannels.Email,
            Status = status,
            Title = "Title",
            Message = "Message",
            ScheduledFor = createdAt,
            CreatedAt = createdAt,
            UpdatedAt = createdAt,
        };

    private static UserInvitation Invitation(
        Guid companyId, Guid invitedBy, DateTimeOffset expiresAt, string status, DateTimeOffset? acceptedAt = null)
        => new()
        {
            Id = Guid.NewGuid(),
            Email = $"invitee-{Guid.NewGuid():N}@invited.test",
            CompanyId = companyId,
            InvitedBy = invitedBy,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeDirect,
            Role = "employee",
            Status = status,
            ExpiresAt = expiresAt,
            AcceptedAt = acceptedAt,
        };

    private async Task<RetentionCleanupResultShim> SweepAsync(ClimateProjectDbContext db, int? cap = null)
    {
        var result = await RetentionCleanupJob.SweepAsync(
            db, Now, cap, NotificationWindow, InvitationGrace, CancellationToken.None);
        return new RetentionCleanupResultShim(result.TotalDeleted, result.Categories.ToDictionary(c => c.Category));
    }

    private sealed record RetentionCleanupResultShim(
        int TotalDeleted,
        IReadOnlyDictionary<string, Application.Gdpr.RetentionCleanupCategory> Categories);

    [Fact]
    public async Task A_notification_one_day_inside_the_window_survives_the_sweep_that_takes_the_one_outside_it()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        // Exactly on the boundary counts as expired: the predicate is created_at <= cutoff.
        var onTheBoundary = Notification(
            company.Id, user.Id, Now - NotificationWindow, NotificationStatuses.Sent);
        var oneDayOlder = Notification(
            company.Id, user.Id, Now - NotificationWindow - TimeSpan.FromDays(1), NotificationStatuses.Delivered);
        var oneDayYounger = Notification(
            company.Id, user.Id, Now - NotificationWindow + TimeSpan.FromDays(1), NotificationStatuses.Sent);

        db.Notifications.AddRange(onTheBoundary, oneDayOlder, oneDayYounger);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(2, result.Categories[RetentionCleanupJob.NotificationsCategory].Deleted);
        var survivors = await db.Notifications.Select(n => n.Id).ToListAsync();
        Assert.Equal([oneDayYounger.Id], survivors);
    }

    [Fact]
    public async Task A_notification_still_in_flight_is_never_swept_however_old_it_is()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        var ancient = Now - NotificationWindow - TimeSpan.FromDays(3650);
        var pending = Notification(company.Id, user.Id, ancient, NotificationStatuses.Pending);
        var cancelled = Notification(company.Id, user.Id, ancient, NotificationStatuses.Cancelled);
        var sent = Notification(company.Id, user.Id, ancient, NotificationStatuses.Sent);

        db.Notifications.AddRange(pending, cancelled, sent);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        // "cancelled" is deliberately absent from TerminalNotificationStatuses: it means
        // "deliberately not delivered", which is a decision somebody may need to account for.
        Assert.Equal(1, result.Categories[RetentionCleanupJob.NotificationsCategory].Deleted);
        var survivors = await db.Notifications.Select(n => n.Id).OrderBy(id => id).ToListAsync();
        Assert.Equal(new[] { pending.Id, cancelled.Id }.OrderBy(id => id), survivors);
    }

    [Fact]
    public async Task An_accepted_invitation_survives_however_long_ago_it_expired()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        var longExpired = Now - InvitationGrace - TimeSpan.FromDays(30);
        var unaccepted = Invitation(company.Id, user.Id, longExpired, InvitationValidation.StatusSent);
        var accepted = Invitation(
            company.Id, user.Id, longExpired, InvitationValidation.StatusAccepted, acceptedAt: longExpired);
        var withinGrace = Invitation(
            company.Id, user.Id, Now - InvitationGrace + TimeSpan.FromDays(1), InvitationValidation.StatusSent);

        db.UserInvitations.AddRange(unaccepted, accepted, withinGrace);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Categories[RetentionCleanupJob.InvitationsCategory].Deleted);
        var survivors = await db.UserInvitations.Select(i => i.Id).OrderBy(id => id).ToListAsync();
        Assert.Equal(new[] { accepted.Id, withinGrace.Id }.OrderBy(id => id), survivors);
    }

    [Fact]
    public async Task An_expired_draft_goes_and_a_live_one_stays()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        var expired = Draft(company.Id, user.Id, Now - TimeSpan.FromDays(1));
        var live = Draft(company.Id, user.Id, Now + TimeSpan.FromDays(1));
        db.SurveyDrafts.AddRange(expired, live);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Categories[RetentionCleanupJob.SurveyDraftsCategory].Deleted);
        Assert.Equal([live.Id], await db.SurveyDrafts.Select(d => d.Id).ToListAsync());
    }

    [Fact]
    public async Task The_cap_bounds_each_category_and_the_run_reports_the_backlog()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        var stale = Now - NotificationWindow - TimeSpan.FromDays(1);
        for (var i = 0; i < 5; i++)
        {
            db.Notifications.Add(Notification(company.Id, user.Id, stale, NotificationStatuses.Sent));
        }
        await db.SaveChangesAsync();

        var first = await SweepAsync(db, cap: 2);
        Assert.Equal(2, first.Categories[RetentionCleanupJob.NotificationsCategory].Deleted);
        Assert.True(first.Categories[RetentionCleanupJob.NotificationsCategory].MoreRemaining);
        Assert.Equal(3, await db.Notifications.CountAsync());

        var second = await SweepAsync(db, cap: 2);
        Assert.Equal(2, second.Categories[RetentionCleanupJob.NotificationsCategory].Deleted);

        var third = await SweepAsync(db, cap: 2);
        Assert.Equal(1, third.Categories[RetentionCleanupJob.NotificationsCategory].Deleted);
        Assert.False(third.Categories[RetentionCleanupJob.NotificationsCategory].MoreRemaining);
        Assert.Equal(0, await db.Notifications.CountAsync());
    }

    [Fact]
    public async Task Audit_records_are_never_swept()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        // Older than every window this job knows about. audit_logs has no expiry here on
        // purpose -- see the class remarks on RetentionCleanupJob.
        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            CompanyId = company.Id,
            Action = "login",
            Resource = "user",
            Success = true,
            Timestamp = Now - TimeSpan.FromDays(3650),
        });
        await db.SaveChangesAsync();

        await SweepAsync(db);

        Assert.Equal(1, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task RunAsync_uses_the_shipped_windows_and_logs_without_a_logger_of_its_own()
    {
        await using var db = await FreshAsync();
        var (company, user) = await SeedTenantAsync(db);

        var beyondShippedWindow = DateTimeOffset.UtcNow - RetentionCleanupJob.DefaultNotificationRetention
            - TimeSpan.FromDays(1);
        var doomed = Notification(company.Id, user.Id, beyondShippedWindow, NotificationStatuses.Sent);
        var fresh = Notification(company.Id, user.Id, DateTimeOffset.UtcNow, NotificationStatuses.Sent);
        db.Notifications.AddRange(doomed, fresh);
        await db.SaveChangesAsync();

        var result = await RetentionCleanupJob.RunAsync(
            db, NullLoggerFactory.Instance, DateTimeOffset.UtcNow,
            RetentionCleanupJob.DefaultBatchSize, CancellationToken.None);

        Assert.Equal(1, result.TotalDeleted);
        Assert.Equal([fresh.Id], await db.Notifications.Select(n => n.Id).ToListAsync());
    }

    /// <summary>
    /// The race the capped path exists to survive, reproduced deterministically.
    /// </summary>
    /// <remarks>
    /// Wave 1 fixed a retention job that harvested ids and then deleted by id alone, which
    /// reclaims a row that stopped being expired in between. The capped path here is two
    /// statements for the same reason — <c>Take</c> inside <c>ExecuteDelete</c> is not
    /// translatable everywhere — so it restates the predicate in the DELETE. That restatement
    /// is invisible to every other test in this class, because a single-threaded test never
    /// interleaves anything between the two statements.
    ///
    /// <para>The interceptor supplies the interleaving: it fires once, after the SELECT that
    /// harvests invitation ids, and accepts the invitation through a <b>separate</b> connection
    /// so the change is committed and visible before the DELETE runs. Acceptance is exactly the
    /// event that must save the row, so if the DELETE were by id alone this test would find the
    /// invitation gone — an accepted invitation destroyed by a retention sweep.</para>
    /// </remarks>
    [Fact]
    public async Task An_invitation_accepted_between_the_select_and_the_delete_survives()
    {
        await using (var seed = await FreshAsync())
        {
            var (company, user) = await SeedTenantAsync(seed);
            seed.UserInvitations.Add(Invitation(
                company.Id, user.Id, Now - InvitationGrace - TimeSpan.FromDays(30), InvitationValidation.StatusSent));
            await seed.SaveChangesAsync();
        }

        var interceptor = new AcceptInvitationMidSweepInterceptor(postgres.ConnectionString);
        await using var db = new ClimateProjectDbContext(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .AddInterceptors(interceptor)
            .Options);

        // Capped, because the cap is what makes this two statements. Uncapped is a single
        // DELETE and has no window to race in at all.
        var result = await RetentionCleanupJob.SweepAsync(
            db, Now, maxRowsPerCategory: 10, NotificationWindow, InvitationGrace, CancellationToken.None);

        Assert.True(interceptor.Fired, "The interleaving never happened, so this test proved nothing.");
        Assert.Equal(0, result.Categories.Single(c => c.Category == RetentionCleanupJob.InvitationsCategory).Deleted);

        await using var verify = new ClimateProjectDbContext(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);
        var survivor = await verify.UserInvitations.SingleAsync();
        Assert.Equal(InvitationValidation.StatusAccepted, survivor.Status);
    }

    private sealed class AcceptInvitationMidSweepInterceptor(string connectionString)
        : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public bool Fired { get; private set; }

        public override async ValueTask<System.Data.Common.DbDataReader> ReaderExecutedAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandExecutedEventData eventData,
            System.Data.Common.DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (Fired
                || !command.CommandText.Contains("user_invitations", StringComparison.Ordinal)
                || !command.CommandText.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase))
            {
                return result;
            }

            Fired = true;

            // A separate context, and therefore a separate connection: the sweep's own
            // connection is mid-command, and the point is that this change is committed and
            // visible to the DELETE that follows.
            await using var other = new ClimateProjectDbContext(
                new DbContextOptionsBuilder<ClimateProjectDbContext>()
                    .UseNpgsql(connectionString)
                    .Options);

            var invitation = await other.UserInvitations.FirstAsync(cancellationToken);
            invitation.Status = InvitationValidation.StatusAccepted;
            invitation.AcceptedAt = Now;
            await other.SaveChangesAsync(cancellationToken);

            return result;
        }
    }

    private static SurveyDraft Draft(Guid companyId, Guid userId, DateTimeOffset expiresAt)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            DraftData = "{}",
            CurrentStep = 1,
            Version = 1,
            ExpiresAt = expiresAt,
            CreatedAt = expiresAt - SurveyDraftRetention.Ttl,
            UpdatedAt = expiresAt - SurveyDraftRetention.Ttl,
        };
}
