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

        var from = nowUtc - lookback;
        var until = nowUtc + window;

        // The owner is joined here rather than fetched per plan: the body is written in the
        // RECIPIENT's language, and one `GET /users/{id}` per plan is the N+1 this codebase
        // already refused for the owner column on the list.
        var candidates = await db.ActionPlans
            .AsNoTracking()
            .Where(plan => plan.OwnerId != null)
            .Where(plan => !SettledStatuses.Contains(plan.Status))
            .Where(plan => plan.DueDate >= from && plan.DueDate <= until)
            .OrderBy(plan => plan.DueDate)
            .Take(batchSize)
            .Join(
                db.Users.AsNoTracking(),
                plan => plan.OwnerId,
                user => (Guid?)user.Id,
                (plan, owner) => new { Plan = plan, Owner = owner })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (candidates.Count == 0)
        {
            return new ActionPlanDueSweepResult(0, 0, 0);
        }

        var planned = candidates
            .Select(row =>
            {
                var overdue = row.Plan.DueDate < nowUtc;
                var trigger = overdue ? OverdueTrigger : DueSoonTrigger;
                return new
                {
                    row.Plan,
                    row.Owner,
                    Overdue = overdue,
                    Trigger = trigger,
                    NotificationId = DeterministicNotificationId.ForActionPlanDue(
                        row.Plan.Id, row.Owner.Id, trigger),
                };
            })
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
                Message = ScheduledNotificationCopy.PlanDueBodyFor(
                    locale, title, nudge.Plan.DueDate, nudge.Overdue),

                // The instant the nudge became OWED, computed from the plan's own date, never
                // from the wall clock of the tick that noticed. Two instances racing compute
                // the same value and a late sweep records when it was due, not when it ran.
                ScheduledFor = nudge.Overdue ? nudge.Plan.DueDate : nudge.Plan.DueDate - window,
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
}
