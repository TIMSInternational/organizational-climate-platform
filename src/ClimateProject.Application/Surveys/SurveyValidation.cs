using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Surveys;

public static class SurveyValidation
{
    /// <summary>
    /// Derived from <see cref="QuestionTypes.ForSurvey"/> rather than written as its own
    /// literal list -- independent literals are exactly how five vocabularies drifted
    /// apart before #196.
    ///
    /// Known gap, reported rather than papered over: <c>question_emoji_options</c> is
    /// keyed to a *survey* question, yet <see cref="QuestionTypes.EmojiRating"/> is not in
    /// <see cref="QuestionTypes.ForSurvey"/> (which #196 pinned to legacy
    /// <c>Survey.ts</c>'s six). So this API cannot author an emoji question even though
    /// the schema can store one. Duplication still copies emoji option rows verbatim,
    /// because rows imported by #154 will exist regardless of what this endpoint accepts.
    /// Widening the vocabulary belongs to #196, not here.
    /// </summary>
    public static readonly string[] ValidQuestionTypes = QuestionTypes.ForSurvey;

    /// <summary>
    /// Bulk actions accepted by <c>POST /surveys/bulk</c>. Each is applied through the
    /// same transition and immutability rules a single-survey call would go through --
    /// bulk is a loop, never a bypass.
    /// </summary>
    public const string BulkActionArchive = "archive";
    public const string BulkActionClose = "close";
    public const string BulkActionDelete = "delete";

    public static readonly string[] BulkActions = [BulkActionArchive, BulkActionClose, BulkActionDelete];

    /// <summary>
    /// The suffix appended to a duplicated survey's title, per locale.
    ///
    /// Per-locale rather than one string, because appending " (Copy)" to a Spanish title
    /// is precisely the silent English-into-Spanish leak #195 exists to stop -- and it
    /// would be applied to the <c>title_es</c> column, where nothing downstream could
    /// ever detect it. Only locales the original actually authored get a suffix; an
    /// unauthored column stays null rather than becoming a bare "(Copia)".
    /// </summary>
    public const string CopySuffixEn = " (Copy)";
    public const string CopySuffixEs = " (Copia)";

    /// <summary>Matches <c>surveys.title_en</c>/<c>title_es</c>'s HasMaxLength(200).</summary>
    public const int TitleMaxLength = 200;

    /// <summary>
    /// Derives an option's stable value when the caller did not supply one: the English
    /// label, else the Spanish one. Identical to the microclimate rule and to the rule
    /// #195's migration applied to the old <c>text[]</c> options, which is what keeps
    /// existing <c>response_value</c> rows matching without a data backfill.
    ///
    /// Lives here rather than beside one endpoint because both the survey and the survey
    /// *template* write paths must derive the same value from the same labels -- two
    /// implementations of this rule would let a template and a survey disagree about an
    /// option's identity, which is the silent aggregation split the stable value exists
    /// to prevent.
    /// </summary>
    public static string? DeriveOptionValue(string? explicitValue, string? labelEn, string? labelEs)
    {
        if (!string.IsNullOrWhiteSpace(explicitValue))
        {
            return explicitValue.Trim();
        }

        if (!string.IsNullOrWhiteSpace(labelEn))
        {
            return labelEn.Trim();
        }

        return string.IsNullOrWhiteSpace(labelEs) ? null : labelEs.Trim();
    }

    /// <summary>
    /// Appends the locale-appropriate copy suffix, leaving an unauthored column null and
    /// trimming to the column's length so a long title's duplicate does not fail on a
    /// database constraint the caller cannot see.
    /// </summary>
    public static string? WithCopySuffix(string? title, string suffix)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return title;
        }

        var combined = title.Trim() + suffix;
        return combined.Length <= TitleMaxLength
            ? combined
            : string.Concat(combined.AsSpan(0, TitleMaxLength - suffix.Length).Trim(), suffix);
    }
}
