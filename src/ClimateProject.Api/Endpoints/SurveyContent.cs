using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

// Content-i18n helpers for the survey surface (#195/#104), split out of SurveyEndpoints
// so the resolution rule, the option loader and the publish gate each have one
// implementation rather than one per handler. Deliberately parallel to
// MicroclimateContent: the two surfaces resolve authored content identically, and the
// day they stop doing so is the day one of them starts lying about a fallback.
internal static class SurveyContent
{
    /// <summary>
    /// The locale a read is served in. Falls back to the survey's own single language
    /// rather than to English, so a Spanish-only survey opened without <c>?lang=</c>
    /// renders in Spanish.
    /// </summary>
    public static string ResolveRequestLocale(string? lang, string? contentLanguage)
        => ContentLanguages.NormaliseLocale(lang)
           ?? ContentLanguages.SingleLocaleOf(contentLanguage)
           ?? ContentLanguages.FallbackLocale;

    /// <summary>
    /// Resolves a localized field and records it in <paramref name="fallbackFields"/> if
    /// it had to reach for another language.
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
    /// Loads the stable-value option rows for a set of questions, ordered, as a lookup.
    /// One query for the whole survey rather than one per question.
    /// </summary>
    public static async Task<Dictionary<Guid, List<QuestionOption>>> LoadOptionsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> questionIds,
        CancellationToken cancellationToken)
    {
        if (questionIds.Count == 0)
        {
            return [];
        }

        var rows = await db.QuestionOptions
            .Where(o => questionIds.Contains(o.QuestionId))
            .OrderBy(o => o.Order)
            .ToListAsync(cancellationToken);

        return rows.GroupBy(o => o.QuestionId).ToDictionary(g => g.Key, g => g.ToList());
    }

    public static List<SurveyQuestionOptionDto>? ToOptionDtos(
        List<QuestionOption>? options,
        string locale,
        string contentLanguage,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options is null || options.Count == 0)
        {
            return null;
        }

        var dtos = new List<SurveyQuestionOptionDto>(options.Count);
        foreach (var option in options)
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, contentLanguage);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.options[{option.Order}].label");
            }

            dtos.Add(new SurveyQuestionOptionDto(option.Order, option.Value, label.Text));
        }

        return dtos;
    }

    /// <summary>
    /// Every Tier 1 field on a survey, flattened for the publish gate.
    ///
    /// Options are included and Required: an unlabelled option is an unanswerable
    /// question, and it is exactly the kind of gap a read-time fallback would paper over.
    /// The two invitation strings are included as optional because they are emailed to
    /// respondents -- a survey published as 'both' whose invitation exists only in
    /// English mails half its audience in the wrong language, which is the same defect as
    /// an untranslated question wearing a different hat.
    /// </summary>
    public static IReadOnlyList<LocalizedFieldValue> GateFields(
        Survey survey,
        IReadOnlyList<Question> questions,
        IReadOnlyDictionary<Guid, List<QuestionOption>> optionsByQuestion)
    {
        var fields = new List<LocalizedFieldValue>
        {
            new("title", survey.TitleEn, survey.TitleEs, Required: true),
            new("description", survey.DescriptionEn, survey.DescriptionEs, Required: false),
            new(
                "settings.invitationCustomSubject",
                survey.Settings.InvitationCustomSubjectEn,
                survey.Settings.InvitationCustomSubjectEs,
                Required: false),
            new(
                "settings.invitationCustomMessage",
                survey.Settings.InvitationCustomMessageEn,
                survey.Settings.InvitationCustomMessageEs,
                Required: false),
        };

        foreach (var question in questions.OrderBy(q => q.Order))
        {
            var path = $"questions[{question.Order}]";
            fields.Add(new LocalizedFieldValue($"{path}.text", question.TextEn, question.TextEs, Required: true));
            fields.Add(new LocalizedFieldValue($"{path}.scaleLabelMin", question.ScaleLabelMinEn, question.ScaleLabelMinEs, Required: false));
            fields.Add(new LocalizedFieldValue($"{path}.scaleLabelMax", question.ScaleLabelMaxEn, question.ScaleLabelMaxEs, Required: false));

            if (!optionsByQuestion.TryGetValue(question.Id, out var options))
            {
                continue;
            }

            foreach (var option in options)
            {
                fields.Add(new LocalizedFieldValue(
                    $"{path}.options[{option.Order}].label",
                    option.LabelEn,
                    option.LabelEs,
                    Required: true));
            }
        }

        return fields;
    }

    /// <summary>
    /// Derives an option's stable value when the caller did not supply one: the English
    /// label, else the Spanish one. Identical to the microclimate rule and to the rule
    /// #195's migration applied to the old <c>text[]</c> options, which is what keeps
    /// existing <c>response_value</c> rows matching without a data backfill.
    /// </summary>
    /// <remarks>
    /// Moved to <see cref="SurveyValidation.DeriveOptionValue"/> by #107 so the survey and
    /// survey-template write paths share one implementation; kept here as a delegating
    /// alias so existing call sites read the same.
    /// </remarks>
    public static string? DeriveOptionValue(string? explicitValue, string? labelEn, string? labelEs)
        => SurveyValidation.DeriveOptionValue(explicitValue, labelEn, labelEs);
}
