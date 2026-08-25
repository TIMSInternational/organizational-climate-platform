using ClimateProject.Application.Microclimates;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// The date-driven half of the microclimate lifecycle, without a database.
///
/// <para>One transition exists, so almost everything here asserts that <b>nothing</b> happens.
/// That is the right proportion: a microclimate's <c>closed</c> is terminal -- no outgoing edges
/// at all -- so a session this rule closes by mistake cannot be reopened, re-dated or returned
/// to draft by anybody, and a draft it opened by mistake would be showing half-translated
/// content to respondents with no way back either.</para>
/// </summary>
public class MicroclimateLifecycleScheduleTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 24, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset Past = Now.AddDays(-1);
    private static readonly DateTimeOffset Future = Now.AddDays(1);

    // -- the one transition it may make ---------------------------------------------------

    [Fact]
    public void An_active_microclimate_whose_end_time_has_passed_closes()
        => Assert.Equal(
            MicroclimateStatuses.Closed,
            MicroclimateLifecycleSchedule.NextStatusFor(MicroclimateStatuses.Active, Now.AddDays(-2), Past, Now));

    [Fact]
    public void An_active_microclimate_inside_its_window_stays_open()
        => Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(
            MicroclimateStatuses.Active, Past, Future, Now));

    /// <summary>
    /// An active session is open whatever its start time says, because a human activated it.
    /// A microclimate activated ahead of its own start time is a legitimate thing an admin does
    /// -- <c>POST /microclimates/{id}/activate</c> asks the schedule nothing -- and closing it
    /// here would shut a session that is collecting answers right now.
    /// </summary>
    [Fact]
    public void An_active_microclimate_whose_start_time_is_still_ahead_is_left_open()
        => Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(
            MicroclimateStatuses.Active, Future, Future.AddDays(1), Now));

    // -- the boundary ---------------------------------------------------------------------

    /// <summary>
    /// <c>EndTime &lt;= now</c> is over. The same comparison <c>InvitationReminderJob</c> makes
    /// in the opposite direction when it stops nagging respondents
    /// (<c>Scheduling.EndTime &gt; nowUtc</c>), which is the inconsistency this closes: the
    /// product stopped inviting people to a session it was still collecting into. An off-by-one
    /// here is an answer accepted after the deadline, and a microclimate cannot unpick one.
    /// </summary>
    [Fact]
    public void The_window_ends_at_the_instant_the_end_time_arrives()
    {
        Assert.Equal(
            MicroclimateStatuses.Closed,
            MicroclimateLifecycleSchedule.NextStatusFor(MicroclimateStatuses.Active, Past, Now, Now));

        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(
            MicroclimateStatuses.Active, Past, Now.AddTicks(1), Now));
    }

    // -- the refusals ---------------------------------------------------------------------

    /// <summary>
    /// The decision this issue turned on. <c>draft -&gt; active</c> is a legal edge in
    /// <see cref="MicroclimateStatuses"/> and the survey job makes the equivalent move -- but out
    /// of <c>scheduled</c>, a status this vocabulary does not have. A microclimate's <c>draft</c>
    /// means "still being authored", publishing runs the #195 translation gate inside the
    /// endpoint, and <c>active -&gt; draft</c> does not exist, so a draft opened on a timer is
    /// half-translated content in front of respondents that nobody can pull back.
    /// </summary>
    [Fact]
    public void No_date_ever_opens_a_draft()
    {
        // Every arrangement of the two dates around "now", so this cannot pass by accident of
        // the fixture: before, straddling, after, and both boundaries exactly.
        foreach (var (start, end) in Windows)
        {
            Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(MicroclimateStatuses.Draft, start, end, Now));
        }

        // And it is legal, which is the point: the refusal is a product decision, not the
        // transition map refusing on this rule's behalf. The day a `scheduled` status is added
        // to the vocabulary, this is the assertion that has to be argued with.
        Assert.True(MicroclimateStatuses.CanTransition(MicroclimateStatuses.Draft, MicroclimateStatuses.Active));
    }

    /// <summary>
    /// <c>draft -&gt; closed</c> is legal too -- it is how an abandoned draft is filed away --
    /// and it is equally refused here. Filing a draft away is an editorial act; no date on a
    /// microclimate carries the meaning "throw this out", and doing it on a timer would move a
    /// company admin's working set into a terminal status with no undo.
    /// </summary>
    [Fact]
    public void No_date_ever_closes_a_draft_either()
    {
        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(
            MicroclimateStatuses.Draft, Now.AddDays(-10), Past, Now));

        Assert.True(MicroclimateStatuses.CanTransition(MicroclimateStatuses.Draft, MicroclimateStatuses.Closed));
    }

    [Fact]
    public void A_closed_microclimate_is_never_touched_whatever_its_dates_say()
    {
        foreach (var (start, end) in Windows)
        {
            Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(MicroclimateStatuses.Closed, start, end, Now));
        }
    }

    [Fact]
    public void An_unknown_or_missing_status_moves_nowhere()
    {
        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(null, Past, Future, Now));
        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor("scheduled", Past, Future, Now));
        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor("archived", Past, Future, Now));
        Assert.Null(MicroclimateLifecycleSchedule.NextStatusFor(string.Empty, Past, Future, Now));
    }

    // -- the invariant the job leans on ---------------------------------------------------

    /// <summary>
    /// Whatever this function ever returns must be a transition the domain already allows, and
    /// must never be <c>draft</c> or <c>active</c>. Asserted over every status crossed with every
    /// arrangement of the window, so a future edit that adds a transition has to break this
    /// before it can reach a customer's database.
    /// </summary>
    [Fact]
    public void Every_transition_it_names_is_legal_and_is_never_to_draft_or_active()
    {
        DateTimeOffset[] moments = [Now.AddDays(-10), Past, Now, Future, Now.AddDays(10)];
        var proposed = new List<(string From, string To)>();

        foreach (var status in MicroclimateStatuses.All)
        {
            foreach (var start in moments)
            {
                foreach (var end in moments)
                {
                    var target = MicroclimateLifecycleSchedule.NextStatusFor(status, start, end, Now);
                    if (target is null)
                    {
                        continue;
                    }

                    Assert.True(
                        MicroclimateStatuses.CanTransition(status, target),
                        $"'{status}' -> '{target}' is not a legal transition.");
                    Assert.NotEqual(MicroclimateStatuses.Draft, target);
                    Assert.NotEqual(MicroclimateStatuses.Active, target);
                    Assert.NotEqual(status, target);

                    proposed.Add((status, target));
                }
            }
        }

        // Exactly one distinct transition exists, and it is the one that was argued for. Without
        // this the loop above would still pass if the function stopped proposing anything at all,
        // which is the other way to be wrong -- and the way that would leave the defect in place
        // with a green suite.
        Assert.Equal(
            [(MicroclimateStatuses.Active, MicroclimateStatuses.Closed)],
            proposed.Distinct().ToList());
    }

    /// <summary>
    /// The rule closes a session that is accepting responses and nothing else. Asserted through
    /// <see cref="MicroclimateStatuses.AcceptsResponses"/> -- the predicate
    /// <c>SubmitResponseAsync</c> actually reads -- rather than through the status string,
    /// because "the status moved" is not the thing anybody wanted.
    /// </summary>
    [Fact]
    public void The_only_status_it_moves_out_of_is_the_one_that_accepts_responses()
    {
        foreach (var status in MicroclimateStatuses.All)
        {
            var moved = MicroclimateLifecycleSchedule.NextStatusFor(status, Now.AddDays(-2), Past, Now) is not null;
            Assert.Equal(MicroclimateStatuses.AcceptsResponses(status), moved);
        }

        // And what it moves to does not accept responses, which is the whole product effect.
        Assert.False(MicroclimateStatuses.AcceptsResponses(MicroclimateLifecycleSchedule.NextStatusFor(
            MicroclimateStatuses.Active, Now.AddDays(-2), Past, Now)));
    }

    // -- the half it will not fix, made visible ---------------------------------------------

    /// <summary>
    /// Activation stays manual, so a microclimate whose whole window elapsed in <c>draft</c> is a
    /// session that was scheduled and never ran. Nothing else in the product says so, which is
    /// why the job logs it.
    /// </summary>
    [Fact]
    public void A_stranded_draft_is_recognised_so_it_can_be_logged()
    {
        Assert.True(MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(MicroclimateStatuses.Draft, Past, Now));

        // The boundary matches the close rule: EndTime == now is already over.
        Assert.True(MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(MicroclimateStatuses.Draft, Now, Now));

        Assert.False(MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(MicroclimateStatuses.Draft, Future, Now));

        // Only draft. An active microclimate past its end time is not stranded -- it is closed by
        // this very tick -- and a closed one is finished. Reporting either as needing a human
        // would bury the ones that do.
        foreach (var status in MicroclimateStatuses.All.Where(s => s != MicroclimateStatuses.Draft))
        {
            Assert.False(MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(status, Past, Now), status);
        }
    }

    /// <summary>
    /// Stranded and transitioning are disjoint, at every arrangement of the window. Not a
    /// coincidence of ordering in the job: a row that was both would be reported as needing a
    /// human in the same sweep that moved it, and an operator would chase a session that had
    /// already been dealt with.
    /// </summary>
    [Fact]
    public void A_microclimate_is_never_both_stranded_and_due_a_transition()
    {
        foreach (var status in MicroclimateStatuses.All)
        {
            foreach (var (start, end) in Windows)
            {
                var moves = MicroclimateLifecycleSchedule.NextStatusFor(status, start, end, Now) is not null;
                var stranded = MicroclimateLifecycleSchedule.WindowElapsedWhileDraft(status, end, Now);

                Assert.False(moves && stranded, $"'{status}' with end {end:O} is both.");
            }
        }
    }

    private static (DateTimeOffset Start, DateTimeOffset End)[] Windows =>
    [
        (Now.AddDays(-10), Now.AddDays(-5)),
        (Past, Future),
        (Future, Future.AddDays(5)),
        (Now, Future),
        (Past, Now),
    ];
}
