using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

// #195's DDL-level guarantees, proved the only way that actually proves them: insert a
// row with raw SQL, then read it back through EF.
//
// An EF-insert-then-read passes even when the database default is wrong, because EF
// sends the CLR initialiser's value. Only a row the application did not write shows
// what the schema itself does -- and rows the application did not write are exactly
// what #154's loader and any repair script produce.
[Collection("Postgres")]
public class ContentI18nDefaultsTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);

    private async Task<(Company Company, User User)> SeedAsync(ClimateProjectDbContext db)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "I18n Co",
            EmailDomain = $"i18n-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Author",
            Email = $"{Guid.NewGuid():N}@i18n.test",
            Role = "company_admin",
            CompanyId = company.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task Comment_prompt_defaults_to_its_own_language_in_each_column()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedAsync(db);

        var surveyId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO surveys ("Id", company_id, created_by, title_en, type, start_date, end_date, created_at, updated_at)
             VALUES ({surveyId}, {company.Id}, {user.Id}, {"Raw survey"}, {"custom"}, {now}, {now.AddDays(7)}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO questions ("Id", survey_id, text_en, type, "order")
             VALUES ({questionId}, {surveyId}, {"Raw question?"}, {"open_ended"}, {0})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Questions.SingleAsync(q => q.Id == questionId);

        // The single comment_prompt column this replaces shipped the English string as
        // its DDL default, so a Spanish-only survey was served an English prompt out of
        // the schema itself. Each half now defaults in its own language.
        Assert.Equal("Please explain your answer:", loaded.CommentPromptEn);
        Assert.Equal("Por favor explica tu respuesta:", loaded.CommentPromptEs);
    }

    [Fact]
    public async Task The_default_check_would_notice_a_wrong_value()
    {
        // Companion to the test above: a raw insert that DOES supply a prompt must come
        // back with what it supplied, so "both columns always read as the defaults"
        // cannot make that test pass vacuously.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedAsync(db);

        var surveyId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO surveys ("Id", company_id, created_by, title_es, language, type, start_date, end_date, created_at, updated_at)
             VALUES ({surveyId}, {company.Id}, {user.Id}, {"Encuesta"}, {"es"}, {"custom"}, {now}, {now.AddDays(7)}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO questions ("Id", survey_id, text_es, type, "order", comment_prompt_es)
             VALUES ({questionId}, {surveyId}, {"¿Pregunta?"}, {"open_ended"}, {0}, {"Justifica tu elección:"})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Questions.SingleAsync(q => q.Id == questionId);
        var survey = await readDb.Surveys.SingleAsync(s => s.Id == surveyId);

        Assert.Equal("Justifica tu elección:", loaded.CommentPromptEs);
        Assert.Equal("es", survey.Language);
        Assert.Null(survey.TitleEn);
    }

    [Fact]
    public async Task Survey_microclimate_and_response_language_default_at_the_ddl_layer()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedAsync(db);

        var surveyId = Guid.NewGuid();
        var responseId = Guid.NewGuid();
        var microclimateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO surveys ("Id", company_id, created_by, title_en, type, start_date, end_date, created_at, updated_at)
             VALUES ({surveyId}, {company.Id}, {user.Id}, {"Raw survey"}, {"custom"}, {now}, {now.AddDays(7)}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO responses ("Id", survey_id, session_id, company_id, start_time, created_at, updated_at)
             VALUES ({responseId}, {surveyId}, {"raw-session"}, {company.Id}, {now}, {now}, {now})
             """);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimates ("Id", title_en, company_id, created_by, scheduling_start_time, scheduling_end_time, created_at, updated_at)
             VALUES ({microclimateId}, {"Raw pulse"}, {company.Id}, {user.Id}, {now}, {now.AddMinutes(30)}, {now}, {now})
             """);

        await using var readDb = CreateContext();

        Assert.Equal("en", (await readDb.Surveys.SingleAsync(s => s.Id == surveyId)).Language);
        Assert.Equal("en", (await readDb.Microclimates.SingleAsync(m => m.Id == microclimateId)).Language);
        // Response.Language did not exist before #195. Without it the live word cloud
        // counted "trabajo" and "work" separately with nothing recording which
        // language a respondent answered in.
        Assert.Equal("en", (await readDb.Responses.SingleAsync(r => r.Id == responseId)).Language);
    }

    [Fact]
    public async Task Two_options_of_one_question_cannot_share_a_value()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedAsync(db);

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            CreatedBy = user.Id,
            TitleEn = "Options survey",
            Type = "custom",
            StartDate = DateTimeOffset.UtcNow,
            EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        var question = new Question
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            TextEn = "Pick one",
            Type = "multiple_choice",
            Order = 0,
        };
        db.Surveys.Add(survey);
        db.Questions.Add(question);
        db.QuestionOptions.Add(new QuestionOption { QuestionId = question.Id, Order = 0, Value = "agree", LabelEn = "Agree" });
        db.QuestionOptions.Add(new QuestionOption { QuestionId = question.Id, Order = 1, Value = "agree", LabelEn = "Also agree" });

        // A duplicate value makes a stored answer ambiguous -- precisely the failure
        // the stable value exists to prevent, so the database refuses it.
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
