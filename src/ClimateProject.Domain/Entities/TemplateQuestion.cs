namespace ClimateProject.Domain.Entities;

// Same scalar shape as Question, but owned by a SurveyTemplate instead of a Survey,
// so a template's questions are real, editable, queryable rows -- not jsonb.
public class TemplateQuestion
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public string? TextEn { get; set; }
    public string? TextEs { get; set; }
    public required string Type { get; set; }
    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMinEn { get; set; }
    public string? ScaleLabelMinEs { get; set; }
    public string? ScaleLabelMaxEn { get; set; }
    public string? ScaleLabelMaxEs { get; set; }
    public bool CommentRequired { get; set; } = true;
    public string CommentPromptEn { get; set; } = "Please explain your answer:";
    public string CommentPromptEs { get; set; } = "Por favor explica tu respuesta:";
    public string? BinaryCommentConfigEn { get; set; }
    public string? BinaryCommentConfigEs { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public string? Category { get; set; }
}

/// <summary>Stable-value option rows for a template question. See <see cref="QuestionOption"/>.</summary>
public class TemplateQuestionOption
{
    public Guid TemplateQuestionId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}
