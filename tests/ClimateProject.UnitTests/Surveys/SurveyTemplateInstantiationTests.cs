using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyTemplateInstantiationTests
{
    private static readonly Guid TemplateId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CompanyId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ActingAdminId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid DepartmentId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid NewSurveyId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid OpenQuestionId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid ChoiceQuestionId = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid NewOpenQuestionId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid NewChoiceQuestionId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly DateTimeOffset Now = new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    private static Func<Guid> SequentialIds(params Guid[] ids)
    {
        var queue = new Queue<Guid>(ids);
        return queue.Dequeue;
    }

    private static SurveyTemplateStructure BilingualTemplate()
    {
        var template = new SurveyTemplate
        {
            Id = TemplateId,
            Name = "Standard Climate Instrument",
            Description = "The 2026 baseline",
            Category = "general_climate",
            CompanyId = null,
            UsageCount = 12,
            Rating = 4.5,
            Tags = ["climate", "baseline"],
            CreatedAt = Now.AddDays(-100),
            UpdatedAt = Now.AddDays(-2),
        };

        var open = new TemplateQuestion
        {
            Id = OpenQuestionId,
            TemplateId = TemplateId,
            TextEn = "What would you change?",
            TextEs = "¿Qué cambiarías?",
            Type = QuestionTypes.OpenEnded,
            CommentRequired = false,
            CommentPromptEn = "Tell us more:",
            CommentPromptEs = "Cuéntanos más:",
            Required = true,
            Order = 0,
            Category = "voice",
        };

        var choice = new TemplateQuestion
        {
            Id = ChoiceQuestionId,
            TemplateId = TemplateId,
            TextEn = "Which area needs the most work?",
            TextEs = "¿Qué área necesita más trabajo?",
            Type = QuestionTypes.MultipleChoice,
            ScaleMin = null,
            ScaleMax = null,
            ScaleLabelMinEn = "Low",
            ScaleLabelMinEs = "Bajo",
            ScaleLabelMaxEn = "High",
            ScaleLabelMaxEs = "Alto",
            BinaryCommentConfigEn = "{\"yes\":\"why\"}",
            BinaryCommentConfigEs = "{\"si\":\"por que\"}",
            Required = false,
            Order = 1,
        };

        var options = new List<TemplateQuestionOption>
        {
            new() { TemplateQuestionId = ChoiceQuestionId, Order = 0, Value = "leadership", LabelEn = "Leadership", LabelEs = "Liderazgo" },
            new() { TemplateQuestionId = ChoiceQuestionId, Order = 1, Value = "tooling", LabelEn = "Tooling", LabelEs = "Herramientas" },
        };

        return new SurveyTemplateStructure(template, [open, choice], options);
    }

    private static SurveyInstantiationOptions Options(
        string language = "both",
        string? titleEn = "Q3 Climate Survey",
        string? titleEs = "Encuesta de Clima Q3",
        IReadOnlyList<Guid>? departmentIds = null)
        => new(
            CompanyId,
            ActingAdminId,
            "general_climate",
            language,
            titleEn,
            titleEs,
            "How the team is doing",
            "Como va el equipo",
            Now,
            Now.AddDays(14),
            TargetAudienceCount: 200,
            DepartmentIds: departmentIds);

    private static SurveyStructure Instantiate(SurveyInstantiationOptions? options = null)
        => SurveyTemplateInstantiation.Instantiate(
            BilingualTemplate(),
            NewSurveyId,
            Now,
            SequentialIds(NewOpenQuestionId, NewChoiceQuestionId),
            options ?? Options());

    // ------------------------------------------------------------------
    // The subtle part: stable option values.
    // ------------------------------------------------------------------

    [Fact]
    public void Option_rows_keep_their_stable_value_so_answers_aggregate_across_instantiations()
    {
        var created = Instantiate();

        Assert.Equal(
            ["leadership", "tooling"],
            created.Options.OrderBy(o => o.Order).Select(o => o.Value));
    }

    [Fact]
    public void Two_instantiations_of_the_same_template_agree_on_every_option_value()
    {
        var first = Instantiate();
        var second = SurveyTemplateInstantiation.Instantiate(
            BilingualTemplate(),
            Guid.NewGuid(),
            Now,
            Guid.NewGuid,
            Options());

        Assert.Equal(
            first.Options.OrderBy(o => o.Order).Select(o => o.Value),
            second.Options.OrderBy(o => o.Order).Select(o => o.Value));
    }

    [Fact]
    public void Option_rows_keep_both_label_halves_and_their_order()
    {
        var options = Instantiate().Options.OrderBy(o => o.Order).ToList();

        Assert.Equal(2, options.Count);
        Assert.Equal(("Leadership", "Liderazgo"), (options[0].LabelEn, options[0].LabelEs));
        Assert.Equal(("Tooling", "Herramientas"), (options[1].LabelEn, options[1].LabelEs));
        Assert.Equal([0, 1], options.Select(o => o.Order));
    }

    [Fact]
    public void Option_rows_are_pointed_at_the_new_surveys_own_questions()
    {
        var created = Instantiate();

        Assert.All(created.Options, o => Assert.Equal(NewChoiceQuestionId, o.QuestionId));
        Assert.DoesNotContain(created.Options, o => o.QuestionId == ChoiceQuestionId);
    }

    // ------------------------------------------------------------------
    // Both language halves survive.
    // ------------------------------------------------------------------

    [Fact]
    public void Both_halves_of_every_question_field_cross_over()
    {
        var created = Instantiate();
        var open = created.Questions.Single(q => q.Order == 0);
        var choice = created.Questions.Single(q => q.Order == 1);

        Assert.Equal(("What would you change?", "¿Qué cambiarías?"), (open.TextEn, open.TextEs));
        Assert.Equal(("Tell us more:", "Cuéntanos más:"), (open.CommentPromptEn, open.CommentPromptEs));
        Assert.Equal(("Low", "Bajo"), (choice.ScaleLabelMinEn, choice.ScaleLabelMinEs));
        Assert.Equal(("High", "Alto"), (choice.ScaleLabelMaxEn, choice.ScaleLabelMaxEs));
        Assert.Equal(("{\"yes\":\"why\"}", "{\"si\":\"por que\"}"), (choice.BinaryCommentConfigEn, choice.BinaryCommentConfigEs));
    }

    [Fact]
    public void Both_halves_survive_even_when_the_survey_is_created_in_one_language()
    {
        // A Spanish survey made from a bilingual template keeps its English column. The
        // language names how it renders and what its publish gate demands, not what it is
        // allowed to store -- dropping the other half here would make switching the survey
        // to 'both' later a data loss nobody can see.
        var created = Instantiate(Options(language: "es", titleEn: null, titleEs: "Encuesta de Clima Q3"));

        Assert.Equal("es", created.Survey.Language);
        Assert.All(created.Questions, q => Assert.False(string.IsNullOrWhiteSpace(q.TextEn)));
        Assert.All(created.Questions, q => Assert.False(string.IsNullOrWhiteSpace(q.TextEs)));
    }

    // ------------------------------------------------------------------
    // The survey is a new, independent draft.
    // ------------------------------------------------------------------

    [Fact]
    public void The_new_survey_is_a_fresh_draft_owned_by_the_acting_admin()
    {
        var survey = Instantiate().Survey;

        Assert.Equal(NewSurveyId, survey.Id);
        Assert.Equal(CompanyId, survey.CompanyId);
        Assert.Equal(ActingAdminId, survey.CreatedBy);
        Assert.Equal(SurveyStatuses.Draft, survey.Status);
        Assert.Equal(0, survey.ResponseCount);
        Assert.Equal(1, survey.Version);
        Assert.Equal(Now, survey.CreatedAt);
        Assert.Equal(Now, survey.UpdatedAt);
    }

    [Fact]
    public void The_new_survey_inherits_none_of_the_templates_catalogue_counters()
    {
        // UsageCount and Rating belong to the template. A survey has neither concept, and
        // the assertion exists so nobody "helpfully" maps them onto ResponseCount.
        var created = Instantiate();

        Assert.Equal(0, created.Survey.ResponseCount);
        Assert.Equal(12, BilingualTemplate().Template.UsageCount);
    }

    [Fact]
    public void Question_rows_get_new_ids_so_the_survey_shares_nothing_with_the_template()
    {
        var created = Instantiate();

        Assert.Equal([NewOpenQuestionId, NewChoiceQuestionId], created.Questions.OrderBy(q => q.Order).Select(q => q.Id));
        Assert.DoesNotContain(created.Questions, q => q.Id == OpenQuestionId || q.Id == ChoiceQuestionId);
        Assert.All(created.Questions, q => Assert.Equal(NewSurveyId, q.SurveyId));
    }

    [Fact]
    public void Questions_keep_their_order_type_and_flags()
    {
        var created = Instantiate();
        var open = created.Questions.Single(q => q.Order == 0);
        var choice = created.Questions.Single(q => q.Order == 1);

        Assert.Equal(QuestionTypes.OpenEnded, open.Type);
        Assert.True(open.Required);
        Assert.False(open.CommentRequired);
        Assert.Equal("voice", open.Category);
        Assert.Equal(QuestionTypes.MultipleChoice, choice.Type);
        Assert.False(choice.Required);
    }

    [Fact]
    public void Department_targets_come_from_the_caller_and_are_deduplicated()
    {
        var created = Instantiate(Options(departmentIds: [DepartmentId, DepartmentId]));

        var target = Assert.Single(created.DepartmentTargets);
        Assert.Equal(NewSurveyId, target.SurveyId);
        Assert.Equal(DepartmentId, target.DepartmentId);
    }

    [Fact]
    public void Emoji_options_and_conditional_logic_are_empty_because_a_template_cannot_hold_them()
    {
        var created = Instantiate();

        Assert.Empty(created.EmojiOptions);
        Assert.Empty(created.ConditionalLogic);
    }
}
