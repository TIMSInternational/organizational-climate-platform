using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task Public_template_with_questions_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var template = new SurveyTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Standard Climate Survey",
            Description = "A general climate survey template",
            Category = "climate",
            IsPublic = true,
            Tags = ["climate", "annual"],
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyTemplates.Add(template);
        await db.SaveChangesAsync();

        db.TemplateQuestions.Add(new TemplateQuestion
        {
            Id = Guid.NewGuid(), TemplateId = template.Id, TextEn = "How satisfied are you?", Type = "likert",
            ScaleMin = 1, ScaleMax = 5, Order = 0,
        });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.True(loaded.IsPublic);
        Assert.Equal(["climate", "annual"], loaded.Tags);
        Assert.Equal(0, loaded.UsageCount);
        Assert.Equal(0d, loaded.Rating);

        var question = await readDb.TemplateQuestions.SingleAsync(q => q.TemplateId == template.Id);
        Assert.Equal("likert", question.Type);
        Assert.True(question.CommentRequired);
    }

    [Fact]
    public async Task Company_scoped_template_setnulls_creator_when_user_is_deleted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var template = new SurveyTemplate
        {
            Id = Guid.NewGuid(), Name = "Custom", Description = "Custom template", Category = "custom",
            CreatedBy = user.Id, CompanyId = company.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyTemplates.Add(template);
        await db.SaveChangesAsync();

        db.Users.Remove(user);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Null(loaded.CreatedBy);
        Assert.Equal(company.Id, loaded.CompanyId);
    }

    [Fact]
    public async Task Existing_template_and_template_question_rows_without_new_defaults_still_load_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_templates ("Id", name, description, category, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal"}, {"Minimal desc"}, {"custom"}, {now}, {now})
             """);

        var minimalQuestionId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO template_questions ("Id", template_id, text_en, type, "order")
             VALUES ({minimalQuestionId}, {minimalTemplateId}, {"Q?"}, {"open_ended"}, {0})
             """);

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.SurveyTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.False(loadedTemplate.IsPublic);
        Assert.Equal(0, loadedTemplate.UsageCount);
        Assert.Equal(0d, loadedTemplate.Rating);
        Assert.Empty(loadedTemplate.Tags);
        Assert.Null(loadedTemplate.Industry);
        Assert.Null(loadedTemplate.SourceSurveyId);

        var loadedQuestion = await readDb.TemplateQuestions.SingleAsync(q => q.Id == minimalQuestionId);
        Assert.True(loadedQuestion.CommentRequired);
        Assert.Null(loadedQuestion.CommentPromptEn);
        Assert.False(loadedQuestion.Required);
    }
}
