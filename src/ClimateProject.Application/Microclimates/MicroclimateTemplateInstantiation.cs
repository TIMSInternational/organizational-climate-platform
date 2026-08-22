using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Microclimates;

/// <summary>Everything that makes up a microclimate template's structure, as read from the database.</summary>
public sealed record MicroclimateTemplateStructure(
    MicroclimateTemplate Template,
    IReadOnlyList<MicroclimateTemplateQuestion> Questions,
    IReadOnlyList<MicroclimateTemplateQuestionOption> Options);

/// <summary>Everything the caller decides about the microclimate a template becomes.</summary>
public sealed record MicroclimateInstantiationOptions(
    Guid CompanyId,
    Guid CreatedBy,
    string Language,
    string? TitleEn,
    string? TitleEs,
    string? DescriptionEn,
    string? DescriptionEs,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    string Timezone,
    int TargetParticipantCount,
    bool AnonymousResponses,
    bool ShowLiveResults);

/// <summary>The rows a single instantiation produces. Nothing is saved by this type.</summary>
public sealed record MicroclimateInstantiationResult(
    Microclimate Microclimate,
    IReadOnlyList<MicroclimateQuestion> Questions,
    IReadOnlyList<MicroclimateQuestionOption> Options);

/// <summary>
/// The language a microclimate template's content is actually authored in.
/// </summary>
/// <remarks>
/// Inferred rather than stored, because <c>microclimate_templates</c> has no language column
/// and #131 adds no migration. The counterpart of <c>SurveyTemplateLanguage</c>, keyed on
/// question TEXT alone for the same reason: option labels are optional decoration, text is
/// the field the publish gate marks Required and the field a template exists to carry.
/// </remarks>
public static class MicroclimateTemplateLanguage
{
    /// <returns>
    /// 'en', 'es' or 'both' -- or null when the template has no authored question text at
    /// all, which is a genuinely unanswerable question the caller must decide for itself
    /// rather than have guessed.
    /// </returns>
    public static string? Infer(IEnumerable<MicroclimateTemplateQuestion> questions)
    {
        ArgumentNullException.ThrowIfNull(questions);

        var hasEnglish = false;
        var hasSpanish = false;
        foreach (var question in questions)
        {
            hasEnglish |= !string.IsNullOrWhiteSpace(question.TextEn);
            hasSpanish |= !string.IsNullOrWhiteSpace(question.TextEs);
        }

        return (hasEnglish, hasSpanish) switch
        {
            (true, true) => ContentLanguages.Both,
            (true, false) => ContentLanguages.English,
            (false, true) => ContentLanguages.Spanish,
            _ => null,
        };
    }
}

/// <summary>
/// Turns a microclimate template into a new draft microclimate.
/// </summary>
/// <remarks>
/// <para>
/// <b>A COPY, never a reference.</b> Every question and option row is a fresh row with a
/// fresh id. Editing the template afterwards must not reach into a microclimate already
/// created from it, and -- more sharply -- must never change what a respondent was asked
/// after they answered. This is the same rule <c>SurveyTemplateInstantiation</c> follows and
/// the same one <c>MicroclimateQuestion.SourceLibraryItemId</c> records for the library
/// picker.
/// </para>
/// <para>
/// <b>Option VALUES are preserved verbatim.</b> The stable value is what a submitted answer
/// is validated against and stored as, so carrying it across unchanged is what lets two
/// microclimates run from one template aggregate together. Regenerating values here would
/// produce sessions whose answers are individually valid and collectively incomparable.
/// </para>
/// <para>
/// Pure: takes the ids and the clock as parameters and saves nothing, so the whole mapping is
/// unit-testable without Docker.
/// </para>
/// </remarks>
public static class MicroclimateTemplateInstantiation
{
    public static MicroclimateInstantiationResult Instantiate(
        MicroclimateTemplateStructure structure,
        Guid microclimateId,
        DateTimeOffset now,
        Func<Guid> newQuestionId,
        MicroclimateInstantiationOptions options)
    {
        ArgumentNullException.ThrowIfNull(structure);
        ArgumentNullException.ThrowIfNull(newQuestionId);
        ArgumentNullException.ThrowIfNull(options);

        var microclimate = new Microclimate
        {
            Id = microclimateId,
            TitleEn = options.TitleEn,
            TitleEs = options.TitleEs,
            DescriptionEn = options.DescriptionEn,
            DescriptionEs = options.DescriptionEs,
            Language = options.Language,
            CompanyId = options.CompanyId,
            CreatedBy = options.CreatedBy,
            TemplateId = structure.Template.Id,
            Status = MicroclimateStatuses.Draft,
            ResponseCount = 0,
            TargetParticipantCount = options.TargetParticipantCount,
            Scheduling = new MicroclimateScheduling
            {
                StartTime = options.StartTime,
                EndTime = options.EndTime,
                Timezone = options.Timezone,
            },
            RealtimeSettings = new MicroclimateRealtimeSettings
            {
                AnonymousResponses = options.AnonymousResponses,
                ShowLiveResults = options.ShowLiveResults,
            },
            Targeting = new MicroclimateTargeting
            {
                MaxParticipants = structure.Template.Settings.MaxParticipants,
            },
            CreatedAt = now,
            UpdatedAt = now,
        };

        var optionsByQuestion = structure.Options
            .GroupBy(o => o.MicroclimateTemplateQuestionId)
            .ToDictionary(g => g.Key, g => g.OrderBy(o => o.Order).ToList());

        var questions = new List<MicroclimateQuestion>(structure.Questions.Count);
        var questionOptions = new List<MicroclimateQuestionOption>();

        foreach (var templateQuestion in structure.Questions.OrderBy(q => q.Order))
        {
            var questionId = newQuestionId();
            questions.Add(new MicroclimateQuestion
            {
                Id = questionId,
                MicroclimateId = microclimateId,
                TextEn = templateQuestion.TextEn,
                TextEs = templateQuestion.TextEs,
                Type = templateQuestion.Type,
                Required = templateQuestion.Required,
                Order = templateQuestion.Order,
            });

            if (!optionsByQuestion.TryGetValue(templateQuestion.Id, out var templateOptions))
            {
                continue;
            }

            foreach (var templateOption in templateOptions)
            {
                questionOptions.Add(new MicroclimateQuestionOption
                {
                    MicroclimateQuestionId = questionId,
                    Order = templateOption.Order,
                    Value = templateOption.Value,
                    LabelEn = templateOption.LabelEn,
                    LabelEs = templateOption.LabelEs,
                });
            }
        }

        return new MicroclimateInstantiationResult(microclimate, questions, questionOptions);
    }
}
