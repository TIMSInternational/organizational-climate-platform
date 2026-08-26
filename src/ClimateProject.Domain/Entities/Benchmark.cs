namespace ClimateProject.Domain.Entities;

public class Benchmark
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public required string Type { get; set; }
    public required string Category { get; set; }
    public required string Source { get; set; }
    public string? Industry { get; set; }
    public string? CompanySize { get; set; }
    public string? Region { get; set; }
    public Guid CreatedBy { get; set; }
    public Guid? CompanyId { get; set; }
    public bool IsActive { get; set; } = true;
    public string ValidationStatus { get; set; } = "pending";
    public double QualityScore { get; set; }
    public string? Metadata { get; set; }
    public Guid? PriorPeriodBenchmarkId { get; set; }

    /// <summary>
    /// Which of the three things a null <see cref="PriorPeriodBenchmarkId"/> means.
    ///
    /// <para>
    /// The pointer alone cannot say. A null used to carry two entirely different claims at
    /// once -- "this is the first period we ever measured, so there is nothing before it"
    /// and "somebody has not got round to linking this yet" -- and the benchmarks page
    /// printed one sentence for both. The first is a fact about the company; the second is
    /// a fact about our own data entry, and a reader has no way to tell which they are
    /// looking at. #89's acceptance criteria require them to render distinctly, which they
    /// cannot do while the only thing stored is an absence.
    /// </para>
    /// <para>
    /// One of <c>unlinked</c> (nobody has said), <c>linked</c> (the pointer is set) or
    /// <c>none</c> (an administrator has declared there is no prior period). The
    /// <c>linked</c> value and a non-null pointer are the same fact stated twice, so the
    /// database holds a CHECK constraint that makes disagreeing impossible rather than
    /// leaving it to whichever code path writes next -- see
    /// <c>BenchmarkConfiguration</c>.
    /// </para>
    /// </summary>
    public string PriorPeriodStatus { get; set; } = PriorPeriodStatuses.Unlinked;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
