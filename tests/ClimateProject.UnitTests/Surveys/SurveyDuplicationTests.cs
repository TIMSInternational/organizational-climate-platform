using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyDuplicationTests
{
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OriginalAuthorId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid DuplicatingAdminId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid DepartmentId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid OriginalSurveyId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid CopySurveyId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid TriggerQuestionId = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid BranchQuestionId = Guid.Parse("88888888-8888-8888-8888-888888888888");
    private static readonly DateTimeOffset Now = new(2026, 8, 5, 12, 0, 0, TimeSpan.Zero);

    // Deterministic id factory so the remapping assertions name the ids they expect
    // instead of proving them by elimination.
    private static Func<Guid> SequentialIds(params Guid[] ids)
    {
        var queue = new Queue<Guid>(ids);
        return queue.Dequeue;
    }

    private static readonly Guid CopiedTriggerId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid CopiedBranchId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");

    private static SurveyStructure BilingualSource()
    {
        var survey = new Survey
        {
            Id = OriginalSurveyId,
            CompanyId = CompanyId,
            CreatedBy = OriginalAuthorId,
            TitleEn = "Q3 Climate Survey",
            TitleEs = "Encuesta de Clima Q3",
            DescriptionEn = "How the team is doing",
            DescriptionEs = "Como va el equipo",
            Language = "both",
            Type = "general_climate",
            StartDate = Now,
            EndDate = Now.AddDays(14),
            Status = "closed",
            ResponseCount = 137,
            TargetAudienceCount = 200,
            Version = 4,
            CreatedAt = Now.AddDays(-30),
            UpdatedAt = Now.AddDays(-1),
            Settings = new SurveySettings
            {
                Anonymous = true,
                TimeLimitMinutes = 20,
                ResponseLimit = 500,
                NotificationReminderFrequencyDays = 7,
                InvitationCustomMessageEn = "Please take our survey",
                InvitationCustomMessageEs = "Por favor responde nuestra encuesta",
                InvitationCustomSubjectEn = "Your voice matters",
                InvitationCustomSubjectEs = "Tu voz importa",
                InvitationBrandingEnabled = true,
            },
        };

        var trigger = new Question
        {
            Id = TriggerQuestionId,
            SurveyId = OriginalSurveyId,
            TextEn = "Are you satisfied?",
            TextEs = "Estas satisfecho?",
            Type = QuestionTypes.YesNo,
            Order = 0,
            Required = true,
            CommentPromptEn = "Tell us more:",
            CommentPromptEs = "Cuentanos mas:",
        };

        var branch = new Question
        {
            Id = BranchQuestionId,
            SurveyId = OriginalSurveyId,
            TextEn = "Which area needs the most work?",
            TextEs = "Que area necesita mas trabajo?",
            Type = QuestionTypes.MultipleChoice,
            Order = 1,
            ScaleMin = 1,
            ScaleMax = 5,
            ScaleLabelMinEn = "Poor",
            ScaleLabelMinEs = "Malo",
            ScaleLabelMaxEn = "Excellent",
            ScaleLabelMaxEs = "Excelente",
            Category = "engagement",
        };

        var options = new List<QuestionOption>
        {
            new() { QuestionId = BranchQuestionId, Order = 0, Value = "leadership", LabelEn = "Leadership", LabelEs = "Liderazgo" },
            new() { QuestionId = BranchQuestionId, Order = 1, Value = "tooling", LabelEn = "Tooling", LabelEs = "Herramientas" },
        };

        var emoji = new List<QuestionEmojiOption>
        {
            new() { QuestionId = TriggerQuestionId, Order = 0, Emoji = "\U0001F600", LabelEn = "Great", LabelEs = "Genial", Value = 5 },
        };

        var logic = new List<QuestionConditionalLogic>
        {
            new()
            {
                QuestionId = BranchQuestionId,
                ConditionQuestionId = TriggerQuestionId,
                ConditionOperator = "equals",
                ConditionValue = "\"no\"",
                Action = "show",
                TargetQuestionId = BranchQuestionId,
            },
        };

        var targets = new List<SurveyDepartmentTarget>
        {
            new() { SurveyId = OriginalSurveyId, DepartmentId = DepartmentId },
        };

        return new SurveyStructure(survey, [trigger, branch], options, emoji, logic, targets);
    }

    private static SurveyStructure DuplicateSource(SurveyDuplicateOptions? overrides = null)
        => SurveyDuplication.Duplicate(
            BilingualSource(),
            CopySurveyId,
            DuplicatingAdminId,
            Now,
            SequentialIds(CopiedTriggerId, CopiedBranchId),
            overrides);

    // ------------------------------------------------------------------
    // The subtle part: stable option values.
    // ------------------------------------------------------------------

    [Fact]
    public void Option_rows_keep_their_stable_value_so_the_copys_responses_still_aggregate()
    {
        var copy = DuplicateSource();

        Assert.Equal(
            ["leadership", "tooling"],
            copy.Options.OrderBy(o => o.Order).Select(o => o.Value));
    }

    [Fact]
    public void Option_rows_keep_both_label_halves_and_their_order()
    {
        var copy = DuplicateSource();
        var options = copy.Options.OrderBy(o => o.Order).ToList();

        Assert.Equal(2, options.Count);
        Assert.Equal(("Leadership", "Liderazgo"), (options[0].LabelEn, options[0].LabelEs));
        Assert.Equal(("Tooling", "Herramientas"), (options[1].LabelEn, options[1].LabelEs));
        Assert.Equal([0, 1], options.Select(o => o.Order));
    }

    [Fact]
    public void Option_rows_are_repointed_at_the_copys_own_questions()
    {
        var copy = DuplicateSource();

        Assert.All(copy.Options, o => Assert.Equal(CopiedBranchId, o.QuestionId));
        Assert.DoesNotContain(copy.Options, o => o.QuestionId == BranchQuestionId);
    }

    // ------------------------------------------------------------------
    // Both language halves survive.
    // ------------------------------------------------------------------

    [Fact]
    public void Both_title_halves_are_copied_and_each_gets_its_own_locales_suffix()
    {
        var copy = DuplicateSource();

        Assert.Equal("Q3 Climate Survey (Copy)", copy.Survey.TitleEn);
        Assert.Equal("Encuesta de Clima Q3 (Copia)", copy.Survey.TitleEs);
    }

    [Fact]
    public void A_monolingual_surveys_unauthored_half_stays_null_rather_than_becoming_a_bare_suffix()
    {
        var source = BilingualSource();
        source.Survey.TitleEs = null;
        source.Survey.Language = "en";

        var copy = SurveyDuplication.Duplicate(
            source, CopySurveyId, DuplicatingAdminId, Now, SequentialIds(CopiedTriggerId, CopiedBranchId));

        Assert.Equal("Q3 Climate Survey (Copy)", copy.Survey.TitleEn);
        Assert.Null(copy.Survey.TitleEs);
    }

    [Fact]
    public void Description_language_and_both_halves_of_the_invitation_strings_are_copied()
    {
        var copy = DuplicateSource();

        Assert.Equal("How the team is doing", copy.Survey.DescriptionEn);
        Assert.Equal("Como va el equipo", copy.Survey.DescriptionEs);
        Assert.Equal("both", copy.Survey.Language);
        Assert.Equal("Please take our survey", copy.Survey.Settings.InvitationCustomMessageEn);
        Assert.Equal("Por favor responde nuestra encuesta", copy.Survey.Settings.InvitationCustomMessageEs);
        Assert.Equal("Your voice matters", copy.Survey.Settings.InvitationCustomSubjectEn);
        Assert.Equal("Tu voz importa", copy.Survey.Settings.InvitationCustomSubjectEs);
    }

    [Fact]
    public void Question_text_scale_labels_and_comment_prompts_are_copied_in_both_languages()
    {
        var copy = DuplicateSource();
        var trigger = copy.Questions.Single(q => q.Order == 0);
        var branch = copy.Questions.Single(q => q.Order == 1);

        Assert.Equal(("Are you satisfied?", "Estas satisfecho?"), (trigger.TextEn, trigger.TextEs));
        Assert.Equal(("Tell us more:", "Cuentanos mas:"), (trigger.CommentPromptEn, trigger.CommentPromptEs));
        Assert.Equal(("Which area needs the most work?", "Que area necesita mas trabajo?"), (branch.TextEn, branch.TextEs));
        Assert.Equal(("Poor", "Malo"), (branch.ScaleLabelMinEn, branch.ScaleLabelMinEs));
        Assert.Equal(("Excellent", "Excelente"), (branch.ScaleLabelMaxEn, branch.ScaleLabelMaxEs));
        Assert.Equal("engagement", branch.Category);
        Assert.Equal((1, 5), (branch.ScaleMin, branch.ScaleMax));
    }

    [Fact]
    public void Emoji_option_rows_are_copied_with_their_numeric_value_and_both_labels()
    {
        var copy = DuplicateSource();
        var emoji = Assert.Single(copy.EmojiOptions);

        Assert.Equal(CopiedTriggerId, emoji.QuestionId);
        Assert.Equal("\U0001F600", emoji.Emoji);
        Assert.Equal(("Great", "Genial"), (emoji.LabelEn, emoji.LabelEs));
        Assert.Equal(5, emoji.Value);
    }

    // ------------------------------------------------------------------
    // Structure is copied; history is not.
    // ------------------------------------------------------------------

    [Fact]
    public void The_copy_is_a_fresh_draft_with_no_responses_and_no_version_history()
    {
        var copy = DuplicateSource();

        Assert.Equal(SurveyStatuses.Draft, copy.Survey.Status);
        Assert.Equal(0, copy.Survey.ResponseCount);
        Assert.Equal(1, copy.Survey.Version);
        Assert.Equal(Now, copy.Survey.CreatedAt);
        Assert.Equal(Now, copy.Survey.UpdatedAt);
    }

    [Fact]
    public void The_copy_is_attributed_to_whoever_duplicated_it_not_to_the_original_author()
    {
        var copy = DuplicateSource();

        Assert.Equal(DuplicatingAdminId, copy.Survey.CreatedBy);
        Assert.NotEqual(OriginalAuthorId, copy.Survey.CreatedBy);
    }

    [Fact]
    public void Company_type_settings_and_department_targeting_are_carried_over()
    {
        var copy = DuplicateSource();

        Assert.Equal(CompanyId, copy.Survey.CompanyId);
        Assert.Equal("general_climate", copy.Survey.Type);
        Assert.Equal(200, copy.Survey.TargetAudienceCount);
        Assert.True(copy.Survey.Settings.Anonymous);
        Assert.Equal(20, copy.Survey.Settings.TimeLimitMinutes);
        Assert.Equal(500, copy.Survey.Settings.ResponseLimit);
        Assert.Equal(7, copy.Survey.Settings.NotificationReminderFrequencyDays);
        Assert.True(copy.Survey.Settings.InvitationBrandingEnabled);

        var target = Assert.Single(copy.DepartmentTargets);
        Assert.Equal(CopySurveyId, target.SurveyId);
        Assert.Equal(DepartmentId, target.DepartmentId);
    }

    [Fact]
    public void The_copys_settings_are_a_separate_instance_so_editing_one_does_not_edit_the_other()
    {
        var source = BilingualSource();
        var copy = SurveyDuplication.Duplicate(
            source, CopySurveyId, DuplicatingAdminId, Now, SequentialIds(CopiedTriggerId, CopiedBranchId));

        copy.Survey.Settings.Anonymous = false;

        Assert.True(source.Survey.Settings.Anonymous);
        Assert.NotSame(source.Survey.Settings, copy.Survey.Settings);
    }

    [Fact]
    public void Every_copied_row_belongs_to_the_new_survey()
    {
        var copy = DuplicateSource();

        Assert.Equal(CopySurveyId, copy.Survey.Id);
        Assert.All(copy.Questions, q => Assert.Equal(CopySurveyId, q.SurveyId));
        Assert.All(copy.DepartmentTargets, t => Assert.Equal(CopySurveyId, t.SurveyId));
        Assert.DoesNotContain(copy.Questions, q => q.Id == TriggerQuestionId || q.Id == BranchQuestionId);
    }

    // ------------------------------------------------------------------
    // Conditional logic remapping.
    // ------------------------------------------------------------------

    [Fact]
    public void Conditional_logic_is_rewired_to_the_copys_questions_not_left_pointing_at_the_original()
    {
        var copy = DuplicateSource();
        var logic = Assert.Single(copy.ConditionalLogic);

        Assert.Equal(CopiedBranchId, logic.QuestionId);
        Assert.Equal(CopiedTriggerId, logic.ConditionQuestionId);
        Assert.Equal(CopiedBranchId, logic.TargetQuestionId);
        Assert.Equal("equals", logic.ConditionOperator);
        Assert.Equal("\"no\"", logic.ConditionValue);
        Assert.Equal("show", logic.Action);
    }

    [Fact]
    public void A_conditional_reference_to_a_question_outside_this_survey_becomes_null_not_a_dangling_id()
    {
        var source = BilingualSource();
        var foreignQuestionId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        source.ConditionalLogic[0].ConditionQuestionId = foreignQuestionId;

        var copy = SurveyDuplication.Duplicate(
            source, CopySurveyId, DuplicatingAdminId, Now, SequentialIds(CopiedTriggerId, CopiedBranchId));

        Assert.Null(Assert.Single(copy.ConditionalLogic).ConditionQuestionId);
    }

    // ------------------------------------------------------------------
    // Overrides.
    // ------------------------------------------------------------------

    [Fact]
    public void A_supplied_title_replaces_the_suffixed_default_per_locale()
    {
        var copy = DuplicateSource(new SurveyDuplicateOptions(TitleEn: "Q4 Climate Survey", TitleEs: "Encuesta de Clima Q4"));

        Assert.Equal("Q4 Climate Survey", copy.Survey.TitleEn);
        Assert.Equal("Encuesta de Clima Q4", copy.Survey.TitleEs);
    }

    [Fact]
    public void An_override_for_one_locale_leaves_the_other_locales_default_suffix_in_place()
    {
        var copy = DuplicateSource(new SurveyDuplicateOptions(TitleEs: "Encuesta de Clima Q4"));

        Assert.Equal("Q3 Climate Survey (Copy)", copy.Survey.TitleEn);
        Assert.Equal("Encuesta de Clima Q4", copy.Survey.TitleEs);
    }

    [Fact]
    public void Supplied_dates_replace_the_originals_window()
    {
        var start = Now.AddDays(30);
        var end = Now.AddDays(44);
        var copy = DuplicateSource(new SurveyDuplicateOptions(StartDate: start, EndDate: end));

        Assert.Equal(start, copy.Survey.StartDate);
        Assert.Equal(end, copy.Survey.EndDate);
    }

    [Fact]
    public void Without_overrides_the_originals_window_is_carried_over()
    {
        var copy = DuplicateSource();

        Assert.Equal(Now, copy.Survey.StartDate);
        Assert.Equal(Now.AddDays(14), copy.Survey.EndDate);
    }

    [Fact]
    public void A_survey_with_no_questions_duplicates_to_an_empty_but_valid_copy()
    {
        var source = BilingualSource() with
        {
            Questions = [],
            Options = [],
            EmojiOptions = [],
            ConditionalLogic = [],
        };

        var copy = SurveyDuplication.Duplicate(source, CopySurveyId, DuplicatingAdminId, Now, Guid.NewGuid);

        Assert.Empty(copy.Questions);
        Assert.Empty(copy.Options);
        Assert.Equal(SurveyStatuses.Draft, copy.Survey.Status);
    }
}
