namespace ClimateProject.Domain.Entities;

public class Question
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public required string Text { get; set; }
    public required string Type { get; set; }
    public string[]? Options { get; set; }
    public int? ScaleMin { get; set; }
    public int? ScaleMax { get; set; }
    public string? ScaleLabelMin { get; set; }
    public string? ScaleLabelMax { get; set; }
    public bool CommentRequired { get; set; } = true;
    public string CommentPrompt { get; set; } = "Please explain your answer:";
    public string? BinaryCommentConfig { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public string? Category { get; set; }
}
