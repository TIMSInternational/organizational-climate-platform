using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// The ladder and the anonymity ceiling (#130).
///
/// <para>
/// Every assertion here is about a decision, not about a database, which is why the class
/// lives in Application and is tested without Docker. The integration suite asserts the
/// consequence -- that the columns are actually NULL -- and that is the assertion that would
/// catch an endpoint deciding correctly and writing anyway. Both are needed; neither replaces
/// the other.
/// </para>
/// </summary>
public class MicroclimateInvitationStatusesTests
{
    // ------------------------------------------------------------------
    // The anonymity boundary
    // ------------------------------------------------------------------

    /// <summary>
    /// The whole guarantee, as the endpoint asks it. Stated over the full cross product so a
    /// ceiling moved in either direction fails here rather than in one hand-picked case.
    /// </summary>
    [Theory]
    // Anonymous: everything up to and including `opened`, nothing after.
    [InlineData(MicroclimateInvitationStatuses.Pending, true, true)]
    [InlineData(MicroclimateInvitationStatuses.Sent, true, true)]
    [InlineData(MicroclimateInvitationStatuses.Opened, true, true)]
    [InlineData(MicroclimateInvitationStatuses.Started, true, false)]
    [InlineData(MicroclimateInvitationStatuses.Completed, true, false)]
    // Not anonymous: the whole ladder.
    [InlineData(MicroclimateInvitationStatuses.Pending, false, true)]
    [InlineData(MicroclimateInvitationStatuses.Sent, false, true)]
    [InlineData(MicroclimateInvitationStatuses.Opened, false, true)]
    [InlineData(MicroclimateInvitationStatuses.Started, false, true)]
    [InlineData(MicroclimateInvitationStatuses.Completed, false, true)]
    // Off the ladder either way. `revoked` is a decision, not a rung.
    [InlineData(MicroclimateInvitationStatuses.Revoked, true, false)]
    [InlineData(MicroclimateInvitationStatuses.Revoked, false, false)]
    [InlineData("participated", true, false)]
    [InlineData("participated", false, false)]
    public void IsRecordable_stops_an_anonymous_session_at_the_ceiling(string target, bool anonymous, bool expected)
        => Assert.Equal(expected, MicroclimateInvitationStatuses.IsRecordable(target, anonymous));

    [Fact]
    public void The_anonymity_ceiling_is_opened()
    {
        // Named explicitly rather than only through IsRecordable: this constant is what the
        // decision document promises and what the payload publishes, so moving it must break
        // a test that says the word.
        Assert.Equal(MicroclimateInvitationStatuses.Opened, MicroclimateInvitationStatuses.AnonymityCeiling);
        Assert.Equal(
            MicroclimateInvitationStatuses.Opened,
            MicroclimateInvitationStatuses.HighestRecordableState(anonymous: true));
        Assert.Equal(
            MicroclimateInvitationStatuses.Completed,
            MicroclimateInvitationStatuses.HighestRecordableState(anonymous: false));
    }

    /// <summary>
    /// The suppressed list is derived, not restated -- so it cannot disagree with the ceiling
    /// it is supposed to describe. Asserted by content AND by the derivation, because a
    /// hard-coded array with the same two members would pass the first half alone.
    /// </summary>
    [Fact]
    public void The_suppressed_states_are_exactly_the_rungs_above_the_ceiling()
    {
        Assert.Equal(
            [MicroclimateInvitationStatuses.Started, MicroclimateInvitationStatuses.Completed],
            MicroclimateInvitationStatuses.SuppressedWhenAnonymous);

        Assert.All(
            MicroclimateInvitationStatuses.SuppressedWhenAnonymous,
            state => Assert.False(MicroclimateInvitationStatuses.IsRecordable(state, anonymous: true)));

        Assert.All(
            MicroclimateInvitationStatuses.Progression.Except(MicroclimateInvitationStatuses.SuppressedWhenAnonymous),
            state => Assert.True(MicroclimateInvitationStatuses.IsRecordable(state, anonymous: true)));
    }

    // ------------------------------------------------------------------
    // Monotonicity
    // ------------------------------------------------------------------

