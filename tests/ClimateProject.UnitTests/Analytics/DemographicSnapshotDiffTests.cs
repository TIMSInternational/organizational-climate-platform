using ClimateProject.Application.Analytics;

namespace ClimateProject.UnitTests.Analytics;

public class DemographicSnapshotDiffTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bob = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Carol = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static SnapshotEntryValueSet Entry(Guid userId, params (string Field, string Value)[] values)
        => new(userId, values.ToDictionary(v => v.Field, v => v.Value, StringComparer.Ordinal));

    [Fact]
    public void Identical_snapshots_produce_no_changes()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("tenure", "1-2 years")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("tenure", "1-2 years")) };

        Assert.Empty(DemographicSnapshotDiff.Compute(prior, current));
    }

    [Fact]
    public void A_moved_person_produces_one_change_per_changed_field_with_json_scalars()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("role", "employee")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Engineering"), ("role", "employee")) };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Alice}.department", change.Field);
        Assert.Equal("\"Sales\"", change.OldValue);
        Assert.Equal("\"Engineering\"", change.NewValue);
    }

    [Fact]
    public void A_custom_demographic_is_diffed_exactly_like_a_built_in_one()
    {
        // req: every configured demographic must be filterable, not just the six the entry
        // table happens to have columns for.
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("work_mode", "onsite")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("work_mode", "remote")) };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Alice}.work_mode", change.Field);
        Assert.Equal("\"onsite\"", change.OldValue);
        Assert.Equal("\"remote\"", change.NewValue);
    }

    [Fact]
    public void A_newly_answered_field_has_a_null_old_value()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("level", "senior")) };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Alice}.level", change.Field);
        Assert.Null(change.OldValue);
        Assert.Equal("\"senior\"", change.NewValue);
    }

    [Fact]
    public void A_cleared_field_has_a_null_new_value()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales"), ("level", "senior")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales")) };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Alice}.level", change.Field);
        Assert.Equal("\"senior\"", change.OldValue);
        Assert.Null(change.NewValue);
    }

    [Fact]
    public void A_joiner_produces_only_a_membership_change()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales")) };
        var current = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Sales")),
            Entry(Bob, ("department", "Engineering"), ("role", "employee")),
        };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Bob}.{DemographicSnapshotDiff.MembershipField}", change.Field);
        Assert.Null(change.OldValue);
        Assert.Equal("\"present\"", change.NewValue);
    }

    [Fact]
    public void A_leaver_produces_only_a_membership_change()
    {
        var prior = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Sales")),
            Entry(Bob, ("department", "Engineering"), ("role", "employee")),
        };
        var current = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales")) };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));

        Assert.Equal($"{Bob}.{DemographicSnapshotDiff.MembershipField}", change.Field);
        Assert.Equal("\"present\"", change.OldValue);
        Assert.Null(change.NewValue);
    }

    [Fact]
    public void Joiners_leavers_and_movers_are_all_reported_in_one_pass()
    {
        var prior = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Sales")),
            Entry(Bob, ("department", "Engineering")),
        };
        var current = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Engineering")),
            Entry(Carol, ("department", "Support")),
        };

        var changes = DemographicSnapshotDiff.Compute(prior, current);

        Assert.Equal(3, changes.Count);
        Assert.Contains(changes, c => c.Field == $"{Alice}.department" && c.NewValue == "\"Engineering\"");
        Assert.Contains(changes, c => c.Field == $"{Bob}.{DemographicSnapshotDiff.MembershipField}" && c.NewValue is null);
        Assert.Contains(changes, c => c.Field == $"{Carol}.{DemographicSnapshotDiff.MembershipField}" && c.OldValue is null);
    }

    [Fact]
    public void An_empty_prior_snapshot_makes_every_person_a_joiner()
    {
        var current = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Sales")),
            Entry(Bob, ("department", "Engineering")),
        };

        var changes = DemographicSnapshotDiff.Compute([], current);

        Assert.Equal(2, changes.Count);
        Assert.All(changes, c => Assert.EndsWith($".{DemographicSnapshotDiff.MembershipField}", c.Field));
        Assert.All(changes, c => Assert.Null(c.OldValue));
    }

    [Fact]
    public void Output_ordering_is_deterministic()
    {
        var prior = new List<SnapshotEntryValueSet> { Entry(Bob, ("role", "employee"), ("department", "Sales")) };
        var current = new List<SnapshotEntryValueSet> { Entry(Bob, ("role", "leader"), ("department", "Support")) };

        var first = DemographicSnapshotDiff.Compute(prior, current);
        var second = DemographicSnapshotDiff.Compute(prior, current);

        Assert.Equal(first, second);
        Assert.Equal($"{Bob}.department", first[0].Field);
        Assert.Equal($"{Bob}.role", first[1].Field);
    }

    [Fact]
    public void Duplicate_user_rows_do_not_throw()
    {
        // demographic_snapshot_entries has no unique (snapshot_id, user_id) constraint, so a
        // read-side recompute has to survive a pair written before this endpoint existed.
        var prior = new List<SnapshotEntryValueSet> { Entry(Alice, ("department", "Sales")) };
        var current = new List<SnapshotEntryValueSet>
        {
            Entry(Alice, ("department", "Sales")),
            Entry(Alice, ("department", "Engineering")),
        };

        var change = Assert.Single(DemographicSnapshotDiff.Compute(prior, current));
        Assert.Equal("\"Engineering\"", change.NewValue);
    }

    [Theory]
    [InlineData("computed:v1", true)]
    [InlineData("computed:", true)]
    [InlineData("Department reassignment", false)]
    [InlineData(null, false)]
    public void Computed_reasons_are_recognised_by_prefix(string? reason, bool expected)
        => Assert.Equal(expected, DemographicSnapshotDiff.IsComputedReason(reason));

    [Fact]
    public void Computed_reason_records_the_version_it_was_diffed_against()
        => Assert.Equal("computed:v3", DemographicSnapshotDiff.ComputedReason(3));
}
