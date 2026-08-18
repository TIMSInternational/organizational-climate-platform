using System.Text.Json;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>
/// The #332 default-scrub rules, shared by every mapper that fans a legacy question
/// subdocument out (Survey today, SurveyTemplate beside it). One implementation on
/// purpose: two copies of "equal to the baked-in default means never authored" is how
/// the survey and template halves would silently drift into disagreeing about which
/// prompts are real - the same argument MigrationIds makes for the v5 derivation.
/// </summary>
internal static class QuestionContentRules
{
    // Mongoose applied these at write time, so nearly every legacy question document
    // carries them; equality with the literal means "never authored" (#332's rule).
    public const string LegacyCommentPromptDefault = "Please explain your answer:";
    public const string LegacyBinaryLabelDefault = "Please explain your answer";
    public const string LegacyBinaryPlaceholderDefault = "Enter your explanation here...";

    public static string? ScrubbedCommentPrompt(
        string? raw, string collection, string legacyId, string field, DataQualityReport report)
    {
        var prompt = MapperHelpers.Trimmed(raw);
        if (prompt is null)
        {
            return null;
        }

        if (prompt == LegacyCommentPromptDefault)
        {
            report.Normalisation(MigrationRules.CommentPromptDefaultScrubbed, collection, legacyId,
                $"{field}.comment_prompt",
                "value equals the legacy DDL default, which Mongoose baked into every question; not authored content");
            return null;
        }

        return MapperHelpers.Truncated(prompt, 500, collection, legacyId, $"{field}.comment_prompt", report);
    }

    public static string? ScrubbedBinaryConfig(
        LegacyBinaryCommentConfig? config, string collection, string legacyId, string field, DataQualityReport report)
    {
        if (config is null)
        {
            return null;
        }

        var allDefaults =
            config.Enabled is null or false
            && (config.Label is null || config.Label == LegacyBinaryLabelDefault)
            && (config.Placeholder is null || config.Placeholder == LegacyBinaryPlaceholderDefault)
            && config.MaxLength is null or 500
            && config.Required is null or false
            && config.MinLength is null or 0;
        if (allDefaults)
        {
            report.Normalisation(MigrationRules.BinaryCommentConfigDefaultScrubbed, collection, legacyId,
                $"{field}.binary_comment_config",
                "every field equals its legacy DDL default; the config was never authored");
            return null;
        }

        // The column is jsonb with no other producer yet; the legacy subdocument's own
        // field names are the canonical encoding, present fields only.
        var payload = new Dictionary<string, object>();
        if (config.Enabled is { } enabled) payload["enabled"] = enabled;
        if (config.Label is { } label) payload["label"] = label;
        if (config.Placeholder is { } placeholder) payload["placeholder"] = placeholder;
        if (config.MaxLength is { } maxLength) payload["max_length"] = maxLength;
        if (config.Required is { } required) payload["required"] = required;
        if (config.MinLength is { } minLength) payload["min_length"] = minLength;
        return JsonSerializer.Serialize(payload);
    }
}
