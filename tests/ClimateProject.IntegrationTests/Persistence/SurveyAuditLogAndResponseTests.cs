using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyAuditLogAndResponseTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Survey survey, Question question)> SeedSurveyWithQuestionAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var question = new Question { Id = Guid.NewGuid(), SurveyId = survey.Id, Text = "Q1?", Type = "open_ended", Order = 0 };
        db.Questions.Add(question);
        await db.SaveChangesAsync();

        return (company, user, survey, question);
    }

    [Fact]
    public async Task Audit_log_round_trips_with_jsonb_changes()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey, _) = await SeedSurveyWithQuestionAsync(db);

        var entry = new SurveyAuditLog
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, Action = "published", EntityType = "survey",
            Changes = """{"before":{"status":"draft"},"after":{"status":"active"}}""",
            UserId = user.Id, UserName = user.Name, UserEmail = user.Email, UserRole = user.Role,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.SurveyAuditLogs.Add(entry);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyAuditLogs.SingleAsync(a => a.Id == entry.Id);
        Assert.Equal("published", loaded.Action);
        Assert.Contains("active", loaded.Changes);
    }

    [Fact]
    public async Task Response_with_question_responses_and_demographics_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey, question) = await SeedSurveyWithQuestionAsync(db);

        var response = new Response
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, SessionId = "sess-xyz",
            CompanyId = company.Id, StartTime = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Responses.Add(response);
        await db.SaveChangesAsync();

        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = response.Id, QuestionId = question.Id, ResponseValue = "\"Great experience\"",
        });
        db.ResponseDemographics.Add(new ResponseDemographic
        {
            ResponseId = response.Id, Field = "tenure_months", Value = "18",
        });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedResponse = await readDb.Responses.SingleAsync(r => r.Id == response.Id);
        Assert.False(loadedResponse.IsComplete);
        Assert.False(loadedResponse.IsAnonymous);

        var loadedAnswer = await readDb.QuestionResponses.SingleAsync(qr => qr.ResponseId == response.Id);
        Assert.Equal("\"Great experience\"", loadedAnswer.ResponseValue);

        var loadedDemographic = await readDb.ResponseDemographics.SingleAsync(rd => rd.ResponseId == response.Id);
        Assert.Equal("18", loadedDemographic.Value);
    }

    [Fact]
    public async Task Existing_response_row_without_new_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey, _) = await SeedSurveyWithQuestionAsync(db);

        var minimalResponseId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO responses ("Id", survey_id, session_id, company_id, start_time, created_at, updated_at)
             VALUES ({minimalResponseId}, {survey.Id}, {"sess-minimal"}, {company.Id}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Responses.SingleAsync(r => r.Id == minimalResponseId);
        Assert.False(loaded.IsComplete);
        Assert.False(loaded.IsAnonymous);
        Assert.Null(loaded.UserId);
        Assert.Null(loaded.DepartmentId);
    }
}
