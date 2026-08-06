using System.Text.Json;
using System.Text.Json.Serialization;

namespace ClimateProject.Application.Localization;

/// <summary>
/// The write side of a paired-column field. Locale-keyed, never <c>En</c>/<c>Es</c>
/// properties -- a third language adds a key, not a request-DTO field.
///
/// Two wire shapes are accepted, and the second one is not a convenience:
///
/// <code>
///   "title": { "en": "Team pulse", "es": "Pulso de equipo" }   // authored, explicit
///   "title": "Team pulse"                                       // attributed
/// </code>
///
/// A bare string is attributed to the content's own single language. That is exactly
/// the rule #154's ETL must apply to legacy rows, which carry one string and no
/// language field at all, so the API and the loader agree by construction instead of
/// by comment. When the content is authored in <c>both</c>, a bare string is
/// **rejected** rather than guessed: silently filing Spanish text in the English
/// column is the count-reconciling, content-mangled failure #154's acceptance
/// criteria call out.
/// </summary>
[JsonConverter(typeof(LocalizedInputJsonConverter))]
public sealed class LocalizedInput
{
    private LocalizedInput(string? bare, IReadOnlyDictionary<string, string?>? byLocale)
    {
        Bare = bare;
        ByLocale = byLocale;
    }

    /// <summary>Set when the caller sent a bare JSON string.</summary>
    public string? Bare { get; }

    /// <summary>Set when the caller sent a locale-keyed object. Keys are already normalised.</summary>
    public IReadOnlyDictionary<string, string?>? ByLocale { get; }

    public static LocalizedInput FromBare(string? value) => new(value, null);

    /// <summary>
    /// Lets a caller pass a plain string where a localized field is expected, with the
    /// same meaning as the bare-string wire shape: attribute it to the content's own
    /// language. Keeps single-language call sites (and the ETL) from having to build a
    /// one-entry map, and <see cref="TryResolve"/> still rejects it for content
    /// authored in both languages.
    /// </summary>
    public static implicit operator LocalizedInput(string value) => FromBare(value);

    public static LocalizedInput FromLocales(IReadOnlyDictionary<string, string?> values) => new(null, values);

    /// <summary>
    /// Resolves this input into the two columns it writes.
    ///
    /// <paramref name="en"/>/<paramref name="es"/> are <c>null</c> for "the caller did
    /// not supply this locale", which on an update means *leave the existing value
    /// alone*. Clearing a translation is an explicit empty string, mirroring how the
    /// existing endpoints already distinguish "omitted" from "blanked".
    /// </summary>
    public bool TryResolve(
        string? contentLanguage,
        string fieldName,
        out string? en,
        out string? es,
        out string? error)
    {
        en = null;
        es = null;
        error = null;

        if (ByLocale is not null)
        {
            foreach (var (locale, value) in ByLocale)
            {
                switch (locale)
                {
                    case ContentLanguages.English:
                        en = value;
                        break;
                    case ContentLanguages.Spanish:
                        es = value;
                        break;
                    default:
                        error = $"'{fieldName}' has an unsupported language '{locale}'. Supported: {string.Join(", ", ContentLanguages.Locales)}";
                        return false;
                }
            }

            return true;
        }

        var single = ContentLanguages.SingleLocaleOf(contentLanguage);
        if (single is null)
        {
            error = $"'{fieldName}' was sent as a single string, but this content is authored in both languages. Send {{ \"en\": ..., \"es\": ... }} instead.";
            return false;
        }

        if (single == ContentLanguages.Spanish)
        {
            es = Bare;
        }
        else
        {
            en = Bare;
        }

        return true;
    }
}

/// <summary>
/// Accepts a JSON string, a JSON object of locale keys, or null. Anything else is a
/// deserialisation failure rather than a silently-empty field.
/// </summary>
public sealed class LocalizedInputJsonConverter : JsonConverter<LocalizedInput>
{
    public override LocalizedInput? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.Null:
                return null;

            case JsonTokenType.String:
                return LocalizedInput.FromBare(reader.GetString());

            case JsonTokenType.StartObject:
            {
                var values = new Dictionary<string, string?>(StringComparer.Ordinal);
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndObject)
                    {
                        return LocalizedInput.FromLocales(values);
                    }

                    if (reader.TokenType != JsonTokenType.PropertyName)
                    {
                        throw new JsonException("Expected a locale property name");
                    }

                    var rawKey = reader.GetString() ?? string.Empty;
                    // An unrecognised tag is preserved verbatim so TryResolve can name
                    // it in a 400 -- normalising it to null here would turn "pt" into
                    // an anonymous error the caller cannot act on.
                    var key = ContentLanguages.NormaliseLocale(rawKey) ?? rawKey.Trim().ToLowerInvariant();

                    reader.Read();
                    values[key] = reader.TokenType == JsonTokenType.Null ? null : reader.GetString();
                }

                throw new JsonException("Unterminated localized value object");
            }

            default:
                throw new JsonException($"Expected a string or a locale-keyed object, got {reader.TokenType}");
        }
    }

    public override void Write(Utf8JsonWriter writer, LocalizedInput value, JsonSerializerOptions options)
    {
        // Request-only type; serialised solely so tests can round-trip a request body.
        if (value.ByLocale is null)
        {
            writer.WriteStringValue(value.Bare);
            return;
        }

        writer.WriteStartObject();
        foreach (var (locale, text) in value.ByLocale)
        {
            writer.WritePropertyName(locale);
            writer.WriteStringValue(text);
        }

        writer.WriteEndObject();
    }
}
