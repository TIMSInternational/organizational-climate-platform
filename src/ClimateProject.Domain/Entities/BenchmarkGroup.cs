namespace ClimateProject.Domain.Entities;

/// <summary>
/// A reference group a company is read against: a set of criteria, never a number.
/// </summary>
/// <remarks>
/// <para>
/// Ruled 3 Nov 2026: a group's medians are computed from the platform's own clients, at
/// read time, from each matching company's latest closed survey. Nothing about the group's
/// figures is stored, so nothing can go stale or be typed wrong -- which is what the older
/// <see cref="Benchmark"/> rows, entered by hand one metric at a time, kept getting wrong.
/// </para>
/// <para>
/// A null criterion means "any". <see cref="ServiceType"/> is required: it is the instrument
/// family (<c>general_climate</c>, <c>organizational_culture</c>, <c>microclimate</c>), and
/// two families' "Liderazgo" are the same word, not the same construct.
/// </para>
/// </remarks>
public class BenchmarkGroup
{
    public Guid Id { get; set; }
    public required string Name { get; set; }

    /// <summary>Matched against <see cref="Company.Industry"/>, case-insensitively. Null = any.</summary>
    public string? Industry { get; set; }

    /// <summary>Matched against <see cref="Company.Size"/>, case-insensitively. Null = any.</summary>
    public string? CompanySize { get; set; }

    /// <summary>Matched against <see cref="Company.Country"/>, case-insensitively. Null = any.</summary>
    public string? Country { get; set; }

    /// <summary>Matched against <see cref="Survey.ServiceType"/>, exactly. Required.</summary>
    public required string ServiceType { get; set; }

    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
