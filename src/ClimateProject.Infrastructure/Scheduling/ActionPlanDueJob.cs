using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Tells the person answerable for an action plan that it is about to lapse, or has.
///
/// <para>Planes de Accion leads with a <i>Seguimiento / atrasados</i> tile and nothing in the
/// platform has ever told an owner their plan is due: the owner found out by opening a page
/// they had no reason to open. This is the ninth job on the existing scaffold, and it raises
/// the notification type that already existed -- <see cref="NotificationTypes.ActionPlanAlert"/>
/// -- rather than inventing one.</para>
///
/// <para><b>It does not send.</b> Like <see cref="InvitationReminderJob"/>, it creates
/// <c>pending</c> rows and stops. Consent is evaluated at delivery by
/// <c>NotificationDelivery</c>, so an owner who turns <c>EmailActionPlans</c> off between the
/// nudge being raised and being sent is still honoured, and there is no second copy of the
/// dispatch rules here.</para>
///
/// <para><b>Only an owner is notified.</b> A plan with no <c>OwnerId</c> is skipped, because
/// there is nobody for the nudge to be about -- that plan's problem is that it is unassigned,
/// which is what the screen's "sin responsable" tile is for, and mailing the whole company
/// about it would be worse than silence. This is also why a GDPR erasure now CLEARS
/// <c>owner_id</c>: an erased owner's plans drop out of this sweep by construction rather than
/// having their nudges addressed to a pseudonym nobody can read.</para>
///
/// <para><b>Why the window has a floor as well as a ceiling.</b> The obvious query -- every
/// open plan due within seven days -- never stops matching an overdue plan, so a tenant with
/// six long-dead plans would spend every batch slot re-examining them and a plan falling due
/// today would never be reached. Idempotency would keep it correct and starvation would keep
/// it useless. Bounding the lookback means a plan leaves the candidate set on its own, with no
/// column to advance and no migration to write, and nudging about something a month overdue
/// every hour was never wanted anyway.</para>
/// </summary>
public static class ActionPlanDueJob
{
    /// <summary>Plans examined per sweep. One sweep is one bounded transaction.</summary>
    public const int DefaultBatchSize = 500;

    /// <summary>How long before the due date the first nudge goes out.</summary>
    public static readonly TimeSpan DefaultWindow = TimeSpan.FromDays(7);

    /// <summary>How far past the due date a plan still earns an overdue nudge. See the remarks.</summary>
    public static readonly TimeSpan DefaultLookback = TimeSpan.FromDays(30);

    /// <summary>The trigger names, which are part of the notification's identity.</summary>
    public const string DueSoonTrigger = "due_soon";

    /// <summary>See <see cref="DueSoonTrigger"/>.</summary>
    public const string OverdueTrigger = "overdue";

    /// <summary>A plan in one of these is over; nothing it says is still owed.</summary>
    private static readonly string[] SettledStatuses = ["completed", "cancelled"];

    private const string LogCategory = "ClimateProject.Workers.ActionPlanDue";

    /// <param name="Examined">Plans in the window with an owner.</param>
    /// <param name="Raised">Notifications created by this sweep.</param>
    /// <param name="AlreadyRaised">Nudges this sweep found were already issued.</param>
    public sealed record ActionPlanDueSweepResult(int Examined, int Raised, int AlreadyRaised);

    public static async Task<ActionPlanDueSweepResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int batchSize,
        TimeSpan window,
        TimeSpan lookback,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        var logger = loggerFactory.CreateLogger(LogCategory);

        // A coarse pre-filter in instants, widened by a day each side; the decision itself is
        // made below in calendar days, which an instant comparison cannot express. See
        // `DueDayOf` and `TodayFor` for why the two must be days and not timestamps.
        var from = nowUtc - lookback - TimeSpan.FromDays(1);
        var until = nowUtc + window + TimeSpan.FromDays(1);

