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
    /// What the respondent should read, or null for the default. An author clears a text by
    /// saving it empty (<c>LocalizedInput</c>'s convention), so an empty or whitespace column is
    /// "not set", never a blank box.
    /// </summary>
    public static string? OrDefault(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;
}
