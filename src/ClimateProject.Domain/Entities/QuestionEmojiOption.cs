namespace ClimateProject.Domain.Entities;

public class QuestionEmojiOption
{
    public Guid QuestionId { get; set; }
    public int Order { get; set; }
    public required string Emoji { get; set; }
    public required string Label { get; set; }
    public int Value { get; set; }
}