        // The owner is joined here rather than fetched per plan: the body is written in the
        // RECIPIENT's language, and one `GET /users/{id}` per plan is the N+1 this codebase
        // already refused for the owner column on the list. The company is joined for its
        // time zone, the fallback when the owner's own is unset.
        //
        // An inactive owner is excluded here, not at delivery. Delivery would cancel the mail
        // (`NotificationDelivery` refuses a deactivated recipient), and retention never purges
        // a `cancelled` row -- so raising it anyway left a permanent row naming the plan for a
        // person who will never read it.
        var candidates = await db.ActionPlans
            .AsNoTracking()
            .Where(plan => plan.OwnerId != null)
            .Where(plan => !SettledStatuses.Contains(plan.Status))
            .Where(plan => plan.DueDate >= from && plan.DueDate <= until)
            .OrderBy(plan => plan.DueDate)
            .Join(
                db.Users.AsNoTracking().Where(user => user.IsActive),
                plan => plan.OwnerId,
                user => (Guid?)user.Id,
                (plan, owner) => new { Plan = plan, Owner = owner })
            .Join(
                db.Companies.AsNoTracking(),
                row => row.Plan.CompanyId,
                company => company.Id,
                (row, company) => new { row.Plan, row.Owner, CompanyTimezone = company.Settings.Timezone })
            .Take(batchSize)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            return new ActionPlanDueSweepResult(0, 0, 0);
        }

        var windowDays = (int)Math.Ceiling(window.TotalDays);
        var lookbackDays = (int)Math.Ceiling(lookback.TotalDays);

        var planned = candidates
            .Select(row =>
            {
                var zone = ZoneFor(row.Owner.Preferences.Timezone, row.CompanyTimezone);
                var today = TodayFor(nowUtc, zone);
                var dueDay = DueDayOf(row.Plan.DueDate);
                var daysLeft = dueDay.DayNumber - today.DayNumber;
                var overdue = daysLeft < 0;
                var trigger = overdue ? OverdueTrigger : DueSoonTrigger;
                return new
                {
                    row.Plan,
                    row.Owner,
                    Zone = zone,
                    DueDay = dueDay,
                    InWindow = daysLeft <= windowDays && daysLeft >= -lookbackDays,
                    Overdue = overdue,
                    Trigger = trigger,
                    NotificationId = DeterministicNotificationId.ForActionPlanDue(
                        row.Plan.Id, row.Owner.Id, trigger),
                };
            })
            .Where(nudge => nudge.InWindow)
            .ToList();

        var ids = planned.Select(p => p.NotificationId).ToList();
        var alreadyRaised = await db.Notifications
            .AsNoTracking()
            .Where(notification => ids.Contains(notification.Id))
            .Select(notification => notification.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var seen = alreadyRaised.ToHashSet();
        var raised = 0;

        foreach (var nudge in planned)
        {
            if (!seen.Add(nudge.NotificationId))
            {
                continue;
            }

            var locale = nudge.Owner.Preferences.Language;
            var title = AuthoredContent.ResolveText(nudge.Plan.TitleEn, nudge.Plan.TitleEs, locale);

            db.Notifications.Add(new Notification
            {
                Id = nudge.NotificationId,
                UserId = nudge.Owner.Id,

                // The PLAN's tenant, not the owner's. They are the same today and the plan is
                // the thing the notice is about; reading it off the recipient would be a
                // second source of truth that only diverges in the case that matters.
                CompanyId = nudge.Plan.CompanyId,
                Type = NotificationTypes.ActionPlanAlert,
                Channel = NotificationChannels.Email,
                Priority = nudge.Overdue ? NotificationPriorities.High : NotificationPriorities.Medium,
                Status = NotificationStatuses.Pending,
                Title = ScheduledNotificationCopy.PlanDueTitleFor(locale, nudge.Overdue),
                // Whether the owner may act on the plan themselves decides what the body
                // asks of them -- the same `Roles.Admin` rule ActionPlanEndpoints enforces.
                Message = ScheduledNotificationCopy.PlanDueBodyFor(
                    locale, title, nudge.Plan.DueDate, nudge.Overdue,
                    recipientAdministers: Roles.Admin.Contains(nudge.Owner.Role)),

                // The instant the nudge became OWED, computed from the plan's own date, never
                // from the wall clock of the tick that noticed. Two instances racing compute
                // the same value and a late sweep records when it was due, not when it ran.
                // The start of the day the nudge became owed in the recipient's zone: the day
                // after the due day for an overdue one, `window` days before it otherwise.
                ScheduledFor = SchedulingTimeZone.ToUtc(
                    (nudge.Overdue ? nudge.DueDay.AddDays(1) : nudge.DueDay.AddDays(-windowDays))
                        .ToDateTime(TimeOnly.MinValue),
                    nudge.Zone),
                Data = ActionPlanNotificationData.Serialize(nudge.Plan.Id),
                RetryCount = 0,
                MaxRetries = 3,
                CreatedAt = nowUtc,
                UpdatedAt = nowUtc,
            });

            raised++;
        }

        if (raised > 0)
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        var result = new ActionPlanDueSweepResult(planned.Count, raised, planned.Count - raised);

        if (raised > 0)
        {
            logger.LogInformation(
                "Action plan due sweep examined {Examined} owned plans and raised {Raised} nudges; " +
                "{AlreadyRaised} had already been issued.",
                result.Examined,
                result.Raised,
                result.AlreadyRaised);
        }

        return result;
    }

    /// <summary>
    /// The plan's due day as every screen reads it: the UTC calendar date of the stored
    /// instant (<c>planDetailDerive.dueDay</c> is <c>toISOString().slice(0, 10)</c>).
    ///
    /// <para>Comparing the instant itself was the defect: the list page stores a due day as
    /// <c>T00:00:00Z</c>, which is 18:00 the evening BEFORE in Costa Rica, so a plan due on
    /// the 12th was mailed "está vencido" at 18:00 on the 11th while its own screen still said
    /// it was due tomorrow. The results page stores <c>T12:00:00Z</c>, so the two creation
    /// paths lapsed at different hours of the same day. A day is what the owner was promised;
    /// a day is what is compared.</para>
    /// </summary>
    internal static DateOnly DueDayOf(DateTimeOffset dueDate)
        => DateOnly.FromDateTime(dueDate.UtcDateTime);

    /// <summary>Today in the recipient's zone -- whose day it is, as <see cref="SchedulingTimeZone"/> rules it.</summary>
    internal static DateOnly TodayFor(DateTimeOffset nowUtc, TimeZoneInfo zone)
        => DateOnly.FromDateTime(SchedulingTimeZone.ToLocal(nowUtc, zone));

    /// <summary>
    /// The owner's zone, else the company's, else UTC. <c>"UTC"</c> is both columns' default,
    /// so an owner whose zone was never set reads as unset and the tenant's zone answers.
    /// </summary>
    internal static TimeZoneInfo ZoneFor(string? ownerTimezone, string? companyTimezone)
        => IsUnset(ownerTimezone)
            ? SchedulingTimeZone.Resolve(companyTimezone)
            : SchedulingTimeZone.Resolve(ownerTimezone);

    private static bool IsUnset(string? timezone)
        => string.IsNullOrWhiteSpace(timezone)
           || string.Equals(timezone.Trim(), "UTC", StringComparison.OrdinalIgnoreCase);
}
