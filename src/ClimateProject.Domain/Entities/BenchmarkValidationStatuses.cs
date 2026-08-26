namespace ClimateProject.Domain.Entities;

/// <summary>
/// The four values <see cref="Benchmark.ValidationStatus"/> may hold.
///
/// <para>
/// In <c>ClimateProject.Domain</c> for the reason <see cref="PriorPeriodStatuses"/> gives:
/// the entity's own default is one of them, and until #90 that default was the bare literal
/// <c>"pending"</c> written out twice -- once on the entity, once in
/// <c>BenchmarkEndpoints.CreateAsync</c> -- with a third copy in
/// <c>BenchmarkConfiguration</c>'s <c>HasDefaultValue</c>. Three copies of a string that has
/// to agree is the shape a status drifts in.
/// </para>
/// <para>
/// The column is <c>varchar(20)</c>, so every value here must fit in twenty characters.
/// </para>
/// </summary>
public static class BenchmarkValidationStatuses
{
    /// <summary>
    /// Nobody has run the quality rule against this benchmark yet. The default for every new
    /// row and for every row created before #90.
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="NeedsReview"/> in exactly the way
    /// <see cref="PriorPeriodStatuses.Unlinked"/> is distinct from
    /// <see cref="PriorPeriodStatuses.None"/>: "not assessed" is a fact about our own process,
    /// "assessed and found thin" is a fact about the data. A screen that prints one over the
    /// other is lying about which.
    /// </remarks>
    public const string Pending = "pending";

    /// <summary>Scored at or above <c>BenchmarkQuality.VerifiedThreshold</c>.</summary>
    public const string Verified = "verified";

    /// <summary>
    /// Scored below <c>BenchmarkQuality.VerifiedThreshold</c> but at or above
    /// <c>BenchmarkQuality.FailedThreshold</c> -- usable, with the gaps named in the
    /// components of the validation response.
    /// </summary>
    public const string NeedsReview = "needs-review";

    /// <summary>
    /// Scored below <c>BenchmarkQuality.FailedThreshold</c>, or carrying no metrics at all.
    /// A benchmark with nothing measured is not a low-quality benchmark, it is not a
    /// benchmark, so the rule short-circuits there rather than letting the descriptive
    /// components carry it to a passing number.
    /// </summary>
    public const string Failed = "failed";

    public static readonly IReadOnlyList<string> All = [Pending, Verified, NeedsReview, Failed];

    public static bool IsKnown(string? status) => status is Pending or Verified or NeedsReview or Failed;
}
