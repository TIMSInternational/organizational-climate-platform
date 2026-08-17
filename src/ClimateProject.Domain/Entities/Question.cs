namespace ClimateProject.Domain.Entities;

public class Question
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
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

    // Null means the author asked for no comment box; the respond UI only renders
    // one when a prompt is present. The old per-language DDL defaults made the box
    // universal on every question ever authored, which inverted the opt-in contract.
    public string? CommentPromptEn { get; set; }
    public string? CommentPromptEs { get; set; }

    public string? BinaryCommentConfigEn { get; set; }
    public string? BinaryCommentConfigEs { get; set; }
    public bool Required { get; set; }
    public int Order { get; set; }
    public string? Category { get; set; }
}

/// <summary>
/// Options moved out of a <c>text[]</c> column and into rows carrying a stable,
/// locale-independent <see cref="Value"/> (#195).
///
/// Two defects made this mandatory rather than tidy. Index-aligned
/// <c>options_en</c>/<c>options_es</c> arrays cannot be constrained to the same
/// length, so a one-element drift silently renumbers every respondent's answer. And
/// more seriously, answers are stored by the option's own text: with per-language
/// text, two respondents choosing the same option in different languages store two
/// unrelated strings, splitting every distribution, chart, benchmark and export --
/// with no error and with row counts that reconcile exactly.
///
/// <see cref="Value"/> is what lands in <c>question_responses.response_value</c>; the
/// labels are display only. <c>QuestionTypes.YesNo</c> already worked this way
/// (comparing to the codes "yes"/"no"), so this is the grain of the codebase, not a
/// new invention.
/// </summary>
public class QuestionOption
{
    public Guid QuestionId { get; set; }
    public int Order { get; set; }
    public required string Value { get; set; }
    public string? LabelEn { get; set; }
    public string? LabelEs { get; set; }
}
