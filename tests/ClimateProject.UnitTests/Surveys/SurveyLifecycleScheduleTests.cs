using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The date-driven half of the survey lifecycle, without a database.
///
/// <para>Everything here is about a status transition on live customer data, so the tests that
/// matter most are the ones asserting that <b>nothing</b> happens: a draft whose start date
/// passed, a scheduled survey whose window elapsed, a closed survey with any dates at all. Each
/// of those is a row somebody would notice the job having touched, and none of them can be
/// caught by a test that only checks the happy path.</para>
/// </summary>
public class SurveyLifecycleScheduleTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset Past = Now.AddDays(-1);
    private static readonly DateTimeOffset Future = Now.AddDays(1);

    // -- the two transitions it may make -------------------------------------------------

    [Fact]
    public void A_scheduled_survey_whose_start_date_has_passed_opens()
        => Assert.Equal(
            SurveyStatuses.Active,
            SurveyLifecycleSchedule.NextStatusFor(SurveyStatuses.Scheduled, Past, Future, Now));

    [Fact]
    public void An_active_survey_whose_end_date_has_passed_closes()
        => Assert.Equal(
            SurveyStatuses.Closed,
            SurveyLifecycleSchedule.NextStatusFor(SurveyStatuses.Active, Now.AddDays(-2), Past, Now));

    [Fact]
    public void A_scheduled_survey_whose_start_date_is_still_ahead_waits()
        => Assert.Null(SurveyLifecycleSchedule.NextStatusFor(
            SurveyStatuses.Scheduled, Future, Future.AddDays(1), Now));

    [Fact]
    public void An_active_survey_inside_its_window_stays_open()
        => Assert.Null(SurveyLifecycleSchedule.NextStatusFor(SurveyStatuses.Active, Past, Future, Now));

    // -- the boundary, which the rest of the survey domain already fixed -------------------

    /// <summary>
    /// <c>start_date &lt;= now &lt; end_date</c>, copied from <c>SurveyDistributionEndpoints</c>.
    /// A survey is open at the instant its window opens and shut at the instant it ends -- the
    /// two ends are deliberately not symmetric, and an off-by-one here is a survey that accepts
    /// an answer after its deadline.
    /// </summary>
    [Fact]
    public void The_window_is_inclusive_at_the_start_and_exclusive_at_the_end()
    {
        Assert.Equal(
            SurveyStatuses.Active,
            SurveyLifecycleSchedule.NextStatusFor(SurveyStatuses.Scheduled, Now, Future, Now));

        Assert.Equal(
            SurveyStatuses.Closed,
            SurveyLifecycleSchedule.NextStatusFor(SurveyStatuses.Active, Past, Now, Now));
    }

    // -- the refusals --------------------------------------------------------------------

    /// <summary>
    /// The one the brief asks about directly. <c>draft -&gt; active</c> is a legal edge for a
    /// human going through the publish gate; a draft's start date is whatever the wizard
    /// defaulted, and there is no way back from <c>active</c>.
    /// </summary>
    [Theory]
    [InlineData(SurveyStatuses.Draft)]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public void No_date_moves_a_draft_a_closed_or_an_archived_survey(string status)
    {
        // Every arrangement of the two dates around "now", so this cannot pass by accident of
        // the fixture: before, straddling, after, and both boundaries exactly.
        (DateTimeOffset Start, DateTimeOffset End)[] windows =
        [
            (Now.AddDays(-10), Now.AddDays(-5)),
            (Past, Future),
            (Future, Future.AddDays(5)),
            (Now, Future),
            (Past, Now),
        ];

        foreach (var (start, end) in windows)
        {
            Assert.Null(SurveyLifecycleSchedule.NextStatusFor(status, start, end, Now));
        }
    }

    /// <summary>
    /// <c>scheduled -&gt; closed</c> IS in <see cref="SurveyStatuses"/>'s transition map and is
    /// still refused, because <c>scheduled</c> is the only status a mis-dated survey can be
    /// returned to draft and re-dated from. Closing it would tidy the row and destroy the
    /// remedy.
    /// </summary>
    [Fact]
    public void A_scheduled_survey_whose_whole_window_elapsed_is_never_closed()
    {
        Assert.Null(SurveyLifecycleSchedule.NextStatusFor(
            SurveyStatuses.Scheduled, Now.AddDays(-10), Past, Now));

        // And it is legal, which is the point: the refusal is a product decision, not the
        // transition map refusing on this job's behalf.
        Assert.True(SurveyStatuses.CanTransition(SurveyStatuses.Scheduled, SurveyStatuses.Closed));
    }

    [Fact]
    public void An_unknown_or_missing_status_moves_nowhere()
    {
        Assert.Null(SurveyLifecycleSchedule.NextStatusFor(null, Past, Future, Now));
        Assert.Null(SurveyLifecycleSchedule.NextStatusFor("published", Past, Future, Now));
        Assert.Null(SurveyLifecycleSchedule.NextStatusFor(string.Empty, Past, Future, Now));
    }

    // -- the invariant the job leans on ---------------------------------------------------

    /// <summary>
    /// Whatever this function ever returns must be a transition the domain already allows, and
    /// must never be <c>archived</c> or <c>draft</c>. Asserted over every status crossed with
    /// every arrangement of the window, so a future edit that adds a transition has to break
    /// this before it can reach a customer's database.
    /// </summary>
    [Fact]
    public void Every_transition_it_names_is_legal_and_is_never_to_draft_or_archived()
    {
        DateTimeOffset[] moments = [Now.AddDays(-10), Past, Now, Future, Now.AddDays(10)];
        var proposed = new List<(string From, string To)>();

        foreach (var status in SurveyStatuses.All)
        {
            foreach (var start in moments)
            {
                foreach (var end in moments)
                {
                    var target = SurveyLifecycleSchedule.NextStatusFor(status, start, end, Now);
                    if (target is null)
                    {
                        continue;
                    }

                    Assert.True(
                        SurveyStatuses.CanTransition(status, target),
                        $"'{status}' -> '{target}' is not a legal transition.");
                    Assert.NotEqual(SurveyStatuses.Draft, target);
                    Assert.NotEqual(SurveyStatuses.Archived, target);
                    Assert.NotEqual(status, target);

                    proposed.Add((status, target));
                }
            }
        }

        // Exactly two distinct transitions exist, and they are the two that were argued for.
        // Without this the loop above would still pass if the function stopped proposing
        // anything at all, which is the other way to be wrong.
        var expected = new List<(string From, string To)>
        {
            (SurveyStatuses.Active, SurveyStatuses.Closed),
            (SurveyStatuses.Scheduled, SurveyStatuses.Active),
        };

        Assert.Equal(expected, proposed.Distinct().OrderBy(t => t.From, StringComparer.Ordinal).ToList());
    }

    // -- the thing it will not fix, made visible -------------------------------------------

    [Fact]
    public void A_stranded_scheduled_survey_is_recognised_so_it_can_be_logged()
    {
        Assert.True(SurveyLifecycleSchedule.WindowElapsedWhileScheduled(SurveyStatuses.Scheduled, Past, Now));

        // The boundary matches the close rule: end_date == now is already over.
        Assert.True(SurveyLifecycleSchedule.WindowElapsedWhileScheduled(SurveyStatuses.Scheduled, Now, Now));

        Assert.False(SurveyLifecycleSchedule.WindowElapsedWhileScheduled(SurveyStatuses.Scheduled, Future, Now));

        // Only scheduled. An active survey past its end date is not stranded -- it is closed by
        // the next tick -- and reporting it as needing a human would bury the ones that do.
        foreach (var status in SurveyStatuses.All.Where(s => s != SurveyStatuses.Scheduled))
        {
            Assert.False(SurveyLifecycleSchedule.WindowElapsedWhileScheduled(status, Past, Now), status);
        }
    }
}