    /// <summary>
    /// Strictly forward. The two cases that matter operationally are the replay (a mail
    /// client's link prefetcher fetching the invitation twice) and the out-of-order arrival
    /// (an <c>opened</c> ping landing after <c>started</c> because the first request was
    /// retried).
    /// </summary>
    [Theory]
    [InlineData(MicroclimateInvitationStatuses.Sent, MicroclimateInvitationStatuses.Opened, true)]
    [InlineData(MicroclimateInvitationStatuses.Opened, MicroclimateInvitationStatuses.Started, true)]
    [InlineData(MicroclimateInvitationStatuses.Started, MicroclimateInvitationStatuses.Completed, true)]
    [InlineData(MicroclimateInvitationStatuses.Pending, MicroclimateInvitationStatuses.Completed, true)]
    // The replay.
    [InlineData(MicroclimateInvitationStatuses.Opened, MicroclimateInvitationStatuses.Opened, false)]
    // The out-of-order arrival.
    [InlineData(MicroclimateInvitationStatuses.Started, MicroclimateInvitationStatuses.Opened, false)]
    [InlineData(MicroclimateInvitationStatuses.Completed, MicroclimateInvitationStatuses.Started, false)]
    // Revoked is terminal on both sides.
    [InlineData(MicroclimateInvitationStatuses.Revoked, MicroclimateInvitationStatuses.Opened, false)]
    [InlineData(MicroclimateInvitationStatuses.Opened, MicroclimateInvitationStatuses.Revoked, false)]
    // Off the ladder entirely -- including the legacy verb, which is a ROUTE and never a
    // stored status. A row reading "participated" would be invisible to every count.
    [InlineData(MicroclimateInvitationStatuses.Opened, "participated", false)]
    [InlineData(MicroclimateInvitationStatuses.Opened, "nonsense", false)]
    public void Advances_is_strictly_monotonic(string current, string target, bool expected)
        => Assert.Equal(expected, MicroclimateInvitationStatuses.Advances(current, target));

    // ------------------------------------------------------------------
    // Vocabulary
    // ------------------------------------------------------------------

    [Fact]
    public void The_vocabulary_is_the_progression_plus_revoked_and_nothing_else()
    {
        Assert.Equal(
            ["pending", "sent", "opened", "started", "completed"],
            MicroclimateInvitationStatuses.Progression);

        Assert.Equal(
            ["pending", "sent", "opened", "started", "completed", "revoked"],
            MicroclimateInvitationStatuses.All);

        // The legacy route verb is deliberately NOT a member. It maps onto `completed` at the
        // route, and a row that stored it would be counted by nothing.
        Assert.False(MicroclimateInvitationStatuses.IsValid("participated"));
        Assert.False(MicroclimateInvitationStatuses.IsValid(null));
        Assert.False(MicroclimateInvitationStatuses.IsValid("expired"));
    }

    /// <summary>
    /// Every stored status fits the column. <c>microclimate_invitations.status</c> is
    /// <c>varchar(20)</c>, so a vocabulary member longer than that is a runtime failure on
    /// the one write that matters and on no test that does not check.
    /// </summary>
    [Fact]
    public void Every_status_fits_the_column()
        => Assert.All(MicroclimateInvitationStatuses.All, status => Assert.InRange(status.Length, 1, 20));

    // ------------------------------------------------------------------
    // The relationship to the survey ladder
    // ------------------------------------------------------------------

    /// <summary>
    /// #130 is explicitly the reference shape for #116, and the web client reads both. So the
    /// two vocabularies agreeing is a product property, not a coincidence -- but they are
    /// separate classes over separate tables, and nothing in the compiler holds them together.
    /// This is the thing that does.
    /// </summary>
    [Fact]
    public void The_two_invitation_ladders_use_the_same_words()
    {
        Assert.Equal(SurveyInvitationStatuses.Progression, MicroclimateInvitationStatuses.Progression);
        Assert.Equal(SurveyInvitationStatuses.All, MicroclimateInvitationStatuses.All);
        Assert.Equal(SurveyInvitationStatuses.AnonymityCeiling, MicroclimateInvitationStatuses.AnonymityCeiling);
    }
}
