using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Company> SeedCompanyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return company;
    }

    private async Task<User> SeedUserAsync(ClimateProjectDbContext db, Guid companyId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Email = "creator@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task Company_template_round_trips_with_owned_settings_and_questions()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var creator = await SeedUserAsync(db, company.Id);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Weekly Pulse",
            Description = "A short weekly pulse check",
            Category = "pulse_check",
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            Tags = ["pulse", "weekly"],
            Settings = new MicroclimateTemplateSettings { SuggestedFrequency = "daily", MaxParticipants = 50 },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync();

        var question = new MicroclimateTemplateQuestion
        {
            Id = Guid.NewGuid(),
            TemplateId = template.Id,
            TextEn = "How are you feeling this week?",
            Type = "emoji_rating",
            Order = 1,
            Category = "mood",
        };
        db.MicroclimateTemplateQuestions.Add(question);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Equal("pulse_check", loadedTemplate.Category);
        Assert.False(loadedTemplate.IsSystemTemplate);
        Assert.True(loadedTemplate.IsActive);
        Assert.Equal(0, loadedTemplate.UsageCount);
        Assert.Equal(["pulse", "weekly"], loadedTemplate.Tags);
        Assert.Equal("daily", loadedTemplate.Settings.SuggestedFrequency);
        Assert.Equal(50, loadedTemplate.Settings.MaxParticipants);
        Assert.Equal(30, loadedTemplate.Settings.DefaultDurationMinutes);
        Assert.True(loadedTemplate.Settings.AnonymousByDefault);

        var loadedQuestion = await readDb.MicroclimateTemplateQuestions.SingleAsync(q => q.Id == question.Id);
        Assert.Equal(template.Id, loadedQuestion.TemplateId);
        Assert.Equal("emoji_rating", loadedQuestion.Type);
        Assert.True(loadedQuestion.Required);
        Assert.Equal(1, loadedQuestion.Order);
        Assert.Equal("mood", loadedQuestion.Category);
    }

    [Fact]
    public async Task System_template_allows_null_company_and_creator()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var systemTemplate = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = "System Team Mood",
            Description = "Built-in team mood template",
            Category = "team_mood",
            IsSystemTemplate = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(systemTemplate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == systemTemplate.Id);
        Assert.Null(loaded.CompanyId);
        Assert.Null(loaded.CreatedBy);
        Assert.True(loaded.IsSystemTemplate);
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        // Proves the migration's DDL bakes real DEFAULT clauses into every NOT NULL column with a
        // non-CLR-default intended value, rather than relying on EF always supplying a value —
        // insert with ONLY the columns that have no intended default, read back via EF, and assert
        // every defaulted column comes back as the true domain default (not the raw CLR default).
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_templates ("Id", name, description, category, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal Template"}, {"desc"}, {"custom"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.False(loaded.IsSystemTemplate);
        Assert.Equal(0, loaded.UsageCount);
        Assert.True(loaded.IsActive);
        Assert.Empty(loaded.Tags);
        Assert.Equal(30, loaded.Settings.DefaultDurationMinutes);
        Assert.Equal("weekly", loaded.Settings.SuggestedFrequency);
        Assert.Null(loaded.Settings.MaxParticipants);
        Assert.True(loaded.Settings.AnonymousByDefault);
        Assert.True(loaded.Settings.AutoClose);
        Assert.True(loaded.Settings.ShowLiveResults);
    }
}
