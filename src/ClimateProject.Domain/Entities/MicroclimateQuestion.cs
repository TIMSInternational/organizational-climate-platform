namespace ClimateProject.Domain.Entities;

public class MicroclimateQuestion
{
    public Guid Id { get; set; }
    public Guid MicroclimateId { get; set; }
    public string? TextEn { get; set; }
    public string? TextEs { get; set; }
    public required string Type { get; set; }
    public bool Required { get; set; } = true;
    public int Order { get; set; }
}

/// <summary>Stable-value option rows for a microclimate question. See <see cref="QuestionOption"/>.</summary>
public class MicroclimateQuestionOption
{
    public Guid MicroclimateQuestionId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}
