using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyCoreTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Department department)> SeedTenantAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var department = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Eng", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Departments.Add(department);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user, department);
    }

    [Fact]
    public async Task Survey_round_trips_with_owned_settings_and_department_targets()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, department) = await SeedTenantAsync(db);

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            CreatedBy = user.Id,
            TitleEn = "Q3 Climate Survey",
            Type = "general_climate",
            StartDate = DateTimeOffset.UtcNow,
            EndDate = DateTimeOffset.UtcNow.AddDays(14),
            Settings = new SurveySettings { Anonymous = true, TimeLimitMinutes = 20 },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        db.SurveyDepartmentTargets.Add(new SurveyDepartmentTarget { SurveyId = survey.Id, DepartmentId = department.Id });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Surveys.SingleAsync(s => s.Id == survey.Id);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(1, loaded.Version);
        Assert.True(loaded.Settings.Anonymous);
        Assert.Equal(20, loaded.Settings.TimeLimitMinutes);
        Assert.True(loaded.Settings.AllowPartialResponses);

        var targets = await readDb.SurveyDepartmentTargets.Where(t => t.SurveyId == survey.Id).ToListAsync();
        Assert.Single(targets);
        Assert.Equal(department.Id, targets[0].DepartmentId);
    }

    [Fact]
    public async Task Question_with_conditional_logic_and_emoji_options_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedTenantAsync(db);

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, TitleEn = "Pulse", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var trigger = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, TextEn = "Are you satisfied?", Type = "yes_no", Order = 0 };
        var target = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, TextEn = "Why not?", Type = "open_ended", Order = 1 };
        var emojiQuestion = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, TextEn = "How do you feel?", Type = "emoji_scale", Order = 2 };
        db.Questions.AddRange(trigger, target, emojiQuestion);
        await db.SaveChangesAsync();

        db.QuestionConditionalLogics.Add(new QuestionConditionalLogic
        {
            QuestionId = target.Id,
            ConditionQuestionId = trigger.Id,
            ConditionOperator = "equals",
            ConditionValue = "\"no\"",
            Action = "show",
            TargetQuestionId = target.Id,
        });
        db.QuestionEmojiOptions.AddRange(
            new QuestionEmojiOption { QuestionId = emojiQuestion.Id, Order = 0, Emoji = "😀", LabelEn = "Great", Value = 5 },
            new QuestionEmojiOption { QuestionId = emojiQuestion.Id, Order = 1, Emoji = "😢", LabelEn = "Bad", Value = 1 });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var logic = await readDb.QuestionConditionalLogics.SingleAsync(c => c.QuestionId == target.Id);
        Assert.Equal(trigger.Id, logic.ConditionQuestionId);
        Assert.Equal("equals", logic.ConditionOperator);
        Assert.Equal("show", logic.Action);

        var options = await readDb.QuestionEmojiOptions
            .Where(e => e.QuestionId == emojiQuestion.Id)
            .OrderBy(e => e.Order)
            .ToListAsync();
        Assert.Equal(2, options.Count);
        Assert.Equal(5, options[0].Value);
    }

    [Fact]
    public async Task Existing_survey_and_question_rows_without_new_owned_defaults_still_load_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedTenantAsync(db);

        var minimalSurveyId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO surveys ("Id", company_id, created_by, title_en, type, start_date, end_date, created_at, updated_at)
             VALUES ({minimalSurveyId}, {company.Id}, {user.Id}, {"Minimal Survey"}, {"custom"}, {now}, {now.AddDays(7)}, {now}, {now})
             """);

        var minimalQuestionId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO questions ("Id", survey_id, text_en, type, "order")
             VALUES ({minimalQuestionId}, {minimalSurveyId}, {"Minimal question?"}, {"open_ended"}, {0})
             """);

        await using var readDb = CreateContext();
        var loadedSurvey = await readDb.Surveys.SingleAsync(s => s.Id == minimalSurveyId);
        Assert.Equal("draft", loadedSurvey.Status);
        Assert.Equal(0, loadedSurvey.ResponseCount);
        Assert.Equal(1, loadedSurvey.Version);
        Assert.False(loadedSurvey.Settings.Anonymous);
        Assert.True(loadedSurvey.Settings.AllowPartialResponses);
        Assert.False(loadedSurvey.Settings.RandomizeQuestions);
        Assert.True(loadedSurvey.Settings.ShowProgress);
        Assert.True(loadedSurvey.Settings.AutoSave);
        Assert.True(loadedSurvey.Settings.NotificationSendInvitations);
        Assert.True(loadedSurvey.Settings.NotificationSendReminders);
        Assert.Equal(3, loadedSurvey.Settings.NotificationReminderFrequencyDays);
        Assert.False(loadedSurvey.Settings.InvitationIncludeCredentials);
        Assert.False(loadedSurvey.Settings.InvitationSendImmediately);
        Assert.False(loadedSurvey.Settings.InvitationBrandingEnabled);

        var loadedQuestion = await readDb.Questions.SingleAsync(q => q.Id == minimalQuestionId);
        Assert.True(loadedQuestion.CommentRequired);
        Assert.Equal("Please explain your answer:", loadedQuestion.CommentPromptEn);
        Assert.False(loadedQuestion.Required);
    }
}
