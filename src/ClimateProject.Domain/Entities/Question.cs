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

    /// <summary>
    /// The library item this question was copied from, or null if it was authored directly (#58).
    ///
    /// <para>Provenance only. Instantiation is a COPY, never a reference: an answer is stored
    /// against the question as it was ASKED, so a survey that pointed at a mutable library row
    /// would silently change the meaning of every stored answer when someone edited it -- with no
    /// error and with row counts reconciling exactly. This column is what lets usage be counted
    /// and "where is this question used" be answered without making content depend on it.</para>
    /// </summary>
    public Guid? SourceLibraryItemId { get; set; }

    /// <summary>
    /// The question BANK item this question was copied from, or null if it came from
    /// anywhere else (#110).
    ///
    /// <para>The bank's twin of <see cref="SourceLibraryItemId"/>, and separate from it
    /// because the two repositories are separate and must not be merged (#58): a question
    /// can be picked out of the authoring library or out of the curation bank, and
    /// collapsing the two columns would make "where did this come from" unanswerable the
    /// moment both are populated.</para>
    ///
    /// <para><b>This column is the only thing that makes bank usage and effectiveness
    /// computable.</b> Without it, "how often is this question answered" can only be a
    /// counter someone remembers to increment on the respondent's own transaction -- the
    /// hot row #110 exists to refuse. With it, every number is a COUNT over rows that
    /// already exist, taken when an admin asks rather than when a respondent submits. See
    /// <c>QuestionBankMetrics</c>.</para>
    ///
    /// <para>Provenance only, exactly like its sibling: instantiation is a COPY, so a
    /// retired or re-worded bank item cannot change the meaning of an answer already
    /// stored. That is what lets retirement be a state change rather than a deletion.</para>
    /// </summary>
    public Guid? SourceQuestionBankItemId { get; set; }
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
