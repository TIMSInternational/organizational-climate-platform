using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>Everything that makes up a survey's structure, as read from the database.</summary>
public sealed record SurveyStructure(
    Survey Survey,
    IReadOnlyList<Question> Questions,
    IReadOnlyList<QuestionOption> Options,
    IReadOnlyList<QuestionEmojiOption> EmojiOptions,
    IReadOnlyList<QuestionConditionalLogic> ConditionalLogic,
    IReadOnlyList<SurveyDepartmentTarget> DepartmentTargets);

/// <summary>Caller-supplied overrides for the copy. Anything null keeps the original's value.</summary>
public sealed record SurveyDuplicateOptions(
    string? TitleEn = null,
    string? TitleEs = null,
    DateTimeOffset? StartDate = null,
    DateTimeOffset? EndDate = null);

/// <summary>
/// The deep copy, as a pure function over entities.
///
/// Pure and in Application on purpose: the subtle guarantees here -- that both language
/// halves survive, that each option keeps its stable <see cref="QuestionOption.Value"/>,
/// and that conditional logic is re-pointed at the copy's own question ids -- are
/// assertable without a database, and a Testcontainers-only proof of them would be a
/// proof nobody runs on a laptop.
/// </summary>
public static class SurveyDuplication
{
    /// <summary>
    /// Produces the copy's rows. Nothing is persisted and no id is invented here beyond
    /// what the caller supplies, so the same call is deterministic in a test.
    /// </summary>
    /// <param name="newSurveyId">The copy's id.</param>
    /// <param name="createdBy">
    /// The user performing the duplication -- deliberately not the original's author. A
    /// copy is a new thing somebody made, and attributing it to whoever wrote the original
    /// would put a survey in a person's name that they never touched.
    /// </param>
    /// <param name="newQuestionId">
    /// Id factory for the copied questions. Injected so a test can assert the remapping
    /// with predictable ids rather than by elimination.
    /// </param>
    public static SurveyStructure Duplicate(
        SurveyStructure source,
        Guid newSurveyId,
        Guid createdBy,
        DateTimeOffset now,
        Func<Guid> newQuestionId,
        SurveyDuplicateOptions? overrides = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(newQuestionId);

        var original = source.Survey;
        var opts = overrides ?? new SurveyDuplicateOptions();

        var survey = new Survey
        {
            Id = newSurveyId,
            CompanyId = original.CompanyId,
            CreatedBy = createdBy,

            // BOTH halves, always. Copying only the locale the duplicating admin happens
            // to be viewing in would quietly downgrade a bilingual survey to monolingual
            // and then fail the publish gate for reasons the admin cannot see.
            TitleEn = opts.TitleEn ?? SurveyValidation.WithCopySuffix(original.TitleEn, SurveyValidation.CopySuffixEn),
            TitleEs = opts.TitleEs ?? SurveyValidation.WithCopySuffix(original.TitleEs, SurveyValidation.CopySuffixEs),
            DescriptionEn = original.DescriptionEn,
            DescriptionEs = original.DescriptionEs,
            Language = original.Language,

            Type = original.Type,
            StartDate = opts.StartDate ?? original.StartDate,
            EndDate = opts.EndDate ?? original.EndDate,

            // A copy is always a fresh draft with no history: never the original's status,
            // never its response count, never its version number.
            Status = SurveyStatuses.Draft,
            ResponseCount = 0,
            Version = 1,
            TargetAudienceCount = original.TargetAudienceCount,

            Settings = CopySettings(original.Settings),
            CreatedAt = now,
            UpdatedAt = now,
        };

        var questionIdMap = new Dictionary<Guid, Guid>();
        var questions = new List<Question>(source.Questions.Count);
        foreach (var question in source.Questions.OrderBy(q => q.Order))
        {
            var copyId = newQuestionId();
            questionIdMap[question.Id] = copyId;
            questions.Add(new Question
            {
                Id = copyId,
                SurveyId = newSurveyId,
                TextEn = question.TextEn,
                TextEs = question.TextEs,
                Type = question.Type,
                ScaleMin = question.ScaleMin,
                ScaleMax = question.ScaleMax,
                ScaleLabelMinEn = question.ScaleLabelMinEn,
                ScaleLabelMinEs = question.ScaleLabelMinEs,
                ScaleLabelMaxEn = question.ScaleLabelMaxEn,
                ScaleLabelMaxEs = question.ScaleLabelMaxEs,
                CommentRequired = question.CommentRequired,
                CommentPromptEn = question.CommentPromptEn,
                CommentPromptEs = question.CommentPromptEs,
                BinaryCommentConfigEn = question.BinaryCommentConfigEn,
                BinaryCommentConfigEs = question.BinaryCommentConfigEs,
                Required = question.Required,
                Order = question.Order,
                Category = question.Category,
                // Provenance travels with the copy. A duplicated survey really is another
                // use of the source question, so dropping these here would make the bank
                // under-report exactly the questions that are reused most (#110).
                SourceLibraryItemId = question.SourceLibraryItemId,
                SourceQuestionBankItemId = question.SourceQuestionBankItemId,
            });
        }

        // The load-bearing line of the whole endpoint. Value is what lands in
        // question_responses.response_value, so a copy that regenerated its option values
        // -- or derived them afresh from whichever label happened to be non-null -- would
        // produce a survey whose answers aggregate with nothing: no error, no constraint
        // violation, row counts that reconcile exactly, and every distribution, chart,
        // benchmark and export silently split in two.
        var options = source.Options
            .Where(o => questionIdMap.ContainsKey(o.QuestionId))
            .OrderBy(o => o.Order)
            .Select(o => new QuestionOption
            {
                QuestionId = questionIdMap[o.QuestionId],
                Order = o.Order,
                Value = o.Value,
                LabelEn = o.LabelEn,
                LabelEs = o.LabelEs,
            })
            .ToList();

        var emojiOptions = source.EmojiOptions
            .Where(e => questionIdMap.ContainsKey(e.QuestionId))
            .OrderBy(e => e.Order)
            .Select(e => new QuestionEmojiOption
            {
                QuestionId = questionIdMap[e.QuestionId],
                Order = e.Order,
                Emoji = e.Emoji,
                LabelEn = e.LabelEn,
                LabelEs = e.LabelEs,
                Value = e.Value,
            })
            .ToList();

        // Conditional logic points at other questions by id. Copying the rows verbatim
        // would leave the copy's branching wired to the ORIGINAL's questions -- a survey
        // whose "show if the previous answer was no" reads a different survey's question.
        // Any reference that does not resolve inside this survey becomes null rather than
        // a dangling FK.
        var conditionalLogic = source.ConditionalLogic
            .Where(c => questionIdMap.ContainsKey(c.QuestionId))
            .Select(c => new QuestionConditionalLogic
            {
                QuestionId = questionIdMap[c.QuestionId],
                ConditionQuestionId = Remap(questionIdMap, c.ConditionQuestionId),
                ConditionOperator = c.ConditionOperator,
                ConditionValue = c.ConditionValue,
                Action = c.Action,
                TargetQuestionId = Remap(questionIdMap, c.TargetQuestionId),
            })
            .ToList();

        var departmentTargets = source.DepartmentTargets
            .Select(t => new SurveyDepartmentTarget { SurveyId = newSurveyId, DepartmentId = t.DepartmentId })
            .ToList();

        // Responses, invitations, distributions, drafts, versions and audit logs are
        // absent by construction rather than by filter: they are not inputs to this
        // function, so there is no code path that could copy one.
        return new SurveyStructure(survey, questions, options, emojiOptions, conditionalLogic, departmentTargets);
    }

