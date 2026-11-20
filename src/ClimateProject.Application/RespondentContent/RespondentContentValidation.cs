namespace ClimateProject.Application.RespondentContent;

/// <summary>Why a <c>respondent-content</c> PUT was refused. The API maps each to a stable code.</summary>
public enum RespondentContentRefusalReason
{
    /// <summary>A locale other than <c>es</c>, <c>en</c> or <c>*</c>.</summary>
    UnknownLocale,

    /// <summary>A text under <c>*</c>, or a display key under <c>es</c>/<c>en</c>.</summary>
    LocaleMismatch,

    /// <summary>A key the registry does not name.</summary>
    UnknownKey,

    /// <summary>Longer than the entry's <see cref="RespondentContentEntry.MaxLength"/>.</summary>
    TooLong,

    /// <summary>A <c>{name}</c> the entry does not allow.</summary>
    UnknownPlaceholder,

    /// <summary>A display value outside the entry's set.</summary>
    ValueNotAllowed,
}

/// <summary>The first problem found in a PUT body, naming where it is.</summary>
public sealed record RespondentContentRefusal(
    RespondentContentRefusalReason Reason,
    string Message,
    string? Locale = null,
    string? Key = null,
    string? Placeholder = null,
    int? MaxLength = null,
    IReadOnlyList<string>? Allowed = null);

/// <summary>One validated change. <see cref="Value"/> null clears the value at its level.</summary>
public sealed record RespondentContentWrite(RespondentContentEntry Entry, string Locale, string? Value);

/// <summary>
/// The whole PUT body checked before anything is written -- so a refused body leaves nothing
/// half-applied, the rule every settings route here keeps.
/// </summary>
public static class RespondentContentValidation
{
    /// <summary>
    /// Validates <c>{ "&lt;locale&gt;": { "&lt;key&gt;": "&lt;text&gt;" } }</c>. Only the keys sent
    /// are touched; an empty or whitespace text (or null) clears. Values are trimmed.
    /// </summary>
    /// <returns>Null and the writes, in body order; or the first refusal and no writes.</returns>
    public static RespondentContentRefusal? Prepare(
        IReadOnlyDictionary<string, Dictionary<string, string?>>? values,
        out IReadOnlyList<RespondentContentWrite> writes)
    {
        var prepared = new List<RespondentContentWrite>();
        writes = [];

        foreach (var (locale, byKey) in values ?? new Dictionary<string, Dictionary<string, string?>>())
        {
            if (!RespondentContentLocales.All.Contains(locale, StringComparer.Ordinal))
            {
                return new RespondentContentRefusal(
                    RespondentContentRefusalReason.UnknownLocale,
                    $"'{locale}' is not a locale respondent content is stored in. Use one of: {string.Join(", ", RespondentContentLocales.All)}.",
                    Locale: locale);
            }

            if (byKey is null)
            {
                continue;
            }

            foreach (var (key, raw) in byKey)
            {
                if (!RespondentContentRegistry.TryGet(key, out var entry))
                {
                    return new RespondentContentRefusal(
                        RespondentContentRefusalReason.UnknownKey,
                        $"'{key}' is not a text that can be edited.",
                        Locale: locale,
                        Key: key);
                }

                if (!entry.TakesLocale(locale))
                {
                    return new RespondentContentRefusal(
                        RespondentContentRefusalReason.LocaleMismatch,
                        entry.IsDisplay
                            ? $"'{key}' is a display choice and is stored under '*', not '{locale}'."
                            : $"'{key}' is a text and is stored under 'es' or 'en', not '{locale}'.",
                        Locale: locale,
                        Key: key);
                }

                var value = string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
                if (value is not null)
                {
                    if (value.Length > entry.MaxLength)
                    {
                        return new RespondentContentRefusal(
                            RespondentContentRefusalReason.TooLong,
                            $"'{key}' ({locale}) admits {entry.MaxLength} characters; it has {value.Length}.",
                            Locale: locale,
                            Key: key,
                            MaxLength: entry.MaxLength);
                    }

                    if (entry.IsDisplay)
                    {
                        if (!entry.AllowedValues.Contains(value, StringComparer.Ordinal))
                        {
                            return new RespondentContentRefusal(
                                RespondentContentRefusalReason.ValueNotAllowed,
                                $"'{key}' admits one of: {string.Join(", ", entry.AllowedValues)}.",
                                Locale: locale,
                                Key: key,
                                Allowed: entry.AllowedValues);
                        }
                    }
                    else if (RespondentContentPlaceholders.In(value)
                                 .FirstOrDefault(p => !entry.Placeholders.Contains(p, StringComparer.Ordinal)) is { } unknown)
                    {
                        return new RespondentContentRefusal(
                            RespondentContentRefusalReason.UnknownPlaceholder,
                            entry.Placeholders.Count == 0
                                ? $"'{key}' ({locale}) takes no placeholders, and '{{{unknown}}}' would be printed as it is."
                                : $"'{key}' ({locale}) does not know '{{{unknown}}}'. It may use: {string.Join(", ", entry.Placeholders.Select(p => "{" + p + "}"))}.",
                            Locale: locale,
                            Key: key,
                            Placeholder: unknown,
                            Allowed: entry.Placeholders);
                    }
                }

                prepared.Add(new RespondentContentWrite(entry, locale, value));
            }
        }

        writes = prepared;
        return null;
    }
}
