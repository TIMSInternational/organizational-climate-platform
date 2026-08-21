using ClimateProject.Application.Microclimates;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// The transition map. Every absence in <see cref="MicroclimateStatuses"/> is a rule someone
/// could reasonably think convenient to add, so each one is asserted rather than left to the
/// map's shape.
/// </summary>
public class MicroclimateStatusesTests
{
    [Theory]
    [InlineData("draft", "active")]
    [InlineData("draft", "closed")]
    [InlineData("active", "closed")]
    public void Legal_transitions_are_allowed(string from, string to)
        => Assert.True(MicroclimateStatuses.CanTransition(from, to));

    [Fact]
    public void An_active_microclimate_cannot_return_to_draft()
    {
        // The freeze. Answers are counted into ResponseCount and the word cloud as they
        // arrive with no per-response row to recount from, so content that becomes editable
        // again cannot be reconciled against the aggregate it already contributed to.
        Assert.False(MicroclimateStatuses.CanTransition("active", "draft"));
    }

    [Fact]
    public void A_closed_microclimate_cannot_be_reopened()
        => Assert.False(MicroclimateStatuses.CanTransition("closed", "active"));

    [Fact]
    public void A_closed_microclimate_cannot_return_to_draft()
        => Assert.False(MicroclimateStatuses.CanTransition("closed", "draft"));

    [Fact]
    public void Closed_is_terminal()
        => Assert.Empty(MicroclimateStatuses.AllowedTransitionsFrom("closed"));

    [Theory]
    [InlineData("draft")]
    [InlineData("active")]
    [InlineData("closed")]
    public void A_no_op_transition_is_legal_so_a_retry_is_idempotent(string status)
        => Assert.True(MicroclimateStatuses.CanTransition(status, status));

    [Theory]
    [InlineData("archived")]
    [InlineData("scheduled")]
    [InlineData("")]
    [InlineData(null)]
    public void Statuses_outside_the_vocabulary_are_rejected(string? status)
    {
        Assert.False(MicroclimateStatuses.IsValid(status));
        Assert.False(MicroclimateStatuses.CanTransition("draft", status));
        Assert.False(MicroclimateStatuses.CanTransition(status, "active"));
    }

    [Fact]
    public void Publishing_is_draft_to_active_only()
    {
        Assert.True(MicroclimateStatuses.IsPublish("draft", "active"));

        // Not a publish: throwing an abandoned draft away puts nothing in front of anyone,
        // so demanding a complete set of translations to do it would block cleanup.
        Assert.False(MicroclimateStatuses.IsPublish("draft", "closed"));
        Assert.False(MicroclimateStatuses.IsPublish("active", "closed"));
        Assert.False(MicroclimateStatuses.IsPublish("draft", "draft"));
    }

    [Fact]
    public void Only_an_active_microclimate_accepts_responses()
    {
        Assert.True(MicroclimateStatuses.AcceptsResponses("active"));
        Assert.False(MicroclimateStatuses.AcceptsResponses("draft"));
        Assert.False(MicroclimateStatuses.AcceptsResponses("closed"));
    }

    [Fact]
    public void The_validation_vocabulary_is_bound_to_the_status_class_not_copied()
    {
        // Two lists that must agree is how the old literal drifted. Binding is the fix, so
        // the binding itself is what is asserted.
        Assert.Same(MicroclimateStatuses.All, MicroclimateValidation.ValidStatuses);
    }
}