    private static Guid? Remap(IReadOnlyDictionary<Guid, Guid> map, Guid? id)
        => id.HasValue && map.TryGetValue(id.Value, out var copied) ? copied : null;

    private static SurveySettings CopySettings(SurveySettings s) => new()
    {
        Anonymous = s.Anonymous,
        AllowPartialResponses = s.AllowPartialResponses,
        RandomizeQuestions = s.RandomizeQuestions,
        ShowProgress = s.ShowProgress,
        AutoSave = s.AutoSave,
        TimeLimitMinutes = s.TimeLimitMinutes,
        ResponseLimit = s.ResponseLimit,
        NotificationSendInvitations = s.NotificationSendInvitations,
        NotificationSendReminders = s.NotificationSendReminders,
        NotificationReminderFrequencyDays = s.NotificationReminderFrequencyDays,
        // Both halves of the two Tier 1 fields that live in the settings blob -- these are
        // emailed to respondents, so dropping one language here would send an invitation
        // in the wrong one.
        InvitationCustomMessageEn = s.InvitationCustomMessageEn,
        InvitationCustomMessageEs = s.InvitationCustomMessageEs,
        InvitationIncludeCredentials = s.InvitationIncludeCredentials,
        InvitationSendImmediately = s.InvitationSendImmediately,
        InvitationCustomSubjectEn = s.InvitationCustomSubjectEn,
        InvitationCustomSubjectEs = s.InvitationCustomSubjectEs,
        InvitationBrandingEnabled = s.InvitationBrandingEnabled,
    };
}
