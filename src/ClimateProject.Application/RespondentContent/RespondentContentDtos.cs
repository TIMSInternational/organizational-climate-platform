namespace ClimateProject.Application.RespondentContent;

/// <summary>One registry entry, as an editor needs it.</summary>
/// <param name="Placeholders">Names without braces, e.g. <c>["count", "minutes"]</c>.</param>
/// <param name="Values">A display entry's allowed values; empty for a text.</param>
/// <param name="DefaultValue">A display entry's product default; null for a text.</param>
/// <param name="LegacyColumn">Set when the survey level of this key lives in a survey column.</param>
public sealed record RespondentContentEntryDto(
    string Key,
    string Kind,
    string Group,
    int MaxLength,
    IReadOnlyList<string> Placeholders,
    IReadOnlyList<string> Values,
    string? DefaultValue,
    string? LegacyColumn)
{
    public static RespondentContentEntryDto From(RespondentContentEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return new RespondentContentEntryDto(
            entry.Key, entry.Kind, entry.Group, entry.MaxLength, entry.Placeholders, entry.AllowedValues, entry.DefaultValue, entry.LegacyColumn);
    }

    public static IReadOnlyList<RespondentContentEntryDto> All { get; } =
        [.. RespondentContentRegistry.Entries.Select(From)];
}

/// <summary>
/// <c>GET</c> (and the <c>PUT</c>'s answer) of <c>/admin/companies/{companyId}/respondent-content</c>
/// and <c>/surveys/{surveyId}/respondent-content</c>.
/// </summary>
/// <remarks>
/// Every values map is keyed <c>locale → key → text</c> with all three locales present
/// (<c>es</c>, <c>en</c>, <c>*</c>), possibly empty -- the PUT body's shape, so an editor can
/// send back what it read. Texts are under <c>es</c>/<c>en</c>, display choices under <c>*</c>.
/// </remarks>
/// <param name="Level"><c>company</c> or <c>survey</c>.</param>
/// <param name="Language">The company's <c>settings.language</c>, or the survey's <c>language</c>: <c>es</c>, <c>en</c> or <c>both</c>.</param>
/// <param name="RequiredLocales">The locales an editor should offer: the single language, or both.</param>
/// <param name="Editable">Whether THIS caller may PUT now (a survey's status and the caller's role decide).</param>
/// <param name="SurveyStatus">The survey's status; null at the company level.</param>
/// <param name="CompanyValues">The company's own stored values.</param>
/// <param name="SurveyValues">
/// The survey's own stored values, its legacy columns mapped to their keys; null at the company level.
/// </param>
/// <param name="Effective">
/// What a reader in each locale gets: survey → survey column → company. A key absent here is the
/// product default.
/// </param>
public sealed record RespondentContentView(
    string Level,
    Guid CompanyId,
    Guid? SurveyId,
    string Language,
    IReadOnlyList<string> RequiredLocales,
    bool Editable,
    string? SurveyStatus,
    IReadOnlyList<RespondentContentEntryDto> Entries,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> CompanyValues,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? SurveyValues,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Effective);

/// <summary>
/// <c>PUT</c> body: <c>{ "values": { "es": { "demographics.intro": "…" }, "*": { "display.textAlign": "start" } } }</c>.
/// Partial: only the keys sent are touched. <c>""</c>, whitespace or null clears that key at this
/// level, so the next level shows through.
/// </summary>
public sealed record UpdateRespondentContentRequest(Dictionary<string, Dictionary<string, string?>>? Values);

/// <summary>The levels a view is read at.</summary>
public static class RespondentContentLevels
{
    public const string Company = "company";
    public const string Survey = "survey";
}
