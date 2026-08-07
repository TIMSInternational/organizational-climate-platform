using System.Text.Json;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// What actually lives in <c>survey_drafts.draft_data</c>.
///
/// A draft is the survey wizard's scratchpad for a survey that does not exist yet --
/// note that <c>SurveyDraft</c> carries no <c>survey_id</c> at all. So there are no
/// paired <c>&lt;field&gt;_en</c>/<c>&lt;field&gt;_es</c> columns to author into, and
/// adding some would mean an EF migration for content that is by definition transient.
///
/// Instead the Tier 1 fields the server understands are lifted OUT of the opaque blob
/// into paired *keys*, which is the same design as #195's paired columns one level
/// down: storage is per-language, and <see cref="Resolve"/> is the single read-time
/// rule so that no draft read DTO is ever En/Es-shaped.
///
/// <see cref="Content"/> is the part the server deliberately does not interpret: step
/// state, selections, scroll position -- whatever the wizard needs to redraw itself. It
/// is round-tripped verbatim and never resolved, rendered or validated. Keeping it
/// opaque is what stops this file from becoming a second, drifting copy of the survey
/// create request.
/// </summary>
/// <param name="Language">'es' | 'en' | 'both'. Null only for a blob written before this envelope existed.</param>
/// <param name="Content">The wizard's own state, verbatim. Null when the draft has none yet.</param>
public sealed record SurveyDraftEnvelope(
    string? Language,
    string? TitleEn,
    string? TitleEs,
    string? DescriptionEn,
    string? DescriptionEs,
    JsonElement? Content)
{
    public static readonly SurveyDraftEnvelope Empty = new(null, null, null, null, null, null);
}

/// <summary>One draft's authored content resolved for one request locale. No En/Es members, by design.</summary>
public sealed record SurveyDraftResolvedContent(
    string? Title,
    string? Description,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields);

public static class SurveyDraftContent
{
    /// <summary>
    /// Bumped only if the envelope's shape changes incompatibly. Its presence is also the
    /// discriminator: a blob without it is a foreign/legacy payload and is treated as
    /// <see cref="SurveyDraftEnvelope.Content"/> in its entirety rather than being
    /// half-read as an envelope.
    /// </summary>
    public const int SchemaVersion = 1;

    private const string SchemaKey = "schema";
    private const string LanguageKey = "language";
    private const string TitleEnKey = "titleEn";
    private const string TitleEsKey = "titleEs";
    private const string DescriptionEnKey = "descriptionEn";
    private const string DescriptionEsKey = "descriptionEs";
    private const string ContentKey = "content";

