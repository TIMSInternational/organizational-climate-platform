namespace ClimateProject.Domain.Entities;

/// <summary>
/// One point on a microclimate question's emoji scale: the glyph, the word that names
/// it, and the stable numeric value a respondent's answer is stored as.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this table exists rather than reusing <see cref="MicroclimateQuestionOption"/></b>
/// (#198). Carrying emoji characters in the plain option rows was rejected: that shape
/// has one label per locale and nowhere to put the glyph beside it, so the emoji would
/// have had to BE the label -- and an emoji-only radio option has no accessible name.
/// A screen reader would announce whatever its own emoji dictionary happens to call the
/// character, in whatever language that dictionary is in, which for a product whose
/// stated audience includes people with low digital literacy is not an answerable
/// control. Keeping <see cref="Emoji"/> and the label in separate columns is the whole
/// point of the table: the glyph is decoration, the label is the name.
/// </para>
/// <para>
/// <b>Why not make <see cref="QuestionEmojiOption"/> polymorphic.</b> It is keyed to
/// survey <c>QuestionId</c> with a real FK. Generalising it would need a polymorphic
/// parent reference, which nothing else in this schema uses; the fan-out pattern (a
/// child table per parent) is what <c>microclimate_question_options</c> beside
/// <c>question_options</c> already does.
/// </para>
/// </remarks>
public class MicroclimateQuestionEmojiOption
{
    public Guid MicroclimateQuestionId { get; set; }

    /// <summary>Position on the scale, 0-based. Half of the primary key.</summary>
    public int Order { get; set; }

    /// <summary>The glyph. Decoration -- never the accessible name. See <see cref="LabelEn"/>.</summary>
    public required string Emoji { get; set; }

    /// <summary>
    /// The word that names the glyph, in English. Together with <see cref="LabelEs"/>
    /// this is the option's accessible name, and it is what the publish gate marks
    /// Required -- an unnamed emoji is the failure this table exists to prevent.
    /// </summary>
    public string? LabelEn { get; set; }

    /// <inheritdoc cref="LabelEn"/>
    public string? LabelEs { get; set; }

    /// <summary>
    /// The locale-independent key. This -- never the glyph and never the label -- is what
    /// a submitted answer is validated against, for the same reason
    /// <see cref="MicroclimateQuestionOption.Value"/> exists: two respondents picking the
    /// same face in different languages must count as the same answer.
    /// </summary>
    public int Value { get; set; }
}
