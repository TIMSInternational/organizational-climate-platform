using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyStatusesTests
{
    [Fact]
    public void Vocabulary_is_the_five_lifecycle_states()
    {
        Assert.Equal(
            ["draft", "scheduled", "active", "closed", "archived"],
            SurveyStatuses.All);
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("scheduled")]
    [InlineData("active")]
    [InlineData("closed")]
    [InlineData("archived")]
    public void Every_member_of_the_vocabulary_is_valid(string status)
        => Assert.True(SurveyStatuses.IsValid(status));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Draft")]
    [InlineData("published")]
    [InlineData("paused")]
    public void Anything_outside_the_vocabulary_is_rejected(string? status)
        => Assert.False(SurveyStatuses.IsValid(status));

    [Theory]
    [InlineData("draft", "scheduled")]
    [InlineData("draft", "active")]
    [InlineData("draft", "archived")]
    [InlineData("scheduled", "draft")]
    [InlineData("scheduled", "active")]
    [InlineData("scheduled", "closed")]
    [InlineData("scheduled", "archived")]
    [InlineData("active", "closed")]
    [InlineData("closed", "archived")]
    public void Legal_transitions_are_allowed(string from, string to)
        => Assert.True(SurveyStatuses.CanTransition(from, to));

    [Theory]
    // The rule the whole issue turns on: once responses can exist, content is frozen, so
    // there is no way back to the only status in which content is editable.
    [InlineData("active", "draft")]
    [InlineData("active", "scheduled")]
    [InlineData("closed", "draft")]
    [InlineData("closed", "active")]
    [InlineData("archived", "draft")]
    [InlineData("archived", "active")]
    [InlineData("archived", "closed")]
    // Skipping the collection phase entirely.
    [InlineData("draft", "closed")]
    public void Illegal_transitions_are_rejected(string from, string to)
        => Assert.False(SurveyStatuses.CanTransition(from, to));

    [Fact]
    public void A_transition_to_the_same_status_is_a_legal_no_op_so_retries_are_idempotent()
    {
        foreach (var status in SurveyStatuses.All)
        {
            Assert.True(SurveyStatuses.CanTransition(status, status));
        }
    }

    [Fact]
    public void Archived_is_terminal()
    {
        Assert.Empty(SurveyStatuses.AllowedTransitionsFrom("archived"));
        foreach (var target in SurveyStatuses.All.Where(s => s != "archived"))
        {
            Assert.False(SurveyStatuses.CanTransition("archived", target));
        }
    }

    [Fact]
    public void An_unknown_status_can_neither_be_left_nor_entered()
    {
        Assert.False(SurveyStatuses.CanTransition("draft", "published"));
        Assert.False(SurveyStatuses.CanTransition("published", "active"));
        Assert.Empty(SurveyStatuses.AllowedTransitionsFrom("published"));
    }

    [Fact]
    public void Every_reachable_status_is_itself_a_member_of_the_vocabulary()
    {
        // Guards the adjacency map against a typo that would strand a survey in a status
        // nothing else in the product knows how to render.
        foreach (var status in SurveyStatuses.All)
        {
            foreach (var target in SurveyStatuses.AllowedTransitionsFrom(status))
            {
                Assert.True(SurveyStatuses.IsValid(target), $"{status} -> {target}");
            }
        }
    }

    [Theory]
    [InlineData("draft", "scheduled", true)]
    [InlineData("draft", "active", true)]
    // Filing away an abandoned draft publishes nothing, so it must not be made to depend
    // on a complete set of translations -- otherwise the gate blocks cleanup instead of
    // protecting respondents.
    [InlineData("draft", "archived", false)]
    [InlineData("scheduled", "active", false)]
    [InlineData("active", "closed", false)]
    [InlineData("closed", "archived", false)]
    [InlineData("draft", "draft", false)]
    public void Publish_is_the_first_move_into_a_respondent_visible_status(string from, string to, bool expected)
        => Assert.Equal(expected, SurveyStatuses.IsPublish(from, to));

    [Fact]
    public void Publish_narrows_the_shared_gate_rather_than_replacing_it()
    {
        // Anything this class calls a publish must also be a publish transition by the
        // shared #195 predicate -- the survey rule is a subset, never a divergence. Held
        // over EVERY pair, not just the legal ones, so a future edge added to the
        // transition map cannot make the two silently disagree.
        foreach (var from in SurveyStatuses.All)
        {
            foreach (var to in SurveyStatuses.All)
            {
                if (SurveyStatuses.IsPublish(from, to))
                {
                    Assert.True(ContentPublishValidation.IsPublishTransition(from, to), $"{from} -> {to}");
                }
            }
        }
    }

    [Fact]
    public void Content_is_editable_in_draft_and_nowhere_else()
    {
        Assert.True(SurveyStatuses.AllowsContentEdit("draft"));
        foreach (var status in SurveyStatuses.All.Where(s => s != "draft"))
        {
            Assert.False(SurveyStatuses.AllowsContentEdit(status));
        }
    }

    [Theory]
    [InlineData("draft", true)]
    [InlineData("scheduled", true)]
    [InlineData("active", true)]
    [InlineData("closed", false)]
    [InlineData("archived", false)]
    public void The_response_window_stays_adjustable_until_the_survey_closes(string status, bool expected)
        => Assert.Equal(expected, SurveyStatuses.AllowsScheduleEdit(status));

    [Fact]
    public void Only_an_active_survey_accepts_responses()
    {
        Assert.True(SurveyStatuses.AcceptsResponses("active"));
        foreach (var status in SurveyStatuses.All.Where(s => s != "active"))
        {
            Assert.False(SurveyStatuses.AcceptsResponses(status));
        }
    }

    [Fact]
    public void A_status_that_accepts_responses_never_permits_a_content_edit()
    {
        // The invariant behind "a survey with responses cannot be edited in ways that
        // invalidate them", stated over the vocabulary rather than over one code path.
        foreach (var status in SurveyStatuses.All)
        {
            Assert.False(SurveyStatuses.AcceptsResponses(status) && SurveyStatuses.AllowsContentEdit(status), status);
        }
    }

    [Fact]
    public void No_status_that_can_hold_responses_leads_back_to_a_content_editable_one()
    {
        // Reachability, not just adjacency: 'active' and everything downstream of it must
        // have no path of any length back to 'draft'.
        var reachable = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Queue<string>();
        pending.Enqueue(SurveyStatuses.Active);
        while (pending.Count > 0)
        {
            foreach (var next in SurveyStatuses.AllowedTransitionsFrom(pending.Dequeue()))
            {
                if (reachable.Add(next))
                {
                    pending.Enqueue(next);
                }
            }
        }

        Assert.DoesNotContain(SurveyStatuses.Draft, reachable);
        Assert.All(reachable, status => Assert.False(SurveyStatuses.AllowsContentEdit(status)));
    }
}
