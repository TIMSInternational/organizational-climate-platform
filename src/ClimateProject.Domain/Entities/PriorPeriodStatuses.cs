namespace ClimateProject.Domain.Entities;

/// <summary>
/// The three values <see cref="Benchmark.PriorPeriodStatus"/> may hold.
///
/// <para>
/// In <c>ClimateProject.Domain</c> rather than beside the benchmark DTOs, because the
/// entity's own default is one of them. A copy in the Application layer plus a bare string
/// literal on the entity is precisely how <c>ValidationStatus</c>'s <c>"pending"</c> came to
/// exist in several places at once, and a status whose stored default disagrees with the
/// constant the endpoints compare against is a bug no test would think to look for.
/// </para>
/// </summary>
public static class PriorPeriodStatuses
{
    /// <summary>Nobody has said anything yet. The default for every new and every pre-#89 row.</summary>
    public const string Unlinked = "unlinked";

    /// <summary><see cref="Benchmark.PriorPeriodBenchmarkId"/> points at the preceding period.</summary>
    public const string Linked = "linked";

    /// <summary>
    /// An administrator has declared that no prior period exists -- a first-year company, a
    /// first measurement. Distinct from <see cref="Unlinked"/> on purpose: this one is an
    /// answer, and the UI must not print "not linked yet" over it.
    /// </summary>
    public const string None = "none";

    public static readonly IReadOnlyList<string> All = [Unlinked, Linked, None];

    public static bool IsKnown(string? status) => status is Unlinked or Linked or None;
}
