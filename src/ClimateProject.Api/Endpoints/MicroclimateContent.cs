using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

// Content-i18n helpers for the microclimate surface (#195), split out of
// MicroclimateEndpoints so the resolution rule, the option loader and the publish
// gate each have one implementation rather than one per handler.
internal static class MicroclimateContent
{
    /// <summary>
    /// The locale a read is served in.
    ///
    /// The only route an anonymous respondent reaches is the public respond page, and
    /// web/src/i18n/README.md already anticipated this: "If that becomes a
    /// requirement, add a ?lang= query parameter read by detectLocale, rather than
    /// restructuring the router." Under #195 it does become a requirement -- an
    /// invited respondent must be served the survey in their language before they
    /// have any preference stored.
    ///
    /// Falls back to the content's own single language rather than to English, so a
    /// Spanish-only microclimate opened without ?lang= renders in Spanish.
    /// </summary>
    public static string ResolveRequestLocale(string? lang, string? contentLanguage)
        => ContentLanguages.NormaliseLocale(lang)
           ?? ContentLanguages.SingleLocaleOf(contentLanguage)
           ?? ContentLanguages.FallbackLocale;

    /// <summary>
    /// Loads the stable-value option rows for a set of questions, ordered, as a
    /// lookup. One query for the whole page rather than one per question.
    /// </summary>
    public static async Task<Dictionary<Guid, List<MicroclimateQuestionOption>>> LoadOptionsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> questionIds,
        CancellationToken cancellationToken)
    {
        if (questionIds.Count == 0)
        {
            return [];
        }

        var rows = await db.MicroclimateQuestionOptions
            .Where(o => questionIds.Contains(o.MicroclimateQuestionId))
            .OrderBy(o => o.Order)
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(o => o.MicroclimateQuestionId)
            .ToDictionary(g => g.Key, g => g.ToList());
    }

    /// <summary>
    /// The emoji-scale rows for a set of questions, ordered, as a lookup (#198). One
    /// query for the whole page, exactly like <see cref="LoadOptionsAsync"/> -- and a
    /// second query rather than a join, because only <c>emoji_rating</c> questions have
    /// any of these rows and most pages have none at all.
    /// </summary>
    public static async Task<Dictionary<Guid, List<MicroclimateQuestionEmojiOption>>> LoadEmojiOptionsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> questionIds,
        CancellationToken cancellationToken)
    {
        if (questionIds.Count == 0)
        {
            return [];
        }

        var rows = await db.MicroclimateQuestionEmojiOptions
            .Where(o => questionIds.Contains(o.MicroclimateQuestionId))
            .OrderBy(o => o.Order)
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(o => o.MicroclimateQuestionId)
            .ToDictionary(g => g.Key, g => g.ToList());
    }

    /// <summary>
    /// The emoji scale as a respondent's client receives it: glyph, stable value, and
    /// the resolved label that is the option's accessible name.
    /// </summary>
    /// <remarks>
    /// A label that had to fall back to the other language self-reports through
    /// <paramref name="fallbackFields"/> like every other localized field. It matters
    /// more here than elsewhere: the label is not decoration on this control, it is the
    /// only thing a screen reader has to go on, so a silent substitution would hand a
    /// respondent an English word on a Spanish scale with nothing saying so.
    /// </remarks>
    public static List<QuestionEmojiOptionDto>? ToEmojiOptionDtos(
        List<MicroclimateQuestionEmojiOption>? options,
        string locale,
        string contentLanguage,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options is null || options.Count == 0)
        {
            return null;
        }

        var dtos = new List<QuestionEmojiOptionDto>(options.Count);
        foreach (var option in options)
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, contentLanguage);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.emojiOptions[{option.Order}].label");
            }

            dtos.Add(new QuestionEmojiOptionDto(option.Order, option.Emoji, option.Value, label.Text));
        }

        return dtos;
    }

    public static List<QuestionOptionDto>? ToOptionDtos(
        List<MicroclimateQuestionOption>? options,
        string locale,
        string contentLanguage,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options is null || options.Count == 0)
        {
            return null;
        }

        var dtos = new List<QuestionOptionDto>(options.Count);
        foreach (var option in options)
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, contentLanguage);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.options[{option.Order}].label");
            }

            dtos.Add(new QuestionOptionDto(option.Order, option.Value, label.Text));
        }

        return dtos;
    }

    /// <summary>
    /// Resolves a localized field and records it in <paramref name="fallbackFields"/>
    /// if it had to reach for another language.
    /// </summary>
    public static string? Resolve(
        string? en,
        string? es,
        string locale,
        string contentLanguage,
        string fieldPath,
        List<string> fallbackFields)
    {
        var resolved = LocalizedContent.Resolve(en, es, locale, contentLanguage);
        if (resolved.IsFallback)
        {
            fallbackFields.Add(fieldPath);
        }

        return resolved.Text;
    }

    /// <summary>
    /// Every Tier 1 field on a microclimate, flattened for the publish gate. Options
    /// are included: an unlabelled option is an unanswerable question, and it is
    /// exactly the kind of gap a read-time fallback would paper over.
    /// </summary>
    /// <param name="emojiOptionsByQuestion">
    /// The emoji scales (#198). Their labels are gated on exactly the same footing as
    /// the plain option labels, and for a stronger reason: on an emoji control the
    /// label is the only accessible name there is, so an untranslated one is not a
    /// cosmetic gap but a scale a Spanish respondent using a screen reader cannot
    /// answer.
    /// </param>
    public static IReadOnlyList<LocalizedFieldValue> GateFields(
        Microclimate microclimate,
        IReadOnlyList<MicroclimateQuestion> questions,
        IReadOnlyDictionary<Guid, List<MicroclimateQuestionOption>> optionsByQuestion,
        IReadOnlyDictionary<Guid, List<MicroclimateQuestionEmojiOption>>? emojiOptionsByQuestion = null)
    {
        var fields = new List<LocalizedFieldValue>
        {
            new("title", microclimate.TitleEn, microclimate.TitleEs, Required: true),
            new("description", microclimate.DescriptionEn, microclimate.DescriptionEs, Required: false),
        };

        foreach (var question in questions.OrderBy(q => q.Order))
        {
            fields.Add(new LocalizedFieldValue($"questions[{question.Order}].text", question.TextEn, question.TextEs, Required: true));

            if (optionsByQuestion.TryGetValue(question.Id, out var options))
            {
                foreach (var option in options)
                {
                    fields.Add(new LocalizedFieldValue(
                        $"questions[{question.Order}].options[{option.Order}].label",
                        option.LabelEn,
                        option.LabelEs,
                        Required: true));
                }
            }

            if (emojiOptionsByQuestion is not null
                && emojiOptionsByQuestion.TryGetValue(question.Id, out var emojiOptions))
            {
                foreach (var option in emojiOptions)
                {
                    fields.Add(new LocalizedFieldValue(
                        $"questions[{question.Order}].emojiOptions[{option.Order}].label",
                        option.LabelEn,
                        option.LabelEs,
                        Required: true));
                }
            }
        }

        return fields;
    }

    /// <summary>
    /// Derives an option's stable value when the caller did not supply one: the
    /// English label, else the Spanish one.
    ///
    /// This is the same rule the migration applies to existing <c>text[]</c> options
    /// (value := the option text verbatim), which is what makes existing
    /// <c>response_value</c> rows keep matching without a data backfill. Deriving it
    /// rather than generating an opaque id also keeps the value readable in an export.
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
}
