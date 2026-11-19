namespace ClimateProject.Application.Surveys;

/// <summary>
/// A survey's own respondent-facing texts: the anonymity box's paragraph and the thank-you
/// (<c>SurveySettings.RespondentIntro*</c> / <c>ClosingMessage*</c>). One place for their limits and
/// for the rule that blank means "use the product's default".
/// </summary>
public static class SurveyRespondentText
{
    public const int IntroMaxLength = 1000;
    public const int ClosingMaxLength = 500;

    /// <summary>
    /// The longest duration a survey may state (<c>SurveySettings.EstimatedMinutes</c>), in
    /// minutes. Ten hours: past any questionnaire anyone answers in one sitting, so a typo like
    /// 3000 is refused rather than printed to every respondent.
    /// </summary>
    public const int EstimatedMinutesMax = 600;

    /// <summary>
    /// The shortest duration a survey may state. Below two minutes the screens already say
    /// «menos de un minuto» from the question count, and a stated 1 would print «1 minutos»:
    /// the catalogues have no singular for it. So 1 is refused; 0 clears.
    /// </summary>
    public const int EstimatedMinutesMin = 2;

    /// <summary>
    /// What the respondent should read, or null for the default. An author clears a text by
    /// saving it empty (<c>LocalizedInput</c>'s convention), so an empty or whitespace column is
    /// "not set", never a blank box.
    /// </summary>
    public static string? OrDefault(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;
}
