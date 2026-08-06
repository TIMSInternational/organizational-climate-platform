namespace ClimateProject.Domain.Entities;

public class DemographicField
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }

    /// <summary>The stable key. Never translated -- it is an identifier, not content.</summary>
    public required string Field { get; set; }

    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }

    public required string Type { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// Same treatment as question options, and deliberately so -- one rule rather than
/// two. A demographic answer is stored as <see cref="Value"/> in
/// user_demographics/user_invitation_demographics, so a bilingual company filtering a
/// dashboard by "Ventas"/"Sales" must not split its own headcount in half.
/// </summary>
public class DemographicFieldOption
{
    public Guid DemographicFieldId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}
