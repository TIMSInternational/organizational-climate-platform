using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyVersioningTests
{
    private static readonly Guid QuestionId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid DepartmentId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static Survey Survey(string language = ContentLanguages.English)
    {
        var survey = new Survey
        {
            Id = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            CompanyId = Guid.Parse("44444444-4444-4444-4444-444444444444"),
            CreatedBy = Guid.Parse("55555555-5555-5555-5555-555555555555"),
            TitleEn = "Q3 Climate",
            TitleEs = "Clima Q3",
            DescriptionEn = "How it is going",
            DescriptionEs = "Cómo va todo",
            Language = language,
            Type = "general_climate",
            StartDate = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
            EndDate = new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero),
            TargetAudienceCount = 40,
        };
        survey.Settings.Anonymous = true;
        survey.Settings.TimeLimitMinutes = 15;
        return survey;
    }

    private static Question Question(string textEn = "How supported do you feel?", int order = 0)
        => new()
        {
            Id = QuestionId,
            SurveyId = Survey().Id,
            TextEn = textEn,
            TextEs = "¿Qué tan apoyado te sientes?",
            Type = QuestionTypes.MultipleChoice,
            Required = true,
            Order = order,
            Category = "support",
        };

    private static Dictionary<Guid, List<QuestionOption>> Options(string firstValue = "very")
        => new()
        {
            [QuestionId] =
            [
                new QuestionOption { QuestionId = QuestionId, Order = 0, Value = firstValue, LabelEn = "Very", LabelEs = "Mucho" },
                new QuestionOption { QuestionId = QuestionId, Order = 1, Value = "not_at_all", LabelEn = "Not at all", LabelEs = "Nada" },
            ],
        };

    private static SurveyVersionContent Capture(
        Survey? survey = null,
        Question? question = null,
        Dictionary<Guid, List<QuestionOption>>? options = null,
        IReadOnlyCollection<Guid>? departmentIds = null)
        => SurveyVersioning.Capture(
            survey ?? Survey(),
            question is null ? [Question()] : [question],
            options ?? Options(),
            departmentIds ?? [DepartmentId]);

    // ------------------------------------------------------------------
    // Capture
    // ------------------------------------------------------------------

    [Fact]
    public void Capture_keeps_both_locales_of_every_paired_field()
    {
        var content = Capture();

        Assert.Equal("Q3 Climate", content.TitleEn);
        Assert.Equal("Clima Q3", content.TitleEs);

        var question = Assert.Single(content.Questions);
        Assert.Equal("How supported do you feel?", question.TextEn);
        Assert.Equal("¿Qué tan apoyado te sientes?", question.TextEs);

        // A snapshot that kept only one locale would desynchronise from the survey it
        // claims to copy the moment the survey is translated. The #195 "no En/Es-shaped
        // fields" rule governs READ DTOs; this is persistence.
        Assert.Collection(
            question.Options,
            first =>
            {
                Assert.Equal("Very", first.LabelEn);
                Assert.Equal("Mucho", first.LabelEs);
            },
            second =>
            {
                Assert.Equal("Not at all", second.LabelEn);
                Assert.Equal("Nada", second.LabelEs);
            });
    }

    [Fact]
    public void Capture_keeps_the_stable_option_value_that_stored_answers_join_on()
    {
        var content = Capture();

        // The single most important field in the snapshot: question_responses.response_value
        // holds this string, so it is the join between a stored answer and the wording that
        // produced it.
        Assert.Equal(["very", "not_at_all"], Assert.Single(content.Questions).Options.Select(o => o.Value));
    }

    [Fact]
    public void Capture_records_the_question_id_a_stored_answer_points_at()
        => Assert.Equal(QuestionId, Assert.Single(Capture().Questions).Id);

    [Fact]
    public void Capture_takes_the_schedule_targeting_and_settings()
    {
        var content = Capture();

        Assert.Equal("general_climate", content.Settings.Type);
        Assert.Equal([DepartmentId], content.Settings.DepartmentIds);
        Assert.Equal(40, content.Settings.TargetAudienceCount);
        Assert.True(content.Settings.Anonymous);
        Assert.Equal(15, content.Settings.TimeLimitMinutes);
    }

    // ------------------------------------------------------------------
    // Round trip
    // ------------------------------------------------------------------

    [Fact]
    public void A_snapshot_survives_a_round_trip_through_its_jsonb_columns()
    {
        var content = Capture();

        var row = new SurveyVersion
        {
            Id = Guid.NewGuid(),
            SurveyId = Survey().Id,
            VersionNumber = 1,
            TitleEn = content.TitleEn,
            TitleEs = content.TitleEs,
            DescriptionEn = content.DescriptionEn,
            DescriptionEs = content.DescriptionEs,
            Reason = SurveyVersionReasons.Publish,
            CreatedBy = Guid.NewGuid(),
            QuestionsSnapshot = SurveyVersioning.SerializeQuestions(content.Questions),
            SettingsSnapshot = SurveyVersioning.SerializeSettings(content.Settings),
        };

        var read = SurveyVersioning.ReadContent(row);

        // Compared through Diff rather than record equality: the snapshot records hold
        // IReadOnlyList members, so the compiler-generated Equals compares those by
        // reference and would report every round trip as a difference. Diff is also the
        // comparison that actually matters -- it is what decides whether a republish
        // records a change.
        Assert.Empty(SurveyVersioning.Diff(content, read));

        Assert.Equal(content.TitleEn, read.TitleEn);
        Assert.Equal(content.TitleEs, read.TitleEs);
        Assert.Equal(content.DescriptionEs, read.DescriptionEs);
        Assert.Equal(content.Settings, read.Settings with { DepartmentIds = content.Settings.DepartmentIds });
        Assert.Equal(content.Settings.DepartmentIds, read.Settings.DepartmentIds);

        var readQuestion = Assert.Single(read.Questions);
        Assert.Equal(QuestionId, readQuestion.Id);
        Assert.Equal("¿Qué tan apoyado te sientes?", readQuestion.TextEs);
        Assert.Equal(["very", "not_at_all"], readQuestion.Options.Select(o => o.Value));
        Assert.Equal(["Mucho", "Nada"], readQuestion.Options.Select(o => o.LabelEs));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{ not json")]
    public void An_unreadable_snapshot_blob_degrades_instead_of_throwing(string? blob)
    {
        var row = new SurveyVersion
        {
            Id = Guid.NewGuid(),
            SurveyId = Survey().Id,
            VersionNumber = 1,
            TitleEn = "Still true",
            Reason = SurveyVersionReasons.Publish,
            CreatedBy = Guid.NewGuid(),
            QuestionsSnapshot = blob,
            SettingsSnapshot = blob,
        };

        var read = SurveyVersioning.ReadContent(row);

        // The row's own columns still tell the truth; one unreadable blob must not 500 the
        // whole version list and hide the readable rows with it.
        Assert.Equal("Still true", read.TitleEn);
        Assert.Empty(read.Questions);
    }

    // ------------------------------------------------------------------
    // Diff
    // ------------------------------------------------------------------

    [Fact]
    public void The_first_version_is_not_a_change_to_anything()
        => Assert.Empty(SurveyVersioning.Diff(null, Capture()));

    [Fact]
    public void An_identical_republish_reports_no_changes()
        => Assert.Empty(SurveyVersioning.Diff(Capture(), Capture()));

    [Fact]
    public void A_translated_question_is_one_change_not_a_locale_suffixed_one()
    {
        var before = Capture();

        var translated = Question();
        translated.TextEs = "¿Te sientes respaldado?";
        var after = Capture(question: translated);

        // "questions[0].text", never "questions[0].textEs" -- emitting locale-suffixed
        // paths would leak the #195 column shape into a client-facing string.
        Assert.Equal(["questions[0].text"], SurveyVersioning.Diff(before, after));
    }

    [Fact]
    public void Clearing_a_field_to_blank_is_not_reported_as_a_change()
    {
        var before = Survey();
        before.DescriptionEn = null;

        var after = Survey();
        after.DescriptionEn = "   ";

        Assert.Empty(SurveyVersioning.Diff(Capture(before), Capture(after)));
    }

    [Fact]
    public void A_moved_option_value_is_reported_because_it_breaks_answer_aggregation()
    {
        var changes = SurveyVersioning.Diff(Capture(), Capture(options: Options(firstValue: "very_much")));

        Assert.Equal(["questions[0].options"], changes);
    }

    [Fact]
    public void Added_and_removed_questions_are_reported_by_order()
    {
        var one = SurveyVersioning.Capture(Survey(), [Question(order: 0)], Options(), [DepartmentId]);
        var two = SurveyVersioning.Capture(
            Survey(),
            [Question(order: 0), new Question { Id = Guid.NewGuid(), SurveyId = Survey().Id, TextEn = "Anything else?", Type = QuestionTypes.OpenEnded, Order = 1 }],
            Options(),
            [DepartmentId]);

        Assert.Equal(["questions[1].added"], SurveyVersioning.Diff(one, two));
        Assert.Equal(["questions[1].removed"], SurveyVersioning.Diff(two, one));
    }

    [Fact]
    public void Questions_are_matched_by_order_not_by_id()
    {
        // A content edit replaces every question row wholesale with a fresh id (see
        // SurveyEndpoints.UpdateAsync). Matching by id would report an unchanged survey as
        // a total rewrite.
        var reissued = Question();
        reissued.Id = Guid.NewGuid();

        var reissuedOptions = new Dictionary<Guid, List<QuestionOption>>
        {
            [reissued.Id] = Options()[QuestionId]
                .Select(o => new QuestionOption { QuestionId = reissued.Id, Order = o.Order, Value = o.Value, LabelEn = o.LabelEn, LabelEs = o.LabelEs })
                .ToList(),
        };

        Assert.Empty(SurveyVersioning.Diff(Capture(), Capture(question: reissued, options: reissuedOptions)));
    }

    [Fact]
    public void Every_settings_member_is_covered_by_the_diff()
    {
        var before = Survey();
        var after = Survey();
        after.Type = "pulse";
        after.Language = ContentLanguages.Both;
        after.StartDate = before.StartDate.AddDays(1);
        after.EndDate = before.EndDate.AddDays(1);
        after.TargetAudienceCount = 41;
        after.Settings.Anonymous = false;
        after.Settings.AllowPartialResponses = false;
        after.Settings.RandomizeQuestions = true;
        after.Settings.ShowProgress = false;
        after.Settings.AutoSave = false;
        after.Settings.TimeLimitMinutes = 20;
        after.Settings.ResponseLimit = 300;
        after.Settings.NotificationSendInvitations = false;
        after.Settings.NotificationSendReminders = false;
        after.Settings.NotificationReminderFrequencyDays = 7;
        after.Settings.InvitationCustomMessageEn = "Please take part";
        after.Settings.InvitationCustomSubjectEs = "Tu opinión importa";
        after.Settings.InvitationIncludeCredentials = true;
        after.Settings.InvitationSendImmediately = true;
        after.Settings.InvitationBrandingEnabled = true;

        var changes = SurveyVersioning.Diff(Capture(before), Capture(after, departmentIds: [Guid.NewGuid()]));

        Assert.Equal(
            [
                "type",
                "language",
                "startDate",
                "endDate",
                "targetAudienceCount",
                "settings.anonymous",
                "settings.allowPartialResponses",
                "settings.randomizeQuestions",
                "settings.showProgress",
                "settings.autoSave",
                "settings.timeLimitMinutes",
                "settings.responseLimit",
                "settings.notificationSendInvitations",
                "settings.notificationSendReminders",
                "settings.notificationReminderFrequencyDays",
                "settings.invitationCustomMessage",
                "settings.invitationCustomSubject",
                "settings.invitationIncludeCredentials",
                "settings.invitationSendImmediately",
                "settings.invitationBrandingEnabled",
                "departmentIds",
            ],
            changes);
    }

    [Fact]
    public void Reordering_the_same_departments_is_not_a_change()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        Assert.Empty(SurveyVersioning.Diff(Capture(departmentIds: [a, b]), Capture(departmentIds: [b, a, a])));
    }

    [Fact]
    public void Version_reasons_are_machine_tokens_not_display_copy()
    {
        // The frontend maps these to i18n keys. A sentence here would be an untranslated
        // English string in a Spanish admin's version history.
        Assert.Equal(["publish", "republish"], SurveyVersionReasons.All);
    }
}
