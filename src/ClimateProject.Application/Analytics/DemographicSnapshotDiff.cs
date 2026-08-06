using System.Text.Json;

namespace ClimateProject.Application.Analytics;

/// <summary>One person's flattened demographics within a snapshot, as <see cref="SnapshotEntryValues.Flatten"/> produces them.</summary>
public sealed record SnapshotEntryValueSet(Guid UserId, IReadOnlyDictionary<string, string> Values);

/// <summary>
/// One computed difference. <see cref="OldValue"/> / <see cref="NewValue"/> are JSON
/// scalars, not bare text, because they land in the jsonb
/// <c>old_value</c> / <c>new_value</c> columns.
/// </summary>
public sealed record ComputedSnapshotChange(string Field, string? OldValue, string? NewValue);

/// <summary>
/// Computes what changed between the prior snapshot of a survey and this one.
///
/// A pure function over two entry sets, deliberately kept out of the endpoint so it can be
/// unit-tested without a database -- the arithmetic here is the part that is easy to get
/// subtly wrong and expensive to notice, since a wrong diff does not fail, it just makes
/// period-over-period comparison quietly misleading.
/// </summary>
public static class DemographicSnapshotDiff
{
    /// <summary>
    /// Pseudo field key recording that a person entered or left the population between the
    /// two snapshots. A real demographic field cannot collide with it: field keys come from
    /// <c>demographic_fields.field</c>, and <c>__membership__</c> is not a value the admin
    /// UI can produce -- and even if it were, the collision would be visible rather than
    /// silent because both sides are namespaced under the same user id.
    /// </summary>
    public const string MembershipField = "__membership__";

    /// <summary>The value <see cref="MembershipField"/> takes while a person is in the population.</summary>
    public const string MembershipPresent = "present";

    /// <summary>
    /// Marks a change row as machine-computed. Recomputation replaces rows carrying this
    /// prefix and leaves manually recorded ones alone; the write endpoint rejects a manual
    /// reason that starts with it, so a caller cannot plant a row that a later recompute
    /// would silently delete.
    /// </summary>
    public const string ComputedReasonPrefix = "computed:";

    public static string ComputedReason(int priorVersion) => $"{ComputedReasonPrefix}v{priorVersion}";

    public static bool IsComputedReason(string? reason)
        => reason is not null && reason.StartsWith(ComputedReasonPrefix, StringComparison.Ordinal);

    /// <summary>Namespaces a field key under the person it belongs to, matching <c>demographic_snapshot_changes.field</c>.</summary>
    public static string FieldKey(Guid userId, string field) => $"{userId}.{field}";

    /// <summary>
    /// The differences that take <paramref name="prior"/> to <paramref name="current"/>.
    ///
    /// Joiners and leavers produce a single <see cref="MembershipField"/> row rather than one
    /// row per demographic they happen to carry. A joiner's full profile is not a *change* --
    /// it is that person's entry, already recorded in this snapshot's entries -- and a
    /// leaver's is already recorded in the prior one. Emitting them again would bury the
    /// changes that are genuinely about composition (people who stayed and moved) under a
    /// row per field per new hire.
    /// </summary>
    public static IReadOnlyList<ComputedSnapshotChange> Compute(
        IReadOnlyList<SnapshotEntryValueSet> prior,
        IReadOnlyList<SnapshotEntryValueSet> current)
    {
        ArgumentNullException.ThrowIfNull(prior);
        ArgumentNullException.ThrowIfNull(current);

        // Last write wins on a duplicated user id rather than throwing: the entry table has
        // no unique (snapshot_id, user_id) constraint, so a row pair written before the
        // write endpoint existed can legitimately be there, and a read-side recompute must
        // not 500 over it.
        var priorByUser = ToLookup(prior);
        var currentByUser = ToLookup(current);

        var changes = new List<ComputedSnapshotChange>();

        foreach (var userId in priorByUser.Keys.Union(currentByUser.Keys).OrderBy(id => id))
        {
            var hadBefore = priorByUser.TryGetValue(userId, out var before);
            var hasNow = currentByUser.TryGetValue(userId, out var after);

            if (hadBefore && !hasNow)
            {
                changes.Add(new ComputedSnapshotChange(
                    FieldKey(userId, MembershipField), ToJson(MembershipPresent), null));
                continue;
            }

            if (!hadBefore && hasNow)
            {
                changes.Add(new ComputedSnapshotChange(
                    FieldKey(userId, MembershipField), null, ToJson(MembershipPresent)));
                continue;
            }

            foreach (var field in before!.Keys.Union(after!.Keys, StringComparer.Ordinal).OrderBy(f => f, StringComparer.Ordinal))
            {
                var oldValue = before.GetValueOrDefault(field);
                var newValue = after.GetValueOrDefault(field);

                if (string.Equals(oldValue, newValue, StringComparison.Ordinal))
                {
                    continue;
                }

                changes.Add(new ComputedSnapshotChange(
                    FieldKey(userId, field),
                    oldValue is null ? null : ToJson(oldValue),
                    newValue is null ? null : ToJson(newValue)));
            }
        }

        return changes;
    }

    private static Dictionary<Guid, IReadOnlyDictionary<string, string>> ToLookup(
        IReadOnlyList<SnapshotEntryValueSet> entries)
    {
        var lookup = new Dictionary<Guid, IReadOnlyDictionary<string, string>>();
        foreach (var entry in entries)
        {
            lookup[entry.UserId] = entry.Values;
        }

        return lookup;
    }

    private static string ToJson(string value) => JsonSerializer.Serialize(value);
}
