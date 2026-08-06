using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The invitation ladder, and the anonymity boundary that is the whole reason this class was
/// pulled out of the endpoint.
///
/// The anonymity rule is the one here most expensive to get wrong and the one whose failure
/// is invisible from the outside: an anonymous survey that quietly records
/// <c>started_at</c>/<c>completed_at</c> looks perfectly healthy, passes every end-to-end
/// test, and only reveals itself when someone joins those timestamps against
/// <c>responses</c>. So it is asserted here, without Docker, rather than left to an
/// integration run.
/// </summary>
public class SurveyInvitationStatusesTests
{
    [Fact]
    public void The_ladder_is_ordered_and_revoked_sits_off_it()
    {
        Assert.Equal(
            [
                SurveyInvitationStatuses.Pending,
                SurveyInvitationStatuses.Sent,
                SurveyInvitationStatuses.Opened,
                SurveyInvitationStatuses.Started,
                SurveyInvitationStatuses.Completed,
            ],
            SurveyInvitationStatuses.Progression);

        Assert.DoesNotContain(SurveyInvitationStatuses.Revoked, SurveyInvitationStatuses.Progression);
        Assert.Contains(SurveyInvitationStatuses.Revoked, SurveyInvitationStatuses.All);
        Assert.Equal(-1, SurveyInvitationStatuses.RankOf(SurveyInvitationStatuses.Revoked));
    }

    [Fact]
    public void Every_status_fits_the_twenty_character_column()
    {
        // survey_invitations.status is character varying(20). A vocabulary member that does
        // not fit is a runtime insert failure, not a compile error.
        Assert.All(SurveyInvitationStatuses.All, status => Assert.True(status.Length <= 20, status));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("bogus", false)]
    [InlineData("pending", true)]
    [InlineData("completed", true)]
    [InlineData("revoked", true)]
    public void IsValid_accepts_only_the_vocabulary(string? status, bool expected)
        => Assert.Equal(expected, SurveyInvitationStatuses.IsValid(status));

    // ------------------------------------------------------------------
    // Monotonicity
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("pending", "sent")]
    [InlineData("pending", "completed")]
    [InlineData("sent", "opened")]
    [InlineData("opened", "started")]
    [InlineData("started", "completed")]
    public void A_later_state_advances(string from, string to)
        => Assert.True(SurveyInvitationStatuses.Advances(from, to));

    [Theory]
    [InlineData("opened", "opened")]
    [InlineData("started", "opened")]
    [InlineData("completed", "started")]
    [InlineData("completed", "completed")]
    public void A_repeated_or_backwards_state_does_not_advance(string from, string to)
        => Assert.False(SurveyInvitationStatuses.Advances(from, to));

    [Fact]
    public void A_revoked_invitation_never_advances_again()
    {
        foreach (var target in SurveyInvitationStatuses.Progression)
        {
            Assert.False(SurveyInvitationStatuses.Advances(SurveyInvitationStatuses.Revoked, target));
        }
    }

    [Fact]
    public void Revoking_is_not_progress_from_anywhere()
    {
        // Revocation is a decision, not a rung. It is applied directly by the admin route,
        // never reached by an invitee walking the ladder.
        foreach (var from in SurveyInvitationStatuses.Progression)
        {
            Assert.False(SurveyInvitationStatuses.Advances(from, SurveyInvitationStatuses.Revoked));
        }
    }

    [Fact]
    public void An_unknown_target_advances_nothing()
    {
        Assert.False(SurveyInvitationStatuses.Advances(SurveyInvitationStatuses.Pending, "finished"));
        Assert.False(SurveyInvitationStatuses.Advances(SurveyInvitationStatuses.Pending, null));
    }

    // ------------------------------------------------------------------
    // The anonymity boundary
    // ------------------------------------------------------------------

    [Fact]
    public void An_anonymous_survey_stops_recording_at_opened()
    {
        Assert.Equal(SurveyInvitationStatuses.Opened, SurveyInvitationStatuses.AnonymityCeiling);
        Assert.Equal(SurveyInvitationStatuses.Opened, SurveyInvitationStatuses.HighestRecordableState(anonymous: true));
    }

    [Fact]
    public void A_named_survey_records_the_whole_ladder()
        => Assert.Equal(SurveyInvitationStatuses.Completed, SurveyInvitationStatuses.HighestRecordableState(anonymous: false));

    [Fact]
    public void Started_and_completed_are_the_states_an_anonymous_survey_suppresses()
    {
        // These two are exactly the states whose existence asserts a response row exists, and
        // which therefore join against responses.start_time / completion_time on time.
        Assert.Equal(
            [SurveyInvitationStatuses.Started, SurveyInvitationStatuses.Completed],
            SurveyInvitationStatuses.SuppressedWhenAnonymous);
    }

    [Fact]
    public void The_suppressed_set_is_derived_from_the_ceiling_rather_than_restated()
    {
        // Guards the property the field's own comment claims: everything above the ceiling is
        // suppressed and everything at or below it is not, with no second hand-written list
        // that could disagree.
        foreach (var state in SurveyInvitationStatuses.Progression)
        {
            var above = SurveyInvitationStatuses.RankOf(state)
                        > SurveyInvitationStatuses.RankOf(SurveyInvitationStatuses.AnonymityCeiling);
            Assert.Equal(above, SurveyInvitationStatuses.SuppressedWhenAnonymous.Contains(state));
        }
    }

    [Theory]
    [InlineData("pending", true)]
    [InlineData("sent", true)]
    [InlineData("opened", true)]
    [InlineData("started", false)]
    [InlineData("completed", false)]
    public void IsRecordable_refuses_post_ceiling_states_for_an_anonymous_survey(string state, bool expected)
        => Assert.Equal(expected, SurveyInvitationStatuses.IsRecordable(state, anonymous: true));

    [Fact]
    public void IsRecordable_allows_the_whole_ladder_for_a_named_survey()
    {
        foreach (var state in SurveyInvitationStatuses.Progression)
        {
            Assert.True(SurveyInvitationStatuses.IsRecordable(state, anonymous: false), state);
        }
    }

    [Fact]
    public void Nothing_off_the_ladder_is_recordable_either_way()
    {
        foreach (var anonymous in new[] { true, false })
        {
            Assert.False(SurveyInvitationStatuses.IsRecordable(SurveyInvitationStatuses.Revoked, anonymous));
            Assert.False(SurveyInvitationStatuses.IsRecordable("finished", anonymous));
            Assert.False(SurveyInvitationStatuses.IsRecordable(null, anonymous));
        }
    }
}
