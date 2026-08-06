using ClimateProject.Application.Analytics;

namespace ClimateProject.UnitTests.Analytics;

public class DemographicSnapshotPrivacyTests
{
    private static IEnumerable<string?> Repeat(string value, int count) => Enumerable.Repeat<string?>(value, count);

    [Fact]
    public void A_group_at_the_threshold_is_reported()
    {
        var distribution = DemographicSnapshotPrivacy.Summarise(
            "department", Repeat("Sales", DemographicSnapshotPrivacy.MinimumGroupSize));

        var bucket = Assert.Single(distribution.Buckets);
        Assert.Equal("Sales", bucket.Value);
        Assert.Equal(DemographicSnapshotPrivacy.MinimumGroupSize, bucket.Count);
        Assert.Equal(0, distribution.SuppressedGroupCount);
    }

    [Fact]
    public void A_group_one_below_the_threshold_is_suppressed_and_counted()
    {
        var distribution = DemographicSnapshotPrivacy.Summarise(
            "department", Repeat("Sales", DemographicSnapshotPrivacy.MinimumGroupSize - 1));

        Assert.Empty(distribution.Buckets);
        Assert.Equal(1, distribution.SuppressedGroupCount);
        Assert.Equal(DemographicSnapshotPrivacy.MinimumGroupSize - 1, distribution.SuppressedPeopleCount);
    }

    [Fact]
    public void A_group_of_one_never_reaches_the_output()
    {
        // The disclosure #87 asked about: one person in a tenure band is that person.
        var distribution = DemographicSnapshotPrivacy.Summarise(
            "tenure", [.. Repeat("1-2 years", 9), "10+ years"]);

        Assert.Equal(["1-2 years"], distribution.Buckets.Select(b => b.Value));
        Assert.DoesNotContain(distribution.Buckets, b => b.Value == "10+ years");
        Assert.Equal(1, distribution.SuppressedPeopleCount);
    }

    [Fact]
    public void Suppressed_and_reported_counts_reconcile_against_the_population()
    {
        List<string?> values = [.. Repeat("Sales", 6), .. Repeat("Support", 5), .. Repeat("Legal", 2), "Facilities"];

        var distribution = DemographicSnapshotPrivacy.Summarise("department", values);

        var reported = distribution.Buckets.Sum(b => b.Count);
        Assert.Equal(values.Count, reported + distribution.SuppressedPeopleCount);
        Assert.Equal(2, distribution.SuppressedGroupCount);
    }

    [Fact]
    public void Blank_values_are_ignored_rather_than_bucketed_as_an_empty_group()
    {
        List<string?> values = [.. Repeat("Sales", 5), null, "", "   "];

        var distribution = DemographicSnapshotPrivacy.Summarise("department", values);

        var bucket = Assert.Single(distribution.Buckets);
        Assert.Equal(5, bucket.Count);
        Assert.Equal(0, distribution.SuppressedGroupCount);
    }

    [Fact]
    public void Buckets_are_ordered_by_descending_count_then_value()
    {
        List<string?> values = [.. Repeat("Support", 5), .. Repeat("Sales", 7), .. Repeat("Ops", 5)];

        var distribution = DemographicSnapshotPrivacy.Summarise("department", values);

        Assert.Equal(["Sales", "Ops", "Support"], distribution.Buckets.Select(b => b.Value));
    }

    [Fact]
    public void SummariseAll_covers_custom_fields_and_applies_the_same_threshold()
    {
        var entries = Enumerable.Range(0, 6)
            .Select(i => (IReadOnlyDictionary<string, string>)new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["department"] = "Sales",
                ["work_mode"] = i == 0 ? "onsite" : "remote",
            })
            .ToList();

        var distributions = DemographicSnapshotPrivacy.SummariseAll(entries);

        Assert.Equal(["department", "work_mode"], distributions.Select(d => d.Field));
        var workMode = distributions.Single(d => d.Field == "work_mode");
        Assert.Equal(["remote"], workMode.Buckets.Select(b => b.Value));
        Assert.Equal(1, workMode.SuppressedPeopleCount);
    }

    [Fact]
    public void A_field_only_some_people_answered_counts_only_those_people()
    {
        List<IReadOnlyDictionary<string, string>> entries =
        [
            .. Enumerable.Range(0, 5).Select(_ => (IReadOnlyDictionary<string, string>)new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["department"] = "Sales",
                ["level"] = "senior",
            }),
            new Dictionary<string, string>(StringComparer.Ordinal) { ["department"] = "Sales" },
        ];

        var distributions = DemographicSnapshotPrivacy.SummariseAll(entries);

        Assert.Equal(6, distributions.Single(d => d.Field == "department").Buckets.Single().Count);
        Assert.Equal(5, distributions.Single(d => d.Field == "level").Buckets.Single().Count);
    }

    [Fact]
    public void ToJson_emits_the_suppressed_shape_only()
    {
        var distribution = DemographicSnapshotPrivacy.Summarise("role", [.. Repeat("employee", 5), "leader"]);

        var json = DemographicSnapshotPrivacy.ToJson(distribution);

        Assert.Equal("{\"employee\":5}", json);
        Assert.DoesNotContain("leader", json);
    }

    [Fact]
    public void ToJson_returns_null_when_everything_was_suppressed()
    {
        var distribution = DemographicSnapshotPrivacy.Summarise("role", ["leader", "employee"]);

        Assert.Null(DemographicSnapshotPrivacy.ToJson(distribution));
    }

    [Fact]
    public void The_threshold_is_higher_than_the_microclimate_participation_floor()
    {
        // Deliberate: demographic quasi-identifiers combine (department x role x tenure),
        // so the floor for group counts is higher than the floor for a single aggregate
        // sentiment reading. See the type's doc comment.
        Assert.True(DemographicSnapshotPrivacy.MinimumGroupSize > 3);
    }
}
