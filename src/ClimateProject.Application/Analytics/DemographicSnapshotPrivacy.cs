using System.Text.Json;

namespace ClimateProject.Application.Analytics;

/// <summary>One value of one demographic field and how many people in the snapshot had it.</summary>
public sealed record DemographicDistributionBucket(string Value, int Count);

/// <summary>
/// A field's distribution after small-group suppression. <see cref="SuppressedGroupCount"/>
/// and <see cref="SuppressedPeopleCount"/> are reported rather than silently dropped so a
/// reader can tell the difference between "nobody is in another group" and "some groups
/// were withheld", and so counts still reconcile against
/// <c>metadata_total_users</c>.
/// </summary>
public sealed record DemographicDistribution(
    string Field,
    IReadOnlyList<DemographicDistributionBucket> Buckets,
    int SuppressedGroupCount,
    int SuppressedPeopleCount);

/// <summary>
/// Small-group disclosure control for snapshot aggregates.
///
/// **The decision #87 asked for, and its reasoning.**
///
/// There are two surfaces here and they need opposite answers.
///
/// 1. Snapshot *entries* are one row per person, keyed by <c>user_id</c>. They are
///    identifying by construction, and no threshold can change that. They are also only
///    ever readable by an admin of the owning company (or a SuperAdmin) -- exactly the
///    people who can already see that user's row in <c>/admin/users</c> with the same
///    demographics on it. Suppressing them would be theatre: it would remove nothing the
///    reader cannot get one endpoint over, while breaking the roster the snapshot exists
///    to preserve. So entries are returned unsuppressed, and access control -- not
///    aggregation -- is what protects them.
///
/// 2. Snapshot *distributions* are the disclosure surface, because aggregates are what
///    flow onward into dashboards, exports and benchmark comparisons, where the audience
///    is wider than the admin who read the snapshot. A bucket of one in
///    "tenure = 10+ years" tells a whole department who the single response belongs to.
///    Those are suppressed below <see cref="MinimumGroupSize"/>.
///
/// **Why 5 and not the 3 used by <c>Microclimate.ParticipationThreshold</c>.** That
/// threshold gates showing *aggregate sentiment* for one question across a whole audience,
/// where the only quasi-identifier is audience membership. These are demographic group
/// counts, and demographic quasi-identifiers combine: department x role x tenure narrows
/// a workforce far faster than any single one of them does, and a snapshot is explicitly
/// designed to be cross-referenced against the next one. A higher floor is the standard
/// answer for HR cross-tabs, and the two numbers being different is deliberate rather
/// than an oversight -- they are protecting different things.
/// </summary>
public static class DemographicSnapshotPrivacy
{
    public const int MinimumGroupSize = 5;

    /// <summary>
    /// Buckets <paramref name="values"/> by value, drops every bucket smaller than
    /// <see cref="MinimumGroupSize"/>, and reports how much was withheld. Blank values
    /// are ignored rather than bucketed as an empty group.
    /// </summary>
    public static DemographicDistribution Summarise(string field, IEnumerable<string?> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var value in values)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            counts[value] = counts.GetValueOrDefault(value) + 1;
        }

        var buckets = new List<DemographicDistributionBucket>();
        var suppressedGroups = 0;
        var suppressedPeople = 0;

        // Ordered by descending count then by value so the output is deterministic --
        // an export diffed between two runs must not churn on dictionary ordering.
        foreach (var (value, count) in counts.OrderByDescending(c => c.Value).ThenBy(c => c.Key, StringComparer.Ordinal))
        {
            if (count < MinimumGroupSize)
            {
                suppressedGroups++;
                suppressedPeople += count;
                continue;
            }

            buckets.Add(new DemographicDistributionBucket(value, count));
        }

        return new DemographicDistribution(field, buckets, suppressedGroups, suppressedPeople);
    }

    /// <summary>
    /// Summarises every field present across <paramref name="entries"/>, so a company's
    /// custom demographics are segmented exactly like the built-in ones (PRD section 2,
    /// "Reporting Integration: full demographic segmentation in analytics"). A field a
    /// person did not answer simply contributes nothing to that field's counts.
    /// </summary>
    public static IReadOnlyList<DemographicDistribution> SummariseAll(
        IReadOnlyList<IReadOnlyDictionary<string, string>> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);

        var fields = entries
            .SelectMany(e => e.Keys)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        return fields
            .Select(field => Summarise(
                field,
                entries.Select(e => e.TryGetValue(field, out var value) ? value : null)))
            .ToList();
    }

    /// <summary>
    /// The already-suppressed distribution as the <c>{"value": count}</c> jsonb shape the
    /// <c>metadata_roles_distribution</c> / <c>metadata_tenure_distribution</c> columns
    /// hold. Returns null for an empty distribution so the column stays NULL.
    /// </summary>
    public static string? ToJson(DemographicDistribution distribution)
    {
        ArgumentNullException.ThrowIfNull(distribution);

        if (distribution.Buckets.Count == 0)
        {
            return null;
        }

        return JsonSerializer.Serialize(
            distribution.Buckets.ToDictionary(b => b.Value, b => b.Count, StringComparer.Ordinal));
    }
}
