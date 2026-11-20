using System.Text.RegularExpressions;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.RespondentContent;

/// <summary>One stored value: a registry key, its locale, its text.</summary>
public sealed record RespondentContentValue(string Key, string Locale, string Value);

/// <summary>
/// The <c>{name}</c> placeholders in a text, read the way <c>web/src/i18n/translate.ts</c>
/// interpolates them (<c>/\{(\w+)\}/g</c>, where JavaScript's <c>\w</c> is ASCII).
/// </summary>
public static partial class RespondentContentPlaceholders
{
    [GeneratedRegex(@"\{([A-Za-z0-9_]+)\}", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    /// <summary>Every distinct placeholder name in <paramref name="text"/>, braces removed, in order of first use.</summary>
    public static IReadOnlyList<string> In(string? text)
        => string.IsNullOrEmpty(text)
            ? []
            : [.. Pattern().Matches(text).Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal)];
}

/// <summary>
/// The survey columns that hold a legacy key's survey-level value
/// (<see cref="RespondentContentLegacyColumns"/>), read and written by locale. The one place
/// that maps a column name to its two properties, so the resolver, the PUT and the GET cannot
/// disagree about which column a key lives in.
/// </summary>
public static class RespondentContentLegacy
{
    /// <summary>The column's value in <paramref name="locale"/>, or null when blank. Never the other locale's.</summary>
    public static string? Read(SurveySettings settings, string legacyColumn, string locale)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var spanish = locale == RespondentContentLocales.Spanish;
        if (!spanish && locale != RespondentContentLocales.English)
        {
            return null;
        }

        var value = legacyColumn switch
        {
            RespondentContentLegacyColumns.RespondentIntro => spanish ? settings.RespondentIntroEs : settings.RespondentIntroEn,
            RespondentContentLegacyColumns.ClosingMessage => spanish ? settings.ClosingMessageEs : settings.ClosingMessageEn,
            RespondentContentLegacyColumns.InvitationCustomSubject => spanish ? settings.InvitationCustomSubjectEs : settings.InvitationCustomSubjectEn,
            RespondentContentLegacyColumns.InvitationCustomMessage => spanish ? settings.InvitationCustomMessageEs : settings.InvitationCustomMessageEn,
            _ => null,
        };

        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    /// <summary>Writes <paramref name="value"/> (null clears) into the column's <paramref name="locale"/> half.</summary>
    public static void Write(SurveySettings settings, string legacyColumn, string locale, string? value)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var spanish = locale == RespondentContentLocales.Spanish;
        if (!spanish && locale != RespondentContentLocales.English)
        {
            throw new ArgumentOutOfRangeException(nameof(locale), locale, "A legacy column is written in 'es' or 'en'.");
        }

        switch (legacyColumn)
        {
            case RespondentContentLegacyColumns.RespondentIntro:
                if (spanish) settings.RespondentIntroEs = value; else settings.RespondentIntroEn = value;
                break;
            case RespondentContentLegacyColumns.ClosingMessage:
                if (spanish) settings.ClosingMessageEs = value; else settings.ClosingMessageEn = value;
                break;
            case RespondentContentLegacyColumns.InvitationCustomSubject:
                if (spanish) settings.InvitationCustomSubjectEs = value; else settings.InvitationCustomSubjectEn = value;
                break;
            case RespondentContentLegacyColumns.InvitationCustomMessage:
                if (spanish) settings.InvitationCustomMessageEs = value; else settings.InvitationCustomMessageEn = value;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(legacyColumn), legacyColumn, "Not a legacy respondent-content column.");
        }
    }

    /// <summary>A survey's legacy columns as stored values, under their registry keys.</summary>
    public static IReadOnlyList<RespondentContentValue> ValuesOf(SurveySettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var values = new List<RespondentContentValue>();
        foreach (var entry in RespondentContentRegistry.Entries.Where(e => e.LegacyColumn is not null))
        {
            foreach (var locale in RespondentContentLocales.Text)
            {
                if (Read(settings, entry.LegacyColumn!, locale) is { } text)
                {
                    values.Add(new RespondentContentValue(entry.Key, locale, text));
                }
            }
        }

        return values;
    }
}