    /// <summary>
    /// Reads a stored blob. Never throws: <c>draft_data</c> is jsonb so it is always
    /// syntactically valid, but a draft that fails to load is a draft the user cannot
    /// recover, which is the one failure this whole feature exists to prevent.
    /// </summary>
    public static SurveyDraftEnvelope Parse(string? draftData)
    {
        if (string.IsNullOrWhiteSpace(draftData))
        {
            return SurveyDraftEnvelope.Empty;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(draftData);
        }
        catch (JsonException)
        {
            return SurveyDraftEnvelope.Empty;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty(SchemaKey, out var schema)
                || schema.ValueKind != JsonValueKind.Number)
            {
                // Not ours. Hand the whole thing back as opaque content so an older draft
                // (or one written by the legacy app) still recovers -- losing it silently
                // would be exactly the data loss this feature exists to prevent.
                return SurveyDraftEnvelope.Empty with { Content = root.Clone() };
            }

            return new SurveyDraftEnvelope(
                ContentLanguages.NormaliseLanguage(StringOrNull(root, LanguageKey)),
                StringOrNull(root, TitleEnKey),
                StringOrNull(root, TitleEsKey),
                StringOrNull(root, DescriptionEnKey),
                StringOrNull(root, DescriptionEsKey),
                // A JSON null is absence, not a content value: Serialise writes the key
                // unconditionally so a stored envelope is legible in psql, and reading it
                // back as a JsonElement of kind Null would make an empty draft report a
                // content snapshot it does not have.
                root.TryGetProperty(ContentKey, out var content)
                && content.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null)
                    ? content.Clone()
                    : null);
        }
    }

    public static string Serialise(SurveyDraftEnvelope envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber(SchemaKey, SchemaVersion);
            WriteStringOrNull(writer, LanguageKey, envelope.Language);
            WriteStringOrNull(writer, TitleEnKey, envelope.TitleEn);
            WriteStringOrNull(writer, TitleEsKey, envelope.TitleEs);
            WriteStringOrNull(writer, DescriptionEnKey, envelope.DescriptionEn);
            WriteStringOrNull(writer, DescriptionEsKey, envelope.DescriptionEs);

            writer.WritePropertyName(ContentKey);
            if (envelope.Content is JsonElement content
                && content.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
            {
                content.WriteTo(writer);
            }
            else
            {
                writer.WriteNullValue();
            }

            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(buffer.ToArray());
    }

    /// <summary>
    /// Applies one save on top of the stored envelope.
    ///
    /// A null <paramref name="titleEn"/>/<paramref name="titleEs"/>/etc. means "the
    /// caller did not send this locale, leave it alone" -- the same
    /// omitted-vs-blanked distinction <see cref="LocalizedInput.TryResolve"/> already
    /// hands the survey endpoints, so clearing a translation stays an explicit empty
    /// string rather than an accident of a partial autosave.
    ///
    /// <paramref name="content"/> is a *replacement*, not a merge: it is a snapshot of
    /// the wizard's state, and deep-merging two snapshots of a tree the server does not
    /// understand is how a deleted question comes back from the dead. Omitted (null)
    /// still means leave alone.
    /// </summary>
    public static SurveyDraftEnvelope Merge(
        SurveyDraftEnvelope existing,
        string language,
        string? titleEn,
        string? titleEs,
        string? descriptionEn,
        string? descriptionEs,
        JsonElement? content)
    {
        ArgumentNullException.ThrowIfNull(existing);

        return new SurveyDraftEnvelope(
            language,
            titleEn ?? existing.TitleEn,
            titleEs ?? existing.TitleEs,
            descriptionEn ?? existing.DescriptionEn,
            descriptionEs ?? existing.DescriptionEs,
            content is JsonElement supplied
            && supplied.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null)
                ? supplied.Clone()
                : existing.Content);
    }

    /// <summary>
    /// The read-time rule, delegating to <see cref="LocalizedContent"/> so a draft and
    /// the survey it becomes resolve identically.
    ///
    /// <c>ResolvedLocale</c> names the locale the text is ACTUALLY in, not the one asked
    /// for: a Spanish-only draft fetched with <c>?lang=en</c> comes back in Spanish and
    /// says 'es'. The title carries the payload's identity, so it names the whole
    /// response; per-field divergence stays in <c>FallbackFields</c>.
    /// </summary>
    public static SurveyDraftResolvedContent Resolve(SurveyDraftEnvelope envelope, string? lang)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        var contentLanguage = envelope.Language;
        var locale = ContentLanguages.NormaliseLocale(lang)
                     ?? ContentLanguages.SingleLocaleOf(contentLanguage)
                     ?? ContentLanguages.FallbackLocale;

        var fallbackFields = new List<string>();

        var title = LocalizedContent.Resolve(envelope.TitleEn, envelope.TitleEs, locale, contentLanguage);
        if (title.IsFallback)
        {
            fallbackFields.Add("title");
        }

        var description = LocalizedContent.Resolve(envelope.DescriptionEn, envelope.DescriptionEs, locale, contentLanguage);
        if (description.IsFallback)
        {
            fallbackFields.Add("description");
        }

        return new SurveyDraftResolvedContent(
            title.Text,
            description.Text,
            title.ResolvedLocale ?? locale,
            fallbackFields);
    }

    /// <summary>
    /// What is still missing before the draft could become a publishable survey.
    ///
    /// Reported, never enforced. <see cref="ContentPublishValidation"/> says so in its own
    /// words -- autosave runs every few seconds and a blocking validator would fight it,
    /// and you have to be able to save a half-translated title in order to go and write
    /// the other half. The gate is on the survey's publish transition (#104); a draft only
    /// tells the wizard what to badge.
    ///
    /// Only the two fields the envelope actually owns are checked. Questions live in the
    /// opaque wizard state, and inventing a schema for them here would create a second
    /// copy of the survey create contract that drifts from the real one.
    /// </summary>
    public static IReadOnlyList<MissingTranslation> MissingTranslations(SurveyDraftEnvelope envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        return ContentPublishValidation.FindMissing(
            envelope.Language,
            [
                new LocalizedFieldValue("title", envelope.TitleEn, envelope.TitleEs, Required: true),
                new LocalizedFieldValue("description", envelope.DescriptionEn, envelope.DescriptionEs, Required: false),
            ]);
    }

    private static string? StringOrNull(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static void WriteStringOrNull(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null)
        {
            writer.WriteNull(name);
        }
        else
        {
            writer.WriteString(name, value);
        }
    }
}
