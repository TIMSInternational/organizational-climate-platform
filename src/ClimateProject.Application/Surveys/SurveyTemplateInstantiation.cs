using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>Everything that makes up a template's structure, as read from the database.</summary>
public sealed record SurveyTemplateStructure(
    SurveyTemplate Template,
    IReadOnlyList<TemplateQuestion> Questions,
    IReadOnlyList<TemplateQuestionOption> Options);

/// <summary>
/// The language a template's content is actually authored in.
///
/// Inferred rather than stored, because <c>survey_templates</c> has no language column
/// and this wave adds no migration. Inference is not a workaround here so much as the
/// honest answer: a template has no publish gate of its own, so the only meaningful
/// statement about its language is what its rows contain.
/// </summary>
public static class SurveyTemplateLanguage
{
    /// <summary>
    /// Keyed on question TEXT alone, deliberately.
    ///
    /// <c>comment_prompt_en</c>/<c>_es</c> both carry NOT NULL database defaults (#195
    /// added the Spanish one precisely because the single shared column served an English
    /// prompt to Spanish-only content), so every row has both and inferring from them
    /// would report every template on earth as bilingual. Scale and option labels are
    /// optional decoration; text is the field the publish gate marks Required, and it is
    /// the field a template exists to carry.
    /// </summary>
    /// <returns>
    /// 'en', 'es' or 'both' -- or null when the template has no authored question text at
    /// all, which is a genuinely unanswerable question the caller must decide for itself
    /// rather than have guessed.
    /// </returns>
    public static string? Infer(IEnumerable<TemplateQuestion> questions)
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

/// <summary>Everything the caller decides about the survey a template becomes.</summary>
public sealed record SurveyInstantiationOptions(
    Guid CompanyId,
    Guid CreatedBy,
    string Type,
    string Language,
    string? TitleEn,
    string? TitleEs,
    string? DescriptionEn,
    string? DescriptionEs,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    int? TargetAudienceCount = null,
    IReadOnlyList<Guid>? DepartmentIds = null);

/// <summary>
/// Template -> survey, as a pure function over entities.
///
/// Pure and in Application for the same reason <see cref="SurveyDuplication"/> is: the
/// two guarantees that actually matter -- that BOTH language halves cross over, and that
/// every option keeps its stable <see cref="TemplateQuestionOption.Value"/> -- are
/// assertable without a database, and a Testcontainers-only proof of them is a proof
/// nobody runs on a laptop.
/// </summary>
public static class SurveyTemplateInstantiation
{
    public static SurveyStructure Instantiate(
        SurveyTemplateStructure source,
        Guid newSurveyId,
        DateTimeOffset now,
        Func<Guid> newQuestionId,
        SurveyInstantiationOptions options)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(newQuestionId);
        ArgumentNullException.ThrowIfNull(options);

        var survey = new Survey
        {
            Id = newSurveyId,
            CompanyId = options.CompanyId,
            CreatedBy = options.CreatedBy,
            TitleEn = options.TitleEn,
            TitleEs = options.TitleEs,
            DescriptionEn = options.DescriptionEn,
            DescriptionEs = options.DescriptionEs,
            Language = options.Language,
            Type = options.Type,
            StartDate = options.StartDate,
            EndDate = options.EndDate,

            // A survey from a template is always a fresh draft. Templates carry a
            // UsageCount and a Rating; a survey inherits neither, and it certainly does
            // not inherit a status.
            Status = SurveyStatuses.Draft,
            ResponseCount = 0,
            Version = 1,
            TargetAudienceCount = options.TargetAudienceCount,
            CreatedAt = now,
            UpdatedAt = now,
        };

        var questionIdMap = new Dictionary<Guid, Guid>();
        var questions = new List<Question>(source.Questions.Count);
        foreach (var templateQuestion in source.Questions.OrderBy(q => q.Order))
        {
            var questionId = newQuestionId();
            questionIdMap[templateQuestion.Id] = questionId;
            questions.Add(new Question
            {
                Id = questionId,
                SurveyId = newSurveyId,

                // BOTH halves, always -- exactly as duplication must. Carrying only the
                // locale the instantiating admin happens to be viewing in would quietly
                // downgrade a bilingual template to a monolingual survey, and the loss
                // would surface much later as a publish gate failing for content the
                // template demonstrably had.
                TextEn = templateQuestion.TextEn,
                TextEs = templateQuestion.TextEs,
                Type = templateQuestion.Type,
                ScaleMin = templateQuestion.ScaleMin,
                ScaleMax = templateQuestion.ScaleMax,
                ScaleLabelMinEn = templateQuestion.ScaleLabelMinEn,
                ScaleLabelMinEs = templateQuestion.ScaleLabelMinEs,
                ScaleLabelMaxEn = templateQuestion.ScaleLabelMaxEn,
                ScaleLabelMaxEs = templateQuestion.ScaleLabelMaxEs,
                CommentRequired = templateQuestion.CommentRequired,
                CommentPromptEn = templateQuestion.CommentPromptEn,
                CommentPromptEs = templateQuestion.CommentPromptEs,
                BinaryCommentConfigEn = templateQuestion.BinaryCommentConfigEn,
                BinaryCommentConfigEs = templateQuestion.BinaryCommentConfigEs,
                Required = templateQuestion.Required,
                Order = templateQuestion.Order,
                Category = templateQuestion.Category,
            });
        }

        // The load-bearing line, same as in SurveyDuplication. Value is what lands in
        // question_responses.response_value and what aggregation joins on, so an
        // instantiation that regenerated option values -- or re-derived them from
        // whichever label happened to be non-null -- would produce surveys whose answers
        // aggregate with nothing and with each other: no error, no constraint violation,
        // row counts reconciling exactly, and every distribution, chart, benchmark and
        // export silently split per instantiation. That failure is worse from a template
        // than from a duplicate, because a template is instantiated many times.
        var questionOptions = source.Options
            .Where(o => questionIdMap.ContainsKey(o.TemplateQuestionId))
            .OrderBy(o => o.Order)
            .Select(o => new QuestionOption
            {
                QuestionId = questionIdMap[o.TemplateQuestionId],
                Order = o.Order,
                Value = o.Value,
                LabelEn = o.LabelEn,
                LabelEs = o.LabelEs,
            })
            .ToList();

        var departmentTargets = (options.DepartmentIds ?? [])
            .Distinct()
            .Select(id => new SurveyDepartmentTarget { SurveyId = newSurveyId, DepartmentId = id })
            .ToList();

        // Emoji options and conditional logic are empty by construction rather than by
        // filter: template_questions has no emoji or branching child table, so there is
        // nothing to copy. When #196 widens the vocabulary the storage has to come first.
        return new SurveyStructure(survey, questions, questionOptions, [], [], departmentTargets);
    }
}
