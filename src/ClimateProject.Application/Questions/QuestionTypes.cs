namespace ClimateProject.Application.Questions;

/// <summary>
/// The one canonical question-type vocabulary, and the per-context subsets derived
/// from it.
///
/// Before this existed there were five disagreeing vocabularies (#196): legacy
/// <c>Survey</c> and <c>QuestionBank</c> allowed six types, legacy
/// <c>Microclimate</c> four, legacy <c>QuestionLibrary</c> seven, and the target
/// microclimate list four -- of which three did not match legacy at all. The
/// consequence was that a legacy microclimate question typed <c>likert</c> or
/// <c>open_ended</c> could not be imported, and the ETL (#154) would fail on
/// probably most real microclimate rows.
///
/// **Naming follows legacy**, because legacy is what production data contains and
/// what four of the five vocabularies already agreed on. That is why
/// <c>open_text</c> was renamed to <see cref="OpenEnded"/>: it was a target-only
/// invention, and a silent rename is the worst kind of mismatch -- it reads as
/// correct and fails only on real data.
///
/// Per-context subsets are **derived from this set**, never written as independent
/// literals. Independent literals are how the vocabularies drifted apart in the
/// first place.
/// </summary>
public static class QuestionTypes
{
    /// <summary>Agree/disagree scale. The primary climate-measurement type.</summary>
    public const string Likert = "likert";

    /// <summary>Pick one of a configured option set.</summary>
    public const string MultipleChoice = "multiple_choice";

    /// <summary>Order a set of items by preference.</summary>
    public const string Ranking = "ranking";

    /// <summary>Free text. Legacy's name; the target briefly called this "open_text".</summary>
    public const string OpenEnded = "open_ended";

    /// <summary>Binary yes/no.</summary>
    public const string YesNo = "yes_no";

    /// <summary>Numeric quality rating, 1-5 unless an option set overrides it.</summary>
    public const string Rating = "rating";

    /// <summary>Emoji-based rating. Requires a configured emoji option set.</summary>
    public const string EmojiRating = "emoji_rating";

    /// <summary>
    /// Every type the platform recognises.
    ///
    /// Two legacy <c>QuestionLibrary</c> types are deliberately absent:
    /// <c>scale</c> and <c>binary</c>, which overlap <see cref="Likert"/>/<see cref="Rating"/>
    /// and <see cref="YesNo"/> respectively. Whether they are genuinely distinct is a
    /// question-repository design question and belongs to #58, not here -- adding them
    /// now would bake in a duplication this vocabulary exists to remove.
    ///
    /// <c>matrix</c> is also absent: nothing in the schema can represent a matrix
    /// question (no row/column structure on Question), so listing it would be a
    /// vocabulary that lies about what the product supports. Tracked as a parity gap.
    /// </summary>
    public static readonly string[] All =
    [
        Likert,
        MultipleChoice,
        Ranking,
        OpenEnded,
        YesNo,
        Rating,
        EmojiRating,
    ];

    /// <summary>
    /// Types valid on a survey question.
    ///
    /// Matches legacy <c>Survey.ts</c>'s six exactly. Note there is currently no
    /// endpoint that creates survey questions -- surveys are still unbuilt (#56-#61)
    /// -- so this set exists to be built *against* rather than to guard an existing
    /// write path. Defining it now is the point: it is why the survey path will not
    /// repeat the microclimate divergence.
    /// </summary>
    public static readonly string[] ForSurvey =
    [
        Likert,
        MultipleChoice,
        Ranking,
        OpenEnded,
        YesNo,
        Rating,
    ];

    /// <summary>
    /// Types valid on a microclimate question.
    ///
    /// Legacy allowed <c>likert</c>, <c>multiple_choice</c>, <c>open_ended</c> and
    /// <c>emoji_rating</c>. The target had <c>multiple_choice</c>, <c>open_text</c>,
    /// <c>rating</c> and <c>yes_no</c>.
    ///
    /// This is the union minus <see cref="EmojiRating"/>. Rationale for each
    /// difference from legacy:
    /// <list type="bullet">
    /// <item><see cref="Likert"/> restored -- legacy microclimates' primary type, and
    /// without it legacy rows cannot be imported.</item>
    /// <item><see cref="Rating"/> and <see cref="YesNo"/> kept even though legacy
    /// microclimates never had them: the target already implements answer validation
    /// and respondent rendering for both, and removing working functionality to match
    /// legacy would be a regression, not parity.</item>
    /// <item><see cref="EmojiRating"/> **not** added despite legacy support. A
    /// microclimate question has no place to store an emoji set -- QuestionEmojiOption
    /// is keyed to survey QuestionId, and MicroclimateQuestion has only a flat
    /// Options array. Accepting the type without somewhere to put its emoji would
    /// create unanswerable questions, which is the exact failure the multiple_choice
    /// minimum-option check exists to prevent. Needs storage design first.</item>
    /// <item><c>ranking</c> not added -- no legacy microclimate used it, and neither
    /// answer validation nor rendering exists for ordered responses.</item>
    /// </list>
    /// </summary>
    public static readonly string[] ForMicroclimate =
    [
        Likert,
        MultipleChoice,
        OpenEnded,
        YesNo,
        Rating,
    ];

    /// <summary>
    /// Types whose answers are free text, and so may be fed into word-frequency and
    /// sentiment analysis.
    ///
    /// Extracted because the microclimate word cloud must count only open text --
    /// rating values, yes/no, and multiple-choice option labels must never reach
    /// word-frequency counting. Previously this was an inline <c>== "open_text"</c>
    /// comparison, which is exactly the kind of scattered literal that let the
    /// vocabularies drift.
    /// </summary>
    public static readonly string[] FreeText = [OpenEnded];

    /// <summary>
    /// Types answered on a 1-5 numeric scale when no explicit option set is
    /// configured. Both are validated and rendered identically; they differ in
    /// meaning (agreement vs quality), which is why both exist rather than one.
    /// </summary>
    public static readonly string[] NumericScale = [Likert, Rating];
}
