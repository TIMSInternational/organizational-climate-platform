namespace ClimateProject.Domain.Entities;

public class MicroclimateTemplateQuestion
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public string? TextEn { get; set; }
    public string? TextEs { get; set; }
    public required string Type { get; set; }
    public bool Required { get; set; } = true;
    public int Order { get; set; }
    public string? Category { get; set; }
}

/// <summary>Stable-value option rows for a microclimate template question. See <see cref="QuestionOption"/>.</summary>
public class MicroclimateTemplateQuestionOption
{
    public Guid MicroclimateTemplateQuestionId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}
