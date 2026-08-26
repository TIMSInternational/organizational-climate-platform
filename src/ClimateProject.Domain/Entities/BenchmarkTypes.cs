namespace ClimateProject.Domain.Entities;

/// <summary>
/// The two values <see cref="Benchmark.Type"/> is written with in practice.
/// </summary>
/// <remarks>
/// <para>
/// <b>A convention, not a catalogue.</b> Unlike <see cref="PriorPeriodStatuses"/> and
/// <see cref="BenchmarkValidationStatuses"/>, <c>benchmarks.type</c> is a free string typed
/// into an open text field on the create form, and nothing -- no check constraint, no
/// validation -- restricts it to these two. They are named here because the sector route has
/// to pick one as its default and a bare <c>"industry"</c> literal inside a query builder is
/// not something a reader can find, argue with, or grep for.
/// </para>
/// <para>
/// There is deliberately no <c>IsKnown</c>. Adding one would invite a caller to reject a third
/// type, and the product has never promised there are only two.
/// </para>
/// </remarks>
public static class BenchmarkTypes
{
    /// <summary>
    /// A benchmark describing a sector rather than a company: what "normal" is across an
    /// industry. The rows a company measures itself against.
    /// </summary>
    public const string Industry = "industry";

    /// <summary>
    /// A benchmark a company keeps about itself -- a target, a previous programme, a division
    /// held up as the standard. Never part of an industry sector: averaging one company's
    /// internal target into the industry mean makes the industry look like that company.
    /// </summary>
    public const string Internal = "internal";
}
