using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// The reminder rule. Both directions of getting it wrong are visible to end users -- silence
/// on one side, nagging on the other -- and the failure that motivated #101 (reminders stopping
/// silently at cutover) is the silent one, which no test of the *sending* path would catch.
/// </summary>
public class ReminderScheduleTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid InvitationId = new("11111111-1111-1111-1111-111111111111");

    /// <summary>A live invitation, sent a week ago, never reminded, in a survey that runs another month.</summary>
    private static ReminderCandidate Due(
        string? status = ReminderSchedule.InvitationOutstanding,
        DateTimeOffset? sentAt = null,
        bool neverSent = false,
        DateTimeOffset? completedAt = null,
        DateTimeOffset? lastReminderSent = null,
        int reminderCount = 0,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? closesAt = null,
        bool remindersEnabled = true,
        int frequencyDays = 3,
        int? maxReminders = null)
        => new(
            InvitationId,
            status,
            neverSent ? null : sentAt ?? Now.AddDays(-7),
            completedAt,
            lastReminderSent,
            reminderCount,
            expiresAt ?? Now.AddDays(30),
            closesAt ?? Now.AddDays(30),
            remindersEnabled,
            frequencyDays,
            maxReminders);

    [Fact]
    public void An_outstanding_invitation_past_its_interval_is_reminded()
    {
        var decision = ReminderSchedule.Evaluate(Due(), Now);

        Assert.True(decision.ShouldSend);
        Assert.Equal(1, decision.ReminderNumber);
        Assert.Null(decision.Reason);
    }

    // -- the reasons not to send --------------------------------------------------------

    [Fact]
    public void A_completed_response_is_never_reminded()
    {
        // The one case where a reminder is not merely useless but wrong: it tells someone who
        // did the thing that they did not.
        var decision = ReminderSchedule.Evaluate(Due(completedAt: Now.AddDays(-1)), Now);

        Assert.False(decision.ShouldSend);
        Assert.Contains("already responded", decision.Reason);
    }

    [Fact]
    public void Reminders_switched_off_on_the_survey_are_honoured()
        => Assert.False(ReminderSchedule.Evaluate(Due(remindersEnabled: false), Now).ShouldSend);

    [Fact]
    public void An_invitation_that_was_never_sent_is_not_reminded()
    {
        // Sending first contact as a reminder would be incoherent, and would quietly paper over
        // a distribution run that failed.
        var decision = ReminderSchedule.Evaluate(Due(neverSent: true), Now);

        Assert.False(decision.ShouldSend);
        Assert.Contains("not been sent", decision.Reason);
    }

    [Fact]
    public void An_expired_invitation_is_not_reminded()
        => Assert.False(ReminderSchedule.Evaluate(Due(expiresAt: Now.AddMinutes(-1)), Now).ShouldSend);

    [Fact]
    public void A_closed_survey_is_not_reminded_even_if_the_token_is_still_valid()
    {
        // The two bounds are set independently, so a token can outlive its survey. Pointing
        // someone at a survey that will refuse their response is worse than saying nothing.
        var decision = ReminderSchedule.Evaluate(
            Due(expiresAt: Now.AddDays(30), closesAt: Now.AddMinutes(-1)), Now);

        Assert.False(decision.ShouldSend);
        Assert.Contains("window has closed", decision.Reason);
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("cancelled")]
    [InlineData("bounced")]
    [InlineData("")]
    [InlineData(null)]
    public void An_unrecognised_or_terminal_status_is_left_alone(string? status)
    {
        // An allow-list, not a deny-list: an unknown status means "we do not know what this row
        // is", and the safe reading of that is to leave the recipient alone.
        Assert.False(ReminderSchedule.Evaluate(Due(status: status), Now).ShouldSend);
    }

    [Theory]
    [InlineData(ReminderSchedule.InvitationOutstanding)]
    [InlineData(ReminderSchedule.InvitationSent)]
    [InlineData(ReminderSchedule.InvitationOpened)]
    [InlineData(ReminderSchedule.InvitationStarted)]
    public void Every_outstanding_status_is_reminded(string status)
        => Assert.True(ReminderSchedule.Evaluate(Due(status: status), Now).ShouldSend);

    // -- spacing ------------------------------------------------------------------------

    [Fact]
    public void The_first_reminder_is_measured_from_when_the_invitation_went_out()
    {
        // Not from "now minus frequency", which would remind everybody the same afternoon a
        // survey was distributed.
        Assert.False(ReminderSchedule.Evaluate(Due(sentAt: Now.AddDays(-2), frequencyDays: 3), Now).ShouldSend);
        Assert.True(ReminderSchedule.Evaluate(Due(sentAt: Now.AddDays(-3), frequencyDays: 3), Now).ShouldSend);
    }

    [Fact]
    public void Later_reminders_are_measured_from_the_previous_reminder()
    {
        var tooSoon = Due(sentAt: Now.AddDays(-30), lastReminderSent: Now.AddDays(-1), reminderCount: 1);
        var dueNow = Due(sentAt: Now.AddDays(-30), lastReminderSent: Now.AddDays(-3), reminderCount: 1);

        Assert.False(ReminderSchedule.Evaluate(tooSoon, Now).ShouldSend);

        var decision = ReminderSchedule.Evaluate(dueNow, Now);
        Assert.True(decision.ShouldSend);
        Assert.Equal(2, decision.ReminderNumber);
    }

    [Fact]
    public void The_due_instant_is_the_interval_boundary_not_the_tick_that_noticed_it()
    {
        // ScheduledFor is written from this value, so a sweep running four hours late still
        // records when the reminder was owed -- and two instances racing agree on it.
        var sentAt = Now.AddDays(-10);
        var decision = ReminderSchedule.Evaluate(Due(sentAt: sentAt, frequencyDays: 3), Now);

        Assert.True(decision.ShouldSend);
        Assert.Equal(sentAt.AddDays(3), decision.DueAt);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void A_zero_or_negative_frequency_is_clamped_to_one_day(int frequencyDays)
    {
        // NotificationReminderFrequencyDays is a plain int with no validation behind it. At 0
        // the "has enough time passed" test passes on every tick, which at a 15-minute cadence
        // is 96 reminders a day until the cap.
        Assert.False(ReminderSchedule
            .Evaluate(Due(sentAt: Now.AddHours(-1), frequencyDays: frequencyDays), Now).ShouldSend);

        Assert.True(ReminderSchedule
            .Evaluate(Due(sentAt: Now.AddDays(-1), frequencyDays: frequencyDays), Now).ShouldSend);
    }

    // -- the cap ------------------------------------------------------------------------

    [Fact]
    public void Reminders_stop_at_the_default_cap()
    {
        var atCap = Due(
            sentAt: Now.AddDays(-90),
            lastReminderSent: Now.AddDays(-30),
            reminderCount: ReminderSchedule.DefaultMaxReminders);

        var decision = ReminderSchedule.Evaluate(atCap, Now);

        Assert.False(decision.ShouldSend);
        Assert.Contains("maximum", decision.Reason);
    }

    [Fact]
    public void A_survey_may_lower_the_cap()
    {
        var candidate = Due(sentAt: Now.AddDays(-90), lastReminderSent: Now.AddDays(-30), reminderCount: 1, maxReminders: 1);

        Assert.False(ReminderSchedule.Evaluate(candidate, Now).ShouldSend);
    }

    [Fact]
    public void A_long_running_survey_cannot_produce_unbounded_reminders()
    {
        // Walk a year of ticks through the rule, applying each decision the way the job does.
        // Without the cap this produces ~120 reminders; the point is that the bound is a
        // property of the rule rather than of how often the worker happens to run.
        var reminderCount = 0;
        DateTimeOffset? lastReminderSent = null;
        var sentAt = Now;

        for (var tick = Now; tick < Now.AddDays(365); tick = tick.AddHours(6))
        {
            var decision = ReminderSchedule.Evaluate(
                Due(
                    sentAt: sentAt,
                    lastReminderSent: lastReminderSent,
                    reminderCount: reminderCount,
                    expiresAt: Now.AddDays(400),
                    closesAt: Now.AddDays(400)),
                tick);

            if (!decision.ShouldSend)
            {
                continue;
            }

            reminderCount = decision.ReminderNumber;
            lastReminderSent = decision.DueAt;
        }

        Assert.Equal(ReminderSchedule.DefaultMaxReminders, reminderCount);
    }

    [Fact]
    public void Ordinals_are_consecutive_so_the_deterministic_id_is_never_reused()
    {
        // The ordinal is half of uuidv5(namespace, invitationId:ordinal). If Evaluate ever
        // returned an ordinal it had already returned, the second notification would collide
        // with the first and be silently dropped.
        var seen = new List<int>();
        var reminderCount = 0;
        DateTimeOffset? lastReminderSent = null;

        for (var tick = Now; tick < Now.AddDays(60); tick = tick.AddHours(6))
        {
            var decision = ReminderSchedule.Evaluate(
                Due(sentAt: Now, lastReminderSent: lastReminderSent, reminderCount: reminderCount), tick);

            if (!decision.ShouldSend)
            {
                continue;
            }

            seen.Add(decision.ReminderNumber);
            reminderCount = decision.ReminderNumber;
            lastReminderSent = decision.DueAt;
        }

        Assert.Equal([1, 2, 3], seen);
        Assert.Equal(seen.Count, seen.Distinct().Count());
    }
}
