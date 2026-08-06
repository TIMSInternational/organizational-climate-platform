namespace ClimateProject.Domain.Entities;

public class QuestionEmojiOption
{
    public Guid QuestionId { get; set; }
    public int Order { get; set; }
    public required string Emoji { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
    public int Value { get; set; }
}
